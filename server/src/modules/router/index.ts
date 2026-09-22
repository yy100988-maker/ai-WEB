/**
 * Router —— 模型级路由决策（PRD §5.3 / 详细设计 §4.3）。
 *
 * ⚠️ **关键平台约束**：LK888 的渠道路由由 API Key 策略决定，请求参数无法覆盖
 * （`channel_group` 字段与 `X-Channel-Group` 头均被忽略）。所以：
 * - **模型级路由**（我们完全可控）：由本 Router 决定用哪个 model —— 这是本文件的职责
 * - **分组级 fallback**：靠多把 Key（priority 顺序），不在本文件范围
 *
 * 决策顺序（严格按 PRD §5.3）：
 *   1. 显式指定 requestedModelId → 校验 active && enabled && 支持能力 && 参数约束
 *      不可用 → 409 MODEL_UNAVAILABLE + alternatives[]
 *   2. 能力/参数过滤（gk-video-3 只支持 6/10s，30s 的请求不该路由到它）
 *   3. 健康过滤（enabled=false / 熔断中）
 *   4. 灰度分流（hash(userId) % 100 < grayPercent）
 *   5. 加权随机（strategy: weighted | cost_first | quality_first | latency_first）
 *   6. 全灭 → 503 NO_HEALTHY_PROVIDER + estimatedRecoverySec
 */

import { createHash } from 'node:crypto';
import type { Capability, ModelDescriptor } from '../../core/types.js';
import { err } from '../../core/errors.js';
import { db } from '../../core/db.js';
import { childLogger } from '../../core/logger.js';
import { allModels, allActiveModels, latestPricingSnapshot } from '../providers/registry.js';
import { validateRequest } from '../providers/validate.js';
import { circuitBreaker } from './breaker.js';

const log = childLogger({ mod: 'router' });

// ---------------------------------------------------------------- 类型

export interface PickResult {
  modelId: string;
  modelCode: string;
  channelId: string;
  channelCode: string;
  displayName: string;
}

export interface RouterApi {
  pick(input: {
    capability: Capability;
    requestedModelId?: string;
    userId: string;
    params: Record<string, unknown>;
  }): Promise<PickResult>;
  /** 显式模型的可用性校验 + 备选建议（409 时用） */
  alternatives(
    capability: Capability,
    excludeModelId?: string,
  ): Promise<Array<{ id: string; displayName: string }>>;
}

/** 路由策略（DB `routing_policies.strategy`） */
export type RoutingStrategy = 'weighted' | 'cost_first' | 'quality_first' | 'latency_first';

/** 单条候选配置（PRD §5.3 `candidates[]`） */
export interface RoutingCandidate {
  model: string;
  weight: number;
  enabled: boolean;
  grayPercent: number;
}

export interface RoutingPolicyResolved {
  capability: string;
  strategy: RoutingStrategy;
  fallbackEnabled: boolean;
  candidates: RoutingCandidate[];
  circuitBreaker: { failureThreshold: number; cooldownSec: number };
  /**
   * 策略行存在、但 candidates 为显式空数组 → 运营主动关停该能力的自动路由。
   * 此时**未提及模型的默认参与必须关闭**，直接走"全灭 → 503"，
   * 否则运营没有任何办法表达"一个都不许走"。
   * （无策略行时为 false，沿用"所有 active 模型默认参与"。）
   */
  explicitEmpty: boolean;
}

const DEFAULT_CIRCUIT_BREAKER = { failureThreshold: 5, cooldownSec: 120 };

/** 策略缓存 60s（PRD §5.3 "策略可配置，运营可改，无需发版"） */
const POLICY_CACHE_TTL_MS = 60_000;

// ---------------------------------------------------------------- 策略装载

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

export function parseCandidates(raw: unknown): RoutingCandidate[] {
  if (!Array.isArray(raw)) return [];
  const out: RoutingCandidate[] = [];
  for (const item of raw) {
    const c = asRecord(item);
    const model = typeof c['model'] === 'string' ? c['model'] : null;
    if (!model) continue;
    out.push({
      model,
      weight: typeof c['weight'] === 'number' && c['weight'] > 0 ? c['weight'] : 1,
      enabled: c['enabled'] !== false,
      // grayPercent 缺省 = 100（全量）；显式 0 表示"永不参与"
      grayPercent: typeof c['grayPercent'] === 'number' ? clampPercent(c['grayPercent']) : 100,
    });
  }
  return out;
}

function clampPercent(v: number): number {
  return Math.min(100, Math.max(0, Math.round(v)));
}

export function parseStrategy(raw: unknown): RoutingStrategy {
  switch (raw) {
    case 'cost_first':
    case 'quality_first':
    case 'latency_first':
    case 'weighted':
      return raw;
    default:
      return 'weighted';
  }
}

export function parseCircuitBreakerConfig(raw: unknown): { failureThreshold: number; cooldownSec: number } {
  const c = asRecord(raw);
  return {
    failureThreshold:
      typeof c['failureThreshold'] === 'number' && c['failureThreshold'] > 0
        ? c['failureThreshold']
        : DEFAULT_CIRCUIT_BREAKER.failureThreshold,
    cooldownSec:
      typeof c['cooldownSec'] === 'number' && c['cooldownSec'] > 0
        ? c['cooldownSec']
        : DEFAULT_CIRCUIT_BREAKER.cooldownSec,
  };
}

const policyCache = new Map<string, { at: number; value: RoutingPolicyResolved }>();

/** 测试用：清空策略缓存 */
export function resetRouterCache(): void {
  policyCache.clear();
}

/**
 * 读能力对应的路由策略。
 * 读不到 DB 记录 → **默认策略：所有 active 模型 weight=1**（保证"运营没配也能跑"）。
 */
export async function loadPolicy(capability: Capability): Promise<RoutingPolicyResolved> {
  const cached = policyCache.get(capability);
  if (cached && Date.now() - cached.at < POLICY_CACHE_TTL_MS) return cached.value;

  let resolved: RoutingPolicyResolved | null = null;
  let explicitEmpty = false;
  try {
    const row = await db().routingPolicy.findUnique({ where: { capability } });
    if (row) {
      const candidates = parseCandidates(row.candidates);
      // 策略行存在但候选为空数组 = 运营显式关停（见 explicitEmpty 注释）
      explicitEmpty = candidates.length === 0;
      resolved = {
        capability,
        strategy: parseStrategy(row.strategy),
        fallbackEnabled: row.fallbackEnabled,
        candidates,
        circuitBreaker: parseCircuitBreakerConfig(row.circuitBreaker),
        explicitEmpty,
      };
    }
  } catch (e) {
    log.warn({ err: e, capability }, 'load routing policy failed, using default');
  }

  if (!resolved) {
    // 默认策略：所有 active 模型 weight=1、grayPercent=100
    const models = await allActiveModels(capability);
    resolved = {
      capability,
      strategy: 'weighted',
      fallbackEnabled: true,
      candidates: models.map((m) => ({
        model: m.code,
        weight: 1,
        enabled: true,
        grayPercent: 100,
      })),
      circuitBreaker: { ...DEFAULT_CIRCUIT_BREAKER },
      explicitEmpty: false,
    };
  }

  policyCache.set(capability, { at: Date.now(), value: resolved });
  return resolved;
}

// ---------------------------------------------------------------- 灰度哈希

/**
 * 稳定灰度哈希：`sha256(userId)` 取前 8 字节 → 转数字 → `% 100`。
 *
 * **为什么不能用 `Math.random()` 或 `hashCode` 的默认实现**：
 * 同一个用户在同一灰度规则下必须**永远落在同一侧**，否则用户会看到
 * "这次生成走 gk-video-3、下次走 hailuo-h3"，前端展示的模型随机漂移，
 * 且无法复现线上问题。
 *
 * 为什么取前 8 字节：JS 的 number 能精确表示 2^53，8 字节 = 64bit 超出范围，
 * 所以用 BigInt 转字符串再取模，避免精度丢失导致分布偏移。
 */
export function grayBucket(userId: string): number {
  const hex = createHash('sha256').update(userId, 'utf8').digest('hex').slice(0, 16);
  const mod = BigInt(`0x${hex}`) % 100n;
  return Number(mod);
}

/** 该用户是否落在指定灰度百分比内（0 = 永不，100 = 恒是） */
export function inGray(grayPercent: number, userId: string): boolean {
  if (grayPercent <= 0) return false;
  if (grayPercent >= 100) return true;
  return grayBucket(userId) < grayPercent;
}

// ---------------------------------------------------------------- 加权选择

/**
 * 加权随机挑选索引。
 * `weights` 全为 0 或空 → 返回 -1（调用方处理）。
 */
export function weightedPickIndex(weights: number[]): number {
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return -1;

  let r = Math.random() * total;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i] ?? 0;
    if (r < 0) return i;
  }
  return weights.length - 1; // 浮点误差兜底
}

// ---------------------------------------------------------------- 候选评估

interface Candidate {
  model: ModelDescriptor;
  weight: number;
  grayPercent: number;
  /** 排序用：10s 基准成本（cost_first）/ 质量分（quality_first）/ 平均耗时（latency_first） */
  sortKey: number;
}

/** 策略排序所需的外部数据（按需加载，避免每次 pick 都查全量） */
interface RankingData {
  costUnits10s: Map<string, number>;
  latencySec: Map<string, number>;
}

async function loadRankingData(models: ModelDescriptor[], strategy: RoutingStrategy): Promise<RankingData> {
  const costUnits10s = new Map<string, number>();
  const latencySec = new Map<string, number>();

  if (strategy !== 'cost_first' && strategy !== 'latency_first') {
    return { costUnits10s, latencySec };
  }

  for (const m of models) {
    try {
      const snap = await latestPricingSnapshot(m.id);
      if (!snap) continue;
      // cost_first：用 min_price 作为"10s 基准价"（PRD §5.3）。
      // 注意**按 token 陷阱**：base_price=0 不代表免费，所以优先 min_price；
      // min_price 也为 0 时用 output_token_price 估算（§5.2）。
      let base = snap.minPrice > 0 ? snap.minPrice : snap.basePrice;
      if (base <= 0 && snap.outputTokenPrice && snap.outputTokenPrice > 0) {
        // 720p ≈ 21600 token/秒 → 10 秒 ≈ 216000 token
        base = (snap.outputTokenPrice * 216_000) / 1_000_000;
      }
      costUnits10s.set(m.code, base);
      if (snap.avgResponseSeconds !== null) latencySec.set(m.code, snap.avgResponseSeconds);
    } catch (e) {
      log.warn({ err: e, model: m.code }, 'load pricing snapshot failed');
    }
  }

  return { costUnits10s, latencySec };
}

/**
 * 应用排序策略，返回**已排序的候选**（最优在前）。
 *
 * - `weighted`：不排序，保持权重随机（weight 生效）
 * - `cost_first`：10s 基准价升序，取最优
 * - `quality_first`：qualityScore 降序
 * - `latency_first`：平均响应耗时升序
 */
function applyStrategy(candidates: Candidate[], strategy: RoutingStrategy, data: RankingData): Candidate[] {
  if (strategy === 'weighted') return candidates;

  const value = (c: Candidate): number => {
    switch (strategy) {
      case 'cost_first':
        // 无快照 → 给一个很大的值排到后面（不假装便宜）
        return data.costUnits10s.get(c.model.code) ?? Number.MAX_SAFE_INTEGER;
      case 'quality_first':
        // 无质量分 → 0 分排后面
        return -(c.model.qualityScore ?? 0);
      case 'latency_first':
        return data.latencySec.get(c.model.code) ?? Number.MAX_SAFE_INTEGER;
    }
  };

  return [...candidates].sort((a, b) => {
    const va = value(a);
    const vb = value(b);
    if (va !== vb) return va - vb;
    return a.model.code.localeCompare(b.model.code); // 稳定排序
  });
}

// ---------------------------------------------------------------- Router 实现

function toPickResult(m: ModelDescriptor): PickResult {
  return {
    modelId: m.id,
    modelCode: m.code,
    channelId: m.channelId,
    channelCode: m.channelCode,
    displayName: m.displayName,
  };
}

/** params 可能是任意 Json；收窄为本模块认识的形状（校验器会再逐字段查） */
function toValidatableParams(
  params: Record<string, unknown>,
): Record<string, string | number | boolean | string[]> {
  const out: Record<string, string | number | boolean | string[]> = {};
  for (const [k, v] of Object.entries(params)) {
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
      out[k] = v;
    } else if (Array.isArray(v) && v.every((x) => typeof x === 'string')) {
      out[k] = v as string[];
    }
    // 其他类型（对象/嵌套数组）直接丢弃：校验器按"未传"处理
  }
  return out;
}

/** 参数约束是否通过（不含 inputs 校验 —— 路由阶段还没有交付 URL） */
function passesParamConstraints(
  model: ModelDescriptor,
  params: Record<string, string | number | boolean | string[]>,
): boolean {
  const res = validateRequest({ prompt: '', params, inputs: [] }, model);
  if (res.valid) return true;

  // prompt 相关错误在路由阶段不适用（Router.pick 传入的是空 prompt）
  const errors = (res.errors ?? []).filter((e) => e.param !== 'prompt');
  return errors.length === 0;
}

export const router: RouterApi = {
  async pick(input): Promise<PickResult> {
    const wantParams = toValidatableParams(input.params ?? {});
    const policy = await loadPolicy(input.capability);

    // ---------- 1. 显式指定 ----------
    if (input.requestedModelId) {
      const models = await allModels();
      // 同时接受 DB UUID（catalog 下发的 id）与模型 code（如 `gk-video-3`），
      // 与 pricingEngine.resolveModel 保持一致的宽松语义，避免脚本/文档按 code 调用时报 409。
      const model = models.find(
        (m) => m.id === input.requestedModelId || m.code === input.requestedModelId,
      );

      if (!model) {
        const alts = await this.alternatives(input.capability, input.requestedModelId);
        throw err.modelUnavailable(alts.map((a) => a.id));
      }

      const rejectReason = explicitRejectReason(model, input.capability, wantParams);
      if (rejectReason) {
        const alts = await this.alternatives(input.capability, model.id);
        log.info(
          { modelId: model.id, modelCode: model.code, reason: rejectReason },
          'requested model unavailable',
        );
        throw err.modelUnavailable(alts.map((a) => a.id));
      }

      return toPickResult(model);
    }

    // ---------- 2/3/4. 候选过滤 ----------
    const activeModels = await allActiveModels(input.capability);

    // 策略里显式关闭的模型直接排除；策略未提及的模型默认参与（weight=1, gray=100）。
    // 例外：策略行存在但 candidates 为显式空数组（explicitEmpty）时，
    // 运营表达的是"全部关停"，未提及模型的默认参与必须关闭，否则无法表达关停。
    const policyByCode = new Map(policy.candidates.map((c) => [c.model, c]));
    const allowUnmentioned = !policy.explicitEmpty;

    const candidates: Candidate[] = [];
    for (const model of activeModels) {
      const pc = policyByCode.get(model.code);
      if (pc && !pc.enabled) continue;
      if (!pc && !allowUnmentioned) continue;

      // 2. 能力（allActiveModels 已按 capability 过滤，这里再确认一次）
      if (!model.capabilities.includes(input.capability)) continue;

      // 2. 参数约束（gk-video-3 只支持 6/10s）
      if (!passesParamConstraints(model, wantParams)) {
        log.debug({ model: model.code, capability: input.capability }, 'candidate filtered by params');
        continue;
      }

      // 3. 健康过滤（熔断中）
      const open = await circuitBreaker.isOpen(model.code);
      if (open) {
        log.debug({ model: model.code }, 'candidate filtered by circuit breaker');
        continue;
      }

      // 4. 灰度分流
      const grayPercent = pc?.grayPercent ?? 100;
      if (!inGray(grayPercent, input.userId)) {
        log.debug({ model: model.code, grayPercent }, 'candidate filtered by gray rollout');
        continue;
      }

      candidates.push({
        model,
        weight: pc?.weight ?? 1,
        grayPercent,
        sortKey: 0,
      });
    }

    // ---------- 6. 全灭 ----------
    if (candidates.length === 0) {
      const recovery = await circuitBreaker.earliestRecoverySec();
      log.error(
        { capability: input.capability, userId: input.userId, recoverySec: recovery },
        'no healthy provider',
      );
      throw err.noHealthyProvider(recovery > 0 ? recovery : 30);
    }

    // ---------- 5. 加权随机 / 策略择优 ----------
    const ranking = await loadRankingData(
      candidates.map((c) => c.model),
      policy.strategy,
    );
    const ordered = applyStrategy(candidates, policy.strategy, ranking);

    let picked: Candidate | undefined;
    if (policy.strategy === 'weighted') {
      const idx = weightedPickIndex(ordered.map((c) => c.weight));
      picked = ordered[idx >= 0 ? idx : 0];
    } else {
      // 择优策略：在"最优档"内仍按权重随机，避免所有请求打同一台
      const best = ordered[0];
      if (best) {
        const bestKey = rankingKey(best, policy.strategy, ranking);
        const tied = ordered.filter((c) => rankingKey(c, policy.strategy, ranking) === bestKey);
        const idx = weightedPickIndex(tied.map((c) => c.weight));
        picked = tied[idx >= 0 ? idx : 0] ?? best;
      }
    }

    // 防御：上面已排除 candidates.length === 0，但 noUncheckedIndexedAccess 需要收窄
    if (!picked) {
      throw err.noHealthyProvider(await circuitBreaker.earliestRecoverySec());
    }

    log.info(
      {
        capability: input.capability,
        modelCode: picked.model.code,
        strategy: policy.strategy,
        candidates: candidates.length,
      },
      'router picked model',
    );

    return toPickResult(picked.model);
  },

  /** 可用备选（409 的 `alternatives[]`，前端据此提示"换这个模型"） */
  async alternatives(
    capability: Capability,
    excludeModelId?: string,
  ): Promise<Array<{ id: string; displayName: string }>> {
    const models = await allActiveModels(capability);
    return models
      .filter((m) => m.id !== excludeModelId)
      .map((m) => ({ id: m.id, displayName: m.displayName }));
  },
};

/** 显式指定不可用的原因（null = 可用） */
function explicitRejectReason(
  model: ModelDescriptor,
  capability: Capability,
  params: Record<string, string | number | boolean | string[]>,
): string | null {
  if (!model.active) return 'not_active';
  if (!model.enabled) return 'disabled';
  if (!model.capabilities.includes(capability)) return 'capability_mismatch';
  if (!passesParamConstraints(model, params)) return 'param_constraints';
  return null;
}

function rankingKey(c: Candidate, strategy: RoutingStrategy, data: RankingData): number {
  switch (strategy) {
    case 'cost_first':
      return data.costUnits10s.get(c.model.code) ?? Number.MAX_SAFE_INTEGER;
    case 'quality_first':
      return -(c.model.qualityScore ?? 0);
    case 'latency_first':
      return data.latencySec.get(c.model.code) ?? Number.MAX_SAFE_INTEGER;
    case 'weighted':
      return 0;
  }
}
