/**
 * 定价核心数学（PRD §6）—— 纯函数，被 billing / seed / 价格同步共用。
 *
 * credits = ceil(costUnits × MARKUP × CREDITS_PER_USD ÷ USD_TO_CNY)
 *         = ceil(costUnits × 1.3 × 100 ÷ 6.9)
 *         = ceil(costUnits × 18.84)
 */

import type { BillingMethod, DiscountLine } from './types.js';

export interface PricingConstants {
  usdToCny: number;
  markup: number;
  creditsPerUsd: number;
}

export const DEFAULT_PRICING: PricingConstants = {
  usdToCny: 6.9,
  markup: 1.3,
  creditsPerUsd: 100,
};

/** 积分系数 = MARKUP × CREDITS_PER_USD ÷ USD_TO_CNY（默认 18.84…） */
export function creditFactor(c: PricingConstants = DEFAULT_PRICING): number {
  return (c.markup * c.creditsPerUsd) / c.usdToCny;
}

/**
 * 上游成本（算力）→ 对外积分。
 * 用「放大后四舍五入到 6 位再取整」避免浮点误差把 13 算成 14
 * （如 0.69 × 18.84 = 12.9996… 应为 13）。
 */
export function costUnitsToCredits(costUnits: number, c: PricingConstants = DEFAULT_PRICING): number {
  const raw = costUnits * creditFactor(c);
  const rounded = Math.round(raw * 1e6) / 1e6;
  return Math.max(1, Math.ceil(rounded));
}

// ---------------------------------------------------------------- costUnits 三口径（PRD §6.2）

export interface PerCallCostInput {
  basePrice: number;
  /** 各选项的乘数（如 prime 版 1.5） */
  multipliers?: number[];
  /** 各选项的加价（算力） */
  additions?: number[];
}

/** 【按次】costUnits = base_price × ∏(price_multiplier) + Σ(price_addition) */
export function perCallCostUnits(input: PerCallCostInput): number {
  const mult = (input.multipliers ?? []).reduce((a, b) => a * b, 1);
  const add = (input.additions ?? []).reduce((a, b) => a + b, 0);
  return round6(input.basePrice * mult + add);
}

export interface PerSecondCostInput {
  perSecondPrice: number;
  durationSec: number;
}

/** 【按秒】costUnits = per_second_price × durationSec */
export function perSecondCostUnits(input: PerSecondCostInput): number {
  return round6(input.perSecondPrice * input.durationSec);
}

export interface PerTokenCostInput {
  inputTokens: number;
  outputTokens: number;
  inputTokenPrice: number;
  outputTokenPrice: number;
}

/**
 * 【按token】costUnits = (input_tokens × input_token_price
 *                      + output_tokens × output_token_price) ÷ 1_000_000
 */
export function perTokenCostUnits(input: PerTokenCostInput): number {
  const raw =
    (input.inputTokens * input.inputTokenPrice + input.outputTokens * input.outputTokenPrice) / 1_000_000;
  return round6(raw);
}

/** 视频类每秒等效 token（PRD §6.2） */
export const TOKENS_PER_SECOND: Record<string, number> = {
  '480p': 9600,
  '720p': 21600,
  '1080p': 48600,
  '4K': 194400,
};

/** 视频类 output_tokens ≈ 时长 × 每秒等效 token（含参考视频 ×2.3） */
export function estimateVideoOutputTokens(
  resolution: string,
  durationSec: number,
  hasRefVideo = false,
): number {
  const perSec = TOKENS_PER_SECOND[resolution] ?? TOKENS_PER_SECOND['720p']!;
  const base = perSec * durationSec;
  return Math.round(hasRefVideo ? base * 2.3 : base);
}

export function costUnitsByMethod(
  method: BillingMethod,
  input:
    | ({ method: 'per_call' } & PerCallCostInput)
    | ({ method: 'per_second' } & PerSecondCostInput)
    | ({ method: 'per_token' } & PerTokenCostInput),
): number {
  switch (input.method) {
    case 'per_call':
      return perCallCostUnits(input);
    case 'per_second':
      return perSecondCostUnits(input);
    case 'per_token':
      return perTokenCostUnits(input);
    default: {
      const _exhaustive: never = method as never;
      throw new Error(`unknown billing method: ${String(_exhaustive)}`);
    }
  }
}

// ---------------------------------------------------------------- 折扣层（PRD §6.8）

/**
 * 折扣叠加顺序（详细设计 §1.7）：
 * 标准价 → 限时优惠 → 订阅权益（Pro 9折）→ 优惠券；下限 1 积分。
 * 每层比例折扣「向上取整」，与 PRD "117 → 106" 一致。
 */
export const MIN_CREDITS = 1;

export function applyDiscounts(standardCredits: number, discounts: DiscountLine[]): number {
  let credits = standardCredits;

  for (const d of discounts) {
    if (d.factor !== undefined) {
      credits = Math.ceil(credits * d.factor);
    }
    if (d.amountOff !== undefined) {
      credits = credits - d.amountOff;
    }
  }

  return Math.max(MIN_CREDITS, credits);
}

/**
 * 按固定层序排序折扣（促销 → 订阅 → 优惠券），
 * 保证调用方传入顺序不影响结果。
 */
const DISCOUNT_ORDER: Record<DiscountLine['kind'], number> = {
  promotion: 0,
  plan: 1,
  coupon: 2,
};

export function sortDiscounts(discounts: DiscountLine[]): DiscountLine[] {
  return [...discounts].sort((a, b) => DISCOUNT_ORDER[a.kind] - DISCOUNT_ORDER[b.kind]);
}

/** 折扣类型标签，用于 breakdown.discounts 展示 */
export function discountLabel(kind: DiscountLine['kind']): string {
  switch (kind) {
    case 'promotion':
      return 'promotion';
    case 'plan':
      return 'plan';
    case 'coupon':
      return 'coupon';
  }
}

export function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** 毛利率（详细设计 §6.10）：(settledCredits × 0.069 − costRmb) ÷ (settledCredits × 0.069) */
export const CREDIT_VALUE_CNY = 0.069;

export function marginRate(settledCredits: number, costRmb: number): number {
  const revenueCny = settledCredits * CREDIT_VALUE_CNY;
  if (revenueCny <= 0) return 0;
  return (revenueCny - costRmb) / revenueCny;
}

/** 积分数 → USD（1 USD = 100 积分） */
export function creditsToUsd(credits: number, c: PricingConstants = DEFAULT_PRICING): number {
  return credits / c.creditsPerUsd;
}

/** 年付折扣：$99 得 9000 积分（PRD §6.6） */
export const CREDIT_PACKS = [
  { code: 'starter', priceUsdCents: 499, credits: 500 },
  { code: 'basic', priceUsdCents: 999, credits: 1000 },
  { code: 'pro', priceUsdCents: 2999, credits: 3000 },
  { code: 'max', priceUsdCents: 7999, credits: 7500 },
] as const;
