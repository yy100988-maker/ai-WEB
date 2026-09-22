/**
 * 平台余额监控（PRD §12 风险 / 详细设计 §5）。
 *
 * 每小时调 `GET /v1/skills/balance`；低于 **10× 最高单次成本** → P0 告警，
 * 且新提交返回 `503 NO_HEALTHY_PROVIDER`（`details.reason=platform_balance`）。
 *
 * 为什么重要：平台余额耗尽会导致**全站生成不可用**（PRD §12 最后一行）。
 * 另外按秒计费模型会按 10 秒整单预扣，用户够钱但平台余额不足时提交仍会失败，
 * 因此提交前也需要预检（详细设计 §3 相关风险对策）。
 */

import { db } from '../../core/db.js';
import { childLogger } from '../../core/logger.js';
import { getConfig } from '../../core/config.js';
import { redis, REDIS_KEYS } from '../../core/redis.js';

const log = childLogger({ mod: 'platform-balance' });

export interface PlatformBalance {
  /** 平台余额（算力/人民币口径） */
  balance: number;
  currency: string;
  /** 触发停服的阈值（10× 最高单次成本） */
  threshold: number;
  /** true = 余额充足 */
  healthy: boolean;
  capturedAt: string;
  /** 拉取失败时为 true，此时沿用上次缓存值 */
  stale?: boolean;
}

const CACHE_TTL_SEC = 3600;

/**
 * 取当前平台上最高单次成本（用于计算告警阈值）。
 * 从 price_items 取 cost_units 最大值。
 */
export async function highestUnitCost(): Promise<number> {
  const top = await db().priceItem.findFirst({
    orderBy: { costUnits: 'desc' },
    select: { costUnits: true },
  });
  return top ? Number(top.costUnits) : 0;
}

/** 提交前预检：余额是否足够跑一单最贵的任务（详细设计 §3.8 风险对策） */
export async function platformBalanceSufficient(): Promise<boolean> {
  const cached = await readCachedBalance();
  if (!cached) return true; // 未知时放行，避免误拦付费生成
  return cached.healthy;
}

export async function readCachedBalance(): Promise<PlatformBalance | null> {
  try {
    const raw = await redis().get(REDIS_KEYS.platformBalance);
    return raw ? (JSON.parse(raw) as PlatformBalance) : null;
  } catch {
    return null;
  }
}

/**
 * 拉取并缓存平台余额。MOCK_PROVIDER=true 时不请求上游，直接标记健康。
 */
export async function fetchPlatformBalance(): Promise<PlatformBalance> {
  const cfg = getConfig();
  const highest = await highestUnitCost();
  const threshold = highest * 10;

  if (cfg.MOCK_PROVIDER || cfg.lkApiKeys.length === 0) {
    const result: PlatformBalance = {
      balance: Number.POSITIVE_INFINITY,
      currency: 'CNY',
      threshold,
      healthy: true,
      capturedAt: new Date().toISOString(),
      stale: true,
    };
    await cacheBalance(result);
    return result;
  }

  try {
    const { request } = await import('undici');
    const baseUrl = cfg.LK_BASE_URL.replace(/\/+$/, '');
    const res = await request(`${baseUrl}/v1/skills/balance`, {
      method: 'GET',
      headers: {
        authorization: `Bearer ${cfg.lkApiKeys[0]!}`,
        accept: 'application/json',
      },
      headersTimeout: 15000,
      bodyTimeout: 15000,
    });

    const body = (await res.body.json()) as unknown;

    // `/v1/skills/*` 判有无 error 对象（PRD 附录 D）
    if (res.statusCode >= 400 || (typeof body === 'object' && body !== null && 'error' in body)) {
      throw new Error(`balance endpoint error: HTTP ${res.statusCode}`);
    }

    const balance = extractBalance(body);
    const result: PlatformBalance = {
      balance,
      currency: 'CNY',
      threshold,
      healthy: threshold <= 0 || balance >= threshold,
      capturedAt: new Date().toISOString(),
    };
    await cacheBalance(result);
    return result;
  } catch (e) {
    log.warn({ err: e }, 'fetch platform balance failed, keeping previous value');
    const previous = await readCachedBalance();
    if (previous) return { ...previous, stale: true };
    return {
      balance: Number.POSITIVE_INFINITY,
      currency: 'CNY',
      threshold,
      healthy: true,
      capturedAt: new Date().toISOString(),
      stale: true,
    };
  }
}

/**
 * 拉取并检查余额，必要时 P0 告警。
 * 由 cron 每小时调用。
 */
export async function checkPlatformBalance(): Promise<PlatformBalance> {
  const result = await fetchPlatformBalance();

  if (!result.healthy) {
    log.error(
      { balance: result.balance, threshold: result.threshold },
      'P0: platform balance below 10x highest unit cost — new submissions will return 503 (reason=platform_balance)',
    );
  } else if (result.balance < result.threshold * 2) {
    log.warn({ balance: result.balance, threshold: result.threshold }, 'platform balance getting low');
  }

  return result;
}

async function cacheBalance(b: PlatformBalance): Promise<void> {
  try {
    await redis().set(REDIS_KEYS.platformBalance, JSON.stringify(b), 'EX', CACHE_TTL_SEC);
  } catch (e) {
    log.warn({ err: e }, 'cache platform balance failed');
  }
}

/** 从上游各种可能的响应形态里抽取余额数值 */
export function extractBalance(body: unknown): number {
  if (typeof body === 'number') return body;
  if (typeof body !== 'object' || body === null) return Number.POSITIVE_INFINITY;

  const obj = body as Record<string, unknown>;
  const candidates: unknown[] = [
    obj.balance,
    obj.amount,
    obj.credit,
    obj.remain,
    (obj.data as Record<string, unknown> | undefined)?.balance,
    (obj.data as Record<string, unknown> | undefined)?.amount,
    (obj.data as Record<string, unknown> | undefined)?.remain,
  ];

  for (const c of candidates) {
    if (typeof c === 'number' && Number.isFinite(c)) return c;
    if (typeof c === 'string') {
      const n = Number.parseFloat(c);
      if (Number.isFinite(n)) return n;
    }
  }
  return Number.POSITIVE_INFINITY;
}

/** 供 Router 在平台余额耗尽时给 503 用（`details.reason=platform_balance`） */
export async function platformBalanceBlockReason(): Promise<string | null> {
  const cached = await readCachedBalance();
  if (cached && !cached.healthy) return 'platform_balance';
  return null;
}

export { CACHE_TTL_SEC };
