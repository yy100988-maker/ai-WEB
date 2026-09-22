/**
 * CircuitBreaker —— 模型级熔断器（PRD §5.3 / 详细设计 §4.3）。
 *
 * 状态机：
 *   closed --(连续失败 ≥ failureThreshold=5)--> open（冷却 cooldownSec=120s）
 *   open   --(冷却到期)--> half_open（放 1 次探活）
 *   half_open --(探活成功)--> closed
 *   half_open --(探活失败)--> open（重新计时）
 *
 * 为什么是**模型级**而不是渠道级：LK888 是聚合网关，"渠道路由不可覆盖"，
 * 同一个 Key 下不同模型背后的分组完全不同（TX-Y3 / 火山官方 / KJ直连），
 * 某个模型挂了不代表整个渠道挂了。按渠道熔断会误伤 100 个模型里的 99 个。
 *
 * 存储：Redis（Worker 多进程共享）+ 进程内 Map 兜底（Redis 不可用时单进程仍可工作）。
 * 键：`REDIS_KEYS.breaker(modelCode)`（冻结的键命名，勿改）。
 */

import { redis, REDIS_KEYS } from '../../core/redis.js';
import { childLogger } from '../../core/logger.js';

const log = childLogger({ mod: 'circuit-breaker' });

export type BreakerState = 'closed' | 'open' | 'half_open';

export interface CircuitBreakerApi {
  isOpen(modelCode: string): Promise<boolean>;
  recordSuccess(modelCode: string): Promise<void>;
  recordFailure(modelCode: string, threshold?: number): Promise<void>;
  earliestRecoverySec(): Promise<number>;
  state(modelCode: string): Promise<BreakerState>;
}

// ---------------------------------------------------------------- 参数

/** 连续失败阈值（PRD §5.3 candidates[].circuitBreaker.failureThreshold 默认值） */
export const DEFAULT_FAILURE_THRESHOLD = 5;
/** 冷却时长（秒）；到时间转 half_open 探活 */
export const DEFAULT_COOLDOWN_SEC = 120;
/** 计数键 TTL：冷却时长 × 4，足够覆盖 open→half_open→closed 的完整周期 */
const FAILURE_KEY_TTL_SEC = DEFAULT_COOLDOWN_SEC * 4;

/** 熔断状态快照（一个 modelCode 一条，JSON 存 Redis） */
interface BreakerSnapshot {
  consecutiveFailures: number;
  state: BreakerState;
  /** epoch ms；open 状态下表示最早可转 half_open 的时刻 */
  openedAt: number;
  /** 最近一次状态变化，用于日志/指标 */
  updatedAt: number;
}

/**
 * 进程内状态（Redis 兜底 + 快路径）。
 *
 * 为什么需要它：单进程测试/CI 常常没有 Redis；熔断器若强依赖 Redis，
 * 会让 Router 单测被迫起容器。这里让 Redis 成为**共享层**而非**必需层**。
 */
const localState = new Map<string, BreakerSnapshot>();

/** 记录本次进程内已放行过 half_open 探活的模型（保证"探活 1 次"） */
const halfOpenProbeIssued = new Set<string>();

function failKey(modelCode: string): string {
  return `${REDIS_KEYS.breaker(modelCode)}:fail`;
}
function stateKey(modelCode: string): string {
  return REDIS_KEYS.breaker(modelCode);
}

// ---------------------------------------------------------------- 存取

function defaultSnapshot(): BreakerSnapshot {
  return { consecutiveFailures: 0, state: 'closed', openedAt: 0, updatedAt: Date.now() };
}

async function readSnapshot(modelCode: string): Promise<BreakerSnapshot> {
  const local = localState.get(modelCode);

  try {
    const raw = await redis().get(stateKey(modelCode));
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<BreakerSnapshot>;
      const snap: BreakerSnapshot = {
        consecutiveFailures: parsed.consecutiveFailures ?? 0,
        state: parsed.state ?? 'closed',
        openedAt: parsed.openedAt ?? 0,
        updatedAt: parsed.updatedAt ?? Date.now(),
      };
      localState.set(modelCode, snap);
      return snap;
    }
    // Redis 可达但没有记录：以本地为准（可能是本地刚写、Redis 掉了又起）
    if (local) return local;
    return defaultSnapshot();
  } catch (e) {
    log.warn({ err: e, model: modelCode }, 'breaker read redis failed, using local state');
    return local ?? defaultSnapshot();
  }
}

async function writeSnapshot(modelCode: string, snap: BreakerSnapshot): Promise<void> {
  snap.updatedAt = Date.now();
  localState.set(modelCode, snap);
  try {
    await redis().set(stateKey(modelCode), JSON.stringify(snap), 'EX', FAILURE_KEY_TTL_SEC);
  } catch (e) {
    log.warn({ err: e, model: modelCode }, 'breaker write redis failed (local only)');
  }
}

async function clearFailureCounter(modelCode: string): Promise<void> {
  try {
    await redis().del(failKey(modelCode));
  } catch (e) {
    log.warn({ err: e, model: modelCode }, 'breaker clear counter failed');
  }
}

/**
 * 把快照按时间推进：open 且冷却已过 → 视为 half_open。
 * 纯函数（不写状态），因为在 `isOpen()` 这种只读路径里不应产生写放大。
 */
function advance(snap: BreakerSnapshot, cooldownSec: number): BreakerSnapshot {
  if (snap.state === 'open' && Date.now() - snap.openedAt >= cooldownSec * 1000) {
    return { ...snap, state: 'half_open' };
  }
  return snap;
}

// ---------------------------------------------------------------- 实现

export const circuitBreaker: CircuitBreakerApi = {
  /**
   * 是否熔断（Router 的健康过滤用）。
   *
   * 语义：`open` → true（挡掉）。
   * `half_open` → **放行一次**探活：同一冷却周期内第二次调用返回 true，
   * 避免 Router 并发 pick 时把半开状态当成健康模型狂打。
   */
  async isOpen(modelCode: string): Promise<boolean> {
    const raw = await readSnapshot(modelCode);
    const snap = advance(raw, DEFAULT_COOLDOWN_SEC);

    if (snap.state === 'closed') return false;

    if (snap.state === 'half_open') {
      // 探活只放 1 次；已发过就继续挡
      if (halfOpenProbeIssued.has(modelCode)) return true;
      halfOpenProbeIssued.add(modelCode);
      // 落盘 half_open，让多进程都能看到状态已推进
      await writeSnapshot(modelCode, snap);
      log.info({ model: modelCode }, 'circuit breaker half_open: probe allowed');
      return false;
    }

    return true;
  },

  /** 探活/正常成功 → 清零计数并回到 closed */
  async recordSuccess(modelCode: string): Promise<void> {
    const prev = await readSnapshot(modelCode);
    await clearFailureCounter(modelCode);
    halfOpenProbeIssued.delete(modelCode);

    if (prev.state !== 'closed' || prev.consecutiveFailures > 0) {
      log.info(
        { model: modelCode, from: prev.state, failures: prev.consecutiveFailures },
        'circuit breaker closed (recovered)',
      );
    }
    await writeSnapshot(modelCode, {
      consecutiveFailures: 0,
      state: 'closed',
      openedAt: 0,
      updatedAt: Date.now(),
    });
  },

  /**
   * 记一次失败。
   * 连续失败 ≥ threshold → open（冷却 120s）。
   * 在 half_open 下失败 → 直接重新 open（探活失败）。
   */
  async recordFailure(modelCode: string, threshold: number = DEFAULT_FAILURE_THRESHOLD): Promise<void> {
    const prevRaw = await readSnapshot(modelCode);
    const prev = advance(prevRaw, DEFAULT_COOLDOWN_SEC);

    // Redis 里的连续计数（跨进程累加）；失败时回落本地
    let consecutive = prev.consecutiveFailures + 1;
    try {
      const n = await redis().incr(failKey(modelCode));
      await redis().expire(failKey(modelCode), FAILURE_KEY_TTL_SEC);
      consecutive = n;
    } catch (e) {
      log.warn({ err: e, model: modelCode }, 'breaker incr failed, using local counter');
    }

    const shouldOpen = consecutive >= threshold || prev.state === 'half_open';

    if (shouldOpen) {
      halfOpenProbeIssued.delete(modelCode);
      log.error(
        { model: modelCode, failures: consecutive, threshold, cooldownSec: DEFAULT_COOLDOWN_SEC },
        'circuit breaker OPEN',
      );
      await writeSnapshot(modelCode, {
        consecutiveFailures: consecutive,
        state: 'open',
        openedAt: Date.now(),
        updatedAt: Date.now(),
      });
      return;
    }

    await writeSnapshot(modelCode, {
      consecutiveFailures: consecutive,
      state: prev.state === 'open' ? 'open' : 'closed',
      openedAt: prev.openedAt,
      updatedAt: Date.now(),
    });
  },

  /**
   * 最早的熔断恢复时间（秒）。
   * 全灭时给 `err.noHealthyProvider(estimatedRecoverySec)` 用 —— 前端据此展示倒计时。
   * 无熔断 → 0。
   */
  async earliestRecoverySec(): Promise<number> {
    const now = Date.now();
    let earliest = Number.POSITIVE_INFINITY;

    for (const snap of localState.values()) {
      if (snap.state !== 'open') continue;
      const recoverAt = snap.openedAt + DEFAULT_COOLDOWN_SEC * 1000;
      if (recoverAt < earliest) earliest = recoverAt;
    }

    if (!Number.isFinite(earliest)) return 0;
    return Math.max(0, Math.ceil((earliest - now) / 1000));
  },

  /** 当前状态（含时间推进；测试与运维查询用） */
  async state(modelCode: string): Promise<BreakerState> {
    const raw = await readSnapshot(modelCode);
    return advance(raw, DEFAULT_COOLDOWN_SEC).state;
  },
};

/** 测试用：清空进程内熔断状态 */
export function resetBreakers(): void {
  localState.clear();
  halfOpenProbeIssued.clear();
}

/**
 * 供测试注入：直接把某模型推入 open 且指定冷却起点。
 * 生产代码不应调用（唯一入口是 recordFailure）。
 */
export function __forceOpen(modelCode: string, openedAtMs: number, failures = DEFAULT_FAILURE_THRESHOLD): void {
  localState.set(modelCode, {
    consecutiveFailures: failures,
    state: 'open',
    openedAt: openedAtMs,
    updatedAt: Date.now(),
  });
}
