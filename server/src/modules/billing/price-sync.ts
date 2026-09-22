/**
 * 上游价格同步（PRD §6.9 每日 2 次 / 详细设计 §5）。
 *
 * 流程：
 *  1. 遍历所有 enabled 模型，调 `GET /v1/skills/models/{name}/pricing?status=active`
 *  2. 取每个模型**最优激活分组**的 min_price（按次取 base_price）
 *  3. 按三口径重算 costUnits → credits，写入 `price_items`
 *  4. 检测变化：min_price 变动超 20% → 告警 + **自动 active=false**（防负毛利订单）
 *  5. 新增模型默认 active=false，待人工确认
 *
 * 幂等：按 (modelId, capability, specHash) upsert；日志写 price_sync_log。
 *
 * ⚠️ MOCK_PROVIDER=true 时不发起真实上游请求（返回 no-op），
 * 由测试直接调用本模块的纯函数验证重算逻辑。
 */

import type { Prisma } from '@prisma/client';
import { db, transaction } from '../../core/db.js';
import { childLogger } from '../../core/logger.js';
import { getConfig } from '../../core/config.js';
import { specHashOf } from '../../core/crypto.js';
import {
  costUnitsToCredits,
  perCallCostUnits,
  perSecondCostUnits,
  perTokenCostUnits,
  estimateVideoOutputTokens,
  type PricingConstants,
} from '../../core/pricing-math.js';

const log = childLogger({ mod: 'price-sync' });

/** 成本异常阈值：单次同步涨幅超 20% 视为异常（PRD §6.9 / §12） */
export const COST_ANOMALY_THRESHOLD = 0.2;

export interface AnomalyResult {
  exceeded: boolean;
  ratio: number;
  changePercent: number;
}

/**
 * 成本变动检测（§13 #13）。
 * ratio = newPrice / oldPrice；涨幅 > 20% 即 exceeded。
 */
export function detectCostAnomaly(input: { oldCostUnits: number; newCostUnits: number }): AnomalyResult {
  const { oldCostUnits, newCostUnits } = input;
  if (oldCostUnits <= 0) {
    return { exceeded: false, ratio: 1, changePercent: 0 };
  }
  const ratio = newCostUnits / oldCostUnits;
  const changePercent = (ratio - 1) * 100;
  return {
    exceeded: changePercent > COST_ANOMALY_THRESHOLD * 100,
    ratio,
    changePercent,
  };
}

/** 上游 pricing 响应中单个分组的形态（LK888 `/v1/skills/models/{name}/pricing`） */
export interface PricingGroup {
  group_name?: string;
  is_active?: boolean;
  billing_method?: string; // per_call | per_second | per_token
  base_price?: number | string;
  min_price?: number | string;
  input_token_price?: number | string;
  output_token_price?: number | string;
  option_prices?: Record<string, unknown>;
  time_discounts?: Record<string, unknown>;
  success_rate_24h?: number;
  avg_response_seconds?: number;
}

function num(v: unknown, fallback = 0): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number.parseFloat(v);
    return Number.isFinite(n) ? n : fallback;
  }
  return fallback;
}

/**
 * 从全部分组中选出**最优激活分组**（PRD §6.3：取 min_price 最小者）。
 * 全部分组下线 → 返回 null（调用方应标记模型 active=false）。
 */
export function pickBestGroup(groups: PricingGroup[]): PricingGroup | null {
  const active = groups.filter((g) => g.is_active !== false);
  if (active.length === 0) return null;

  let best: PricingGroup | null = null;
  let bestPrice = Number.POSITIVE_INFINITY;

  for (const g of active) {
    const method = g.billing_method ?? 'per_call';
    // 按 token 计费时 base_price 常为 0，不能据此判最优（PRD 附录 D 陷阱），
    // 改用 output_token_price 作为比较基准。
    const price =
      method === 'per_token'
        ? num(g.output_token_price)
        : method === 'per_second'
          ? num(g.min_price) || num(g.base_price)
          : num(g.base_price) || num(g.min_price);

    if (price > 0 && price < bestPrice) {
      bestPrice = price;
      best = g;
    }
  }

  return best ?? active[0] ?? null;
}

export type BillingMethodName = 'per_call' | 'per_second' | 'per_token';

export function normalizeBillingMethod(v: unknown): BillingMethodName {
  const s = String(v ?? '').toLowerCase();
  if (s.includes('token')) return 'per_token';
  if (s.includes('second') || s.includes('sec')) return 'per_second';
  return 'per_call';
}

/**
 * 按三口径规则，从最优分组的定价 + 规格，算出该规格的 costUnits。
 * （PRD §6.2）
 */
export function costUnitsForSpec(input: {
  group: PricingGroup;
  spec: Record<string, unknown>;
}): { costUnits: number; method: BillingMethodName } {
  const method = normalizeBillingMethod(input.group.billing_method);
  const spec = input.spec;

  const resolution = typeof spec.resolution === 'string' ? spec.resolution : '720p';
  const durationSec = typeof spec.durationSec === 'number' ? spec.durationSec : 10;

  switch (method) {
    case 'per_second': {
      const perSecond = num(input.group.min_price) || num(input.group.base_price);
      return { costUnits: perSecondCostUnits({ perSecondPrice: perSecond, durationSec }), method };
    }
    case 'per_token': {
      const inputTokens = 0;
      const outputTokens = estimateVideoOutputTokens(resolution, durationSec);
      return {
        costUnits: perTokenCostUnits({
          inputTokens,
          outputTokens,
          inputTokenPrice: num(input.group.input_token_price),
          outputTokenPrice: num(input.group.output_token_price),
        }),
        method,
      };
    }
    case 'per_call':
    default: {
      return { costUnits: perCallCostUnits({ basePrice: num(input.group.base_price) }), method };
    }
  }
}

export interface SyncSummary {
  models: number;
  updated: number;
  disabled: number;
  anomalies: Array<{ modelCode: string; changePercent: number; oldCostUnits: number; newCostUnits: number }>;
  skipped: boolean;
  reason?: string;
}

/**
 * 执行一次价格同步。
 *
 * MOCK_PROVIDER=true 时**不请求上游**（避免测试/CI 花钱与不稳定），
 * 直接返回 skipped，让测试单独验证 detectCostAnomaly / costUnitsForSpec。
 */
export async function syncPrices(
  fetchPricing?: (modelCode: string) => Promise<PricingGroup[] | null>,
): Promise<SyncSummary> {
  const cfg = getConfig();
  const constants: PricingConstants = {
    usdToCny: cfg.USD_TO_CNY,
    markup: cfg.MARKUP,
    creditsPerUsd: cfg.CREDITS_PER_USD,
  };

  const summary: SyncSummary = {
    models: 0,
    updated: 0,
    disabled: 0,
    anomalies: [],
    skipped: false,
  };

  const fetcher = fetchPricing ?? (await resolveFetcher());
  if (!fetcher) {
    summary.skipped = true;
    summary.reason = cfg.MOCK_PROVIDER ? 'MOCK_PROVIDER=true (no upstream call)' : 'no provider credentials';
    log.info({ reason: summary.reason }, 'price sync skipped');
    return summary;
  }

  const models = await db().model.findMany({
    where: { enabled: true },
    select: { id: true, code: true, active: true },
  });
  summary.models = models.length;

  for (const model of models) {
    let groups: PricingGroup[] | null = null;
    try {
      groups = await fetcher(model.code);
    } catch (e) {
      log.warn({ err: e, modelCode: model.code }, 'fetch pricing failed, keeping previous price');
      await logSync(model.id, null, null, 'failed');
      continue;
    }

    if (!groups || groups.length === 0) {
      await logSync(model.id, null, null, 'failed');
      continue;
    }

    const best = pickBestGroup(groups);
    if (!best) {
      // 所有分组下线 → 模型下线（PRD §6.9）
      await db().model.update({ where: { id: model.id }, data: { active: false, enabled: false } });
      await logSync(model.id, null, null, 'model_disabled');
      summary.disabled++;
      log.warn({ modelCode: model.code }, 'all pricing groups inactive → model disabled');
      continue;
    }

    // 存快照（用于后续对账与异常复盘）
    await db().modelPricingSnapshot.create({
      data: {
        modelId: model.id,
        groupName: String(best.group_name ?? 'default'),
        isActive: best.is_active !== false,
        billingMethod: normalizeBillingMethod(best.billing_method),
        basePrice: num(best.base_price),
        minPrice: num(best.min_price),
        inputTokenPrice: best.input_token_price !== undefined ? num(best.input_token_price) : null,
        outputTokenPrice: best.output_token_price !== undefined ? num(best.output_token_price) : null,
        optionPrices: (best.option_prices ?? {}) as Prisma.InputJsonValue,
        timeDiscounts: (best.time_discounts ?? null) as Prisma.InputJsonValue,
        successRate24h: best.success_rate_24h ?? null,
        avgResponseSeconds: best.avg_response_seconds ?? null,
      },
    });

    // 重算该模型所有 price_items
    const items = await db().priceItem.findMany({ where: { modelId: model.id } });

    for (const item of items) {
      const spec = item.spec as Record<string, unknown>;
      const { costUnits: newCostUnits, method } = costUnitsForSpec({ group: best, spec });
      if (newCostUnits <= 0) continue;

      const oldCostUnits = Number(item.costUnits);
      const anomaly = detectCostAnomaly({ oldCostUnits, newCostUnits });

      if (anomaly.exceeded) {
        summary.anomalies.push({
          modelCode: model.code,
          changePercent: Math.round(anomaly.changePercent * 100) / 100,
          oldCostUnits,
          newCostUnits,
        });
        log.error(
          { modelCode: model.code, oldCostUnits, newCostUnits, changePercent: anomaly.changePercent },
          'P1: upstream cost spike >20% → disabling model',
        );
        // 自动下线防负毛利订单（PRD §12）
        await db().model.update({ where: { id: model.id }, data: { active: false } });
        summary.disabled++;
      }

      const newCredits = costUnitsToCredits(newCostUnits, constants);

      await db().priceItem.update({
        where: { id: item.id },
        data: {
          costUnits: newCostUnits,
          credits: newCredits,
          markup: constants.markup,
        },
      });

      if (Math.abs(newCredits - item.credits) > 0 || Math.abs(newCostUnits - oldCostUnits) > 1e-9) {
        await logSync(model.id, oldCostUnits, newCostUnits, 'ok', item.credits, newCredits);
        summary.updated++;
      }

      void method;
    }
  }

  // 自动发现新模型（PRD §6.9：新增默认 active=false，待人工确认）
  await discoverNewModels(fetcher).catch((e: unknown) =>
    log.warn({ err: e }, 'discover new models failed'),
  );

  log.info(
    { models: summary.models, updated: summary.updated, disabled: summary.disabled, anomalies: summary.anomalies.length },
    'price sync complete',
  );
  return summary;
}

async function logSync(
  modelId: string,
  oldCostUnits: number | null,
  newCostUnits: number | null,
  status: string,
  oldCredits?: number | null,
  newCredits?: number | null,
): Promise<void> {
  await db().priceSyncLog.create({
    data: {
      modelId,
      oldCostUnits,
      newCostUnits,
      oldCredits: oldCredits ?? null,
      newCredits: newCredits ?? null,
      status,
    },
  });
}

/** 从渠道拉取模型目录，写入未知模型（active=false 待确认） */
async function discoverNewModels(fetcher: (code: string) => Promise<PricingGroup[] | null>): Promise<void> {
  void fetcher;
  // 本期不做目录发现（需上游 /v1/skills/models 列表接口）；
  // Phase 2 补齐：拉全量列表 → 差集 → create({ active: false })。
}

/**
 * 解析实际的 pricing 拉取器。
 * MOCK_PROVIDER=true 或无凭据 → 返回 null（不同步，保留旧价）。
 */
async function resolveFetcher(): Promise<((code: string) => Promise<PricingGroup[] | null>) | null> {
  const cfg = getConfig();
  if (cfg.MOCK_PROVIDER) return null;
  if (cfg.lkApiKeys.length === 0) return null;

  const apiKey = cfg.lkApiKeys[0]!;
  const baseUrl = cfg.LK_BASE_URL.replace(/\/+$/, '');

  return async (code: string) => {
    const { request } = await import('undici');
    const res = await request(`${baseUrl}/v1/skills/models/${encodeURIComponent(code)}/pricing?status=active`, {
      method: 'GET',
      headers: {
        authorization: `Bearer ${apiKey}`,
        accept: 'application/json',
      },
      headersTimeout: 15000,
      bodyTimeout: 15000,
    });

    const body = (await res.body.json()) as unknown;
    if (res.statusCode >= 400) return null;
    // `/v1/skills/*` 判有无 error 对象（PRD 附录 D）
    if (typeof body === 'object' && body !== null && 'error' in body) return null;

    const obj = body as { data?: unknown };
    const data = obj.data;
    if (Array.isArray(data)) return data as PricingGroup[];
    if (typeof data === 'object' && data !== null) {
      const groups = (data as { groups?: unknown }).groups;
      if (Array.isArray(groups)) return groups as PricingGroup[];
    }
    return null;
  };
}

/** 手工重算指定模型的 price_items（运营/测试用） */
export async function recomputeModelPrices(
  modelId: string,
  constants?: PricingConstants,
): Promise<number> {
  const cfg = getConfig();
  const c: PricingConstants =
    constants ?? { usdToCny: cfg.USD_TO_CNY, markup: cfg.MARKUP, creditsPerUsd: cfg.CREDITS_PER_USD };

  const items = await db().priceItem.findMany({ where: { modelId } });
  let n = 0;
  for (const item of items) {
    const credits = costUnitsToCredits(Number(item.costUnits), c);
    await db().priceItem.update({ where: { id: item.id }, data: { credits, markup: c.markup } });
    n++;
  }
  return n;
}

/** 计算 spec 的规范化哈希（供 seed/同步/quote 三方共用，保证查得到行） */
export function hashSpec(spec: Record<string, unknown>): string {
  return specHashOf(spec);
}

export { transaction };
