/**
 * 定价引擎（PRD §6.2 / §6.8 / §6.11 / §6.12，详细设计 §1.7）。
 *
 * 分工：
 *  - `price_items` 查表是**唯一真源**（每日同步写入）。查得到就用它的 costUnits/credits。
 *  - 查不到（新模型/新规格尚未同步）→ 按 PRD §6.2 三口径公式**现算**，标 `estimated: true`。
 *    公式一律复用 `core/pricing-math.ts`，本文件不重写任何一条公式。
 *
 * 折扣叠加顺序（PRD §6.8 / 详细设计 §1.7）：
 *   标准价 → 限时优惠(promotions) → 订阅权益(plan_discount) → 优惠券(user_coupons)，下限 1 积分。
 *   顺序由 `sortDiscounts()` 固定，调用方传入顺序不影响结果。
 */

import type { Prisma } from '@prisma/client';
import { db } from '../../core/db.js';
import { err } from '../../core/errors.js';
import { specHashOf } from '../../core/crypto.js';
import {
  DEFAULT_PRICING,
  applyDiscounts,
  costUnitsToCredits,
  perCallCostUnits,
  perSecondCostUnits,
  perTokenCostUnits,
  sortDiscounts,
  estimateVideoOutputTokens,
  type PricingConstants,
} from '../../core/pricing-math.js';
import type { Capability, DiscountLine, QuoteBreakdown, QuoteResult } from '../../core/types.js';

/**
 * 规格维度键（顺序即规范化顺序）。
 *
 * ⚠️ 必须与价格同步/seed 完全一致：specHash = sha256(canonicalJson(specOf(params)))。
 * 若这里多抽一个键或少抽一个键，quote 就查不到 price_items 行 → 全站回落到 estimated 现算。
 * 只保留 params 中**实际存在**的键，值保持原始类型（数字仍是数字，不转字符串）。
 */
export const SPEC_KEYS = [
  'resolution',
  'durationSec',
  'size',
  'quality',
  'aspectRatio',
  'version',
  'mode',
  'background',
] as const;

export type SpecKey = (typeof SPEC_KEYS)[number];

export type SpecValue = string | number | boolean | string[];
export type Spec = Partial<Record<SpecKey, SpecValue>>;

export interface QuoteInput {
  capability: Capability;
  /** 可选；不传按 capability 取价格最低的 active 模型 */
  modelId?: string;
  params: Record<string, string | number | boolean | string[]>;
  /** 有则算订阅折扣 */
  userId?: string;
}

export interface QuoteForTaskInput {
  taskId: string;
  userId: string;
  capability: Capability;
}

export interface PricingEngine {
  quote(input: QuoteInput): Promise<QuoteResult>;
  quoteForTask(input: QuoteForTaskInput): Promise<QuoteResult>;
}

// ---------------------------------------------------------------- spec 规范化

/**
 * 从 params 抽取规格维度并规范化。
 * 仅保留 SPEC_KEYS 中实际存在的键；值原样保留（数字不转字符串）。
 * `specHashOf` 内部已做 key 排序，所以这里只需保证「键集合与值类型」一致，
 * 输出对象的键顺序不影响 hash。
 */
export function normalizeSpec(params: Record<string, unknown>): Spec {
  const spec: Spec = {};
  for (const key of SPEC_KEYS) {
    const v = params[key];
    if (v === undefined || v === null) continue;
    if (
      typeof v === 'string' ||
      typeof v === 'number' ||
      typeof v === 'boolean' ||
      (Array.isArray(v) && v.every((x) => typeof x === 'string'))
    ) {
      spec[key] = v as SpecValue;
    }
  }
  return spec;
}

/** 规格 → specHash（与 price_items.spec_hash 对齐） */
export function hashSpec(spec: Spec): string {
  return specHashOf(spec as Record<string, unknown>);
}

/** 生成 SKU 展示串，如 `video.720p.10s`。仅用于前端展示与任务快照。 */
export function skuOf(capability: Capability, spec: Spec): string {
  const kind = capability.includes('video')
    ? 'video'
    : capability.includes('image')
      ? 'image'
      : capability.includes('audio') || capability === 'tts' || capability === 'text_to_music'
        ? 'audio'
        : 'other';
  const parts: string[] = [kind];
  if (typeof spec.resolution === 'string') parts.push(spec.resolution.toLowerCase());
  if (typeof spec.size === 'string') parts.push(spec.size.toLowerCase());
  if (typeof spec.quality === 'string') parts.push(spec.quality.toLowerCase());
  if (typeof spec.durationSec === 'number') parts.push(`${spec.durationSec}s`);
  if (typeof spec.background === 'string') parts.push(spec.background.toLowerCase());
  return parts.join('.');
}

// ---------------------------------------------------------------- 折扣

interface PromotionRow {
  id: string;
  scope: string;
  targetId: string | null;
  discount: Prisma.Decimal;
  startsAt: Date;
  endsAt: Date;
}

interface CouponRow {
  id: string;
  code: string;
  discount: Prisma.Decimal;
  /** 未使用（usedAt === null）且未过期才会被 pickBestCoupon 采信 */
  usedAt: Date | null;
  expiresAt: Date;
}

function toNumber(d: Prisma.Decimal | number | null | undefined): number {
  if (d === null || d === undefined) return 0;
  return typeof d === 'number' ? d : Number(d.toString());
}

/**
 * 收集限时优惠（promotions）：scope 为 global / capability / sku，
 * 且 `active=true && startsAt <= now <= endsAt`。
 *
 * 优惠之间**取最优（最小 factor）**而不是连乘——PRD §6.8 把"限时优惠"定义为**一层**，
 * 多层连乘会让 75 折 × 8 折 = 6 折，与运营配置直觉不符，也超出 PRD 语义。
 */
export function pickBestPromotion(
  rows: PromotionRow[],
  capability: Capability,
  modelId: string,
): DiscountLine | null {
  const applicable = rows.filter((p) => {
    switch (p.scope) {
      case 'global':
        return true;
      case 'capability':
        return p.targetId === capability;
      case 'sku':
        return p.targetId === modelId;
      default:
        return false;
    }
  });
  if (applicable.length === 0) return null;

  let best = applicable[0]!;
  for (const p of applicable) {
    if (toNumber(p.discount) < toNumber(best.discount)) best = p;
  }
  return {
    kind: 'promotion',
    ref: best.id,
    factor: toNumber(best.discount),
    label: 'promotion',
  };
}

/** 订阅权益：Pro 的 plan_discount（0.900 = 9 折） */
export function planDiscountLine(planDiscount: Prisma.Decimal | null): DiscountLine | null {
  if (planDiscount === null) return null;
  const factor = toNumber(planDiscount);
  // 1.000 等于没折扣，不产生噪音折扣行
  if (!Number.isFinite(factor) || factor >= 1 || factor <= 0) return null;
  return { kind: 'plan', ref: 'plan_discount', factor, label: 'plan' };
}

/**
 * 优惠券：`discount` 是**直接减免积分数**（PRD §6.8 示例"新用户减 20 积分"，
 * schema 为 Decimal(18,2) 而非 0.xxx 比例）。
 * 多张券取减免最大的一张——一次生成只用一张券，避免"券堆叠"套利。
 */
export function pickBestCoupon(rows: CouponRow[]): DiscountLine | null {
  if (rows.length === 0) return null;
  let best = rows[0]!;
  for (const c of rows) {
    if (toNumber(c.discount) > toNumber(best.discount)) best = c;
  }
  const amountOff = toNumber(best.discount);
  if (!Number.isFinite(amountOff) || amountOff <= 0) return null;
  return { kind: 'coupon', ref: best.id, amountOff, label: best.code };
}

// ---------------------------------------------------------------- 三口径现算

interface PricingRow {
  costUnits: Prisma.Decimal;
  markup: Prisma.Decimal;
  credits: number;
  active: boolean;
}

/**
 * 价格表未命中时的回落计算（PRD §6.2 三口径）。
 *
 * 需要 billing_method，它不在 price_items 上，而在最近的 ModelPricingSnapshot 上
 * （每日同步抓取的渠道报价快照）。没有快照 → 无法可靠估算，抛 MODEL_UNAVAILABLE。
 *
 * 口径公式一律来自 core/pricing-math.ts：
 *   per_call   : base_price × ∏mult + Σadd
 *   per_second : per_second_price × durationSec
 *   per_token  : (in×in_price + out×out_price) ÷ 1e6
 */
export async function computeCostUnits(input: {
  modelId: string;
  capability: Capability;
  spec: Spec;
  params: Record<string, string | number | boolean | string[]>;
}): Promise<{ costUnits: number; markup: number }> {
  const snapshot = await db().modelPricingSnapshot.findFirst({
    where: { modelId: input.modelId, isActive: true },
    orderBy: { capturedAt: 'desc' },
  });
  if (!snapshot) {
    throw err.modelUnavailable([]);
  }

  const durationSec =
    typeof input.spec.durationSec === 'number'
      ? input.spec.durationSec
      : Number(input.params.durationSec ?? 0) || 0;

  switch (snapshot.billingMethod) {
    case 'per_second': {
      const perSec = toNumber(snapshot.minPrice) || toNumber(snapshot.basePrice);
      return { costUnits: perSecondCostUnits({ perSecondPrice: perSec, durationSec }), markup: DEFAULT_PRICING.markup };
    }

    case 'per_call': {
      const optionPrices = (snapshot.optionPrices ?? {}) as {
        multipliers?: Record<string, number>;
        additions?: Record<string, number>;
      };
      const multipliers: number[] = [];
      const additions: number[] = [];
      collectOptionCosts(input.spec, optionPrices, multipliers, additions);
      return {
        costUnits: perCallCostUnits({
          basePrice: toNumber(snapshot.basePrice),
          ...(multipliers.length ? { multipliers } : {}),
          ...(additions.length ? { additions } : {}),
        }),
        markup: DEFAULT_PRICING.markup,
      };
    }

    case 'per_token': {
      const inputTokenPrice = toNumber(snapshot.inputTokenPrice);
      const outputTokenPrice = toNumber(snapshot.outputTokenPrice);
      // 视频类 output_tokens ≈ 时长 × 每秒等效 token（含参考视频 ×2.3）
      const resolution = typeof input.spec.resolution === 'string' ? input.spec.resolution : '720p';
      const hasRefVideo = input.params.hasRefVideo === true || input.capability === 'viral_remix';
      const outputTokens = estimateVideoOutputTokens(resolution, durationSec, hasRefVideo);
      const inputTokens = Number(input.params.inputTokens ?? 0) || 0;
      return {
        costUnits: perTokenCostUnits({ inputTokens, outputTokens, inputTokenPrice, outputTokenPrice }),
        markup: DEFAULT_PRICING.markup,
      };
    }

    default: {
      const _exhaustive: never = snapshot.billingMethod;
      throw err.internal({ billingMethod: String(_exhaustive) });
    }
  }
}

/** 从 spec 命中 option_prices 的乘数/加价（纯函数，便于单测） */
export function collectOptionCosts(
  spec: Spec,
  optionPrices: { multipliers?: Record<string, number>; additions?: Record<string, number> },
  multipliers: number[],
  additions: number[],
): void {
  const multTable = optionPrices.multipliers ?? {};
  const addTable = optionPrices.additions ?? {};

  for (const key of SPEC_KEYS) {
    const v = spec[key];
    if (v === undefined) continue;

    for (const candidate of [`${key}=${String(v)}`, String(v)]) {
      const m = multTable[candidate];
      if (typeof m === 'number' && Number.isFinite(m)) multipliers.push(m);
      const a = addTable[candidate];
      if (typeof a === 'number' && Number.isFinite(a)) additions.push(a);
    }
  }
}

// ---------------------------------------------------------------- 折扣装配

async function loadDiscounts(input: {
  capability: Capability;
  modelId: string;
  userId?: string;
  now: Date;
  constants: PricingConstants;
}): Promise<DiscountLine[]> {
  const { capability, modelId, userId, now } = input;

  // 限时优惠：scope global / capability / sku，且当前生效
  const promos = await db().promotion.findMany({
    where: {
      active: true,
      startsAt: { lte: now },
      endsAt: { gte: now },
      scope: { in: ['global', 'capability', 'sku'] },
      OR: [{ targetId: null }, { targetId: capability }, { targetId: modelId }],
    },
  });
  const promotion = pickBestPromotion(promos, capability, modelId);

  let plan: DiscountLine | null = null;
  let coupon: DiscountLine | null = null;

  if (userId) {
    // 订阅权益：当前 active 订阅对应 plan 的 plan_discount
    const sub = await db().subscription.findFirst({
      where: { userId, status: 'active', currentPeriodEnd: { gt: now } },
      include: { plan: true },
      orderBy: { currentPeriodStart: 'desc' },
    });
    if (sub?.plan) {
      plan = planDiscountLine(sub.plan.planDiscount);
    }

    // 优惠券：未使用、未过期
    const coupons = await db().userCoupon.findMany({
      where: { userId, usedAt: null, expiresAt: { gt: now } },
      orderBy: { discount: 'desc' },
      take: 10,
    });
    coupon = pickBestCoupon(coupons);
  }

  return [promotion, plan, coupon].filter((d): d is DiscountLine => d !== null);
}

// ---------------------------------------------------------------- 引擎

/**
 * 选模型：显式 `modelId` 校验 active；否则取该能力下价格最低的 active 模型。
 *
 * `modelId` 同时接受两种形态（PRD §6.11 的示例用的是模型 code，如 `gk-video-3`；
 * 而 `GET /v1/catalog/models` 下发的是 DB UUID）：
 *   1. DB UUID（catalog 下发的 `id`）—— 走主键查询；
 *   2. 模型 code（上游代号，如 `gk-video-3`）—— 按 code 查询，方便脚本/文档直接用 code 调。
 * 两者都查不到 → 409 MODEL_UNAVAILABLE。
 */
async function resolveModel(input: {
  capability: Capability;
  modelId?: string;
}): Promise<{ id: string; code: string; displayName: string }> {
  if (input.modelId) {
    // 先按 id 查（catalog 下发的 UUID），查不到再按 code 查（PRD §6.11 示例里的 `gk-video-3`）。
    //
    // ⚠️ 两次查询都必须包住 PG 的 UUID 转换错误：
    //   `models.id` 是 UUID 列，若传入 `gk-video-3` 这类非 UUID 字符串，
    //   PostgreSQL 会在**类型转换阶段**直接报错（PrismaClientKnownRequestError:
    //   "Error creating UUID, invalid character"），而不是安静地返回 0 行。
    //   同理 `code` 是 text 列，传 UUID 字符串本身不会报错，但为对称起见同样防御。
    // 因此用 tryFind 把"类型不合法"视为"没查到"，继续尝试下一个字段。
    let model = await tryFindModel({ id: input.modelId });

    if (!model) {
      model = await tryFindModel({ code: input.modelId });
    }

    if (!model) throw err.modelUnavailable([]);
    return model;
  }

  // 未指定模型：取该能力下「最便宜的 active 规格」所属模型（PRD §6.11 默认选价最低）
  const cheapest = await db().priceItem.findFirst({
    where: { capability: input.capability, active: true, model: { active: true, enabled: true } },
    orderBy: [{ credits: 'asc' }],
    include: { model: { select: { id: true, code: true, displayName: true } } },
  });
  if (!cheapest) throw err.modelUnavailable([]);
  return cheapest.model;
}


/**
 * 最具体子集价格行（①b 回退）。
 *
 * 在 (modelId, capability) 的有效价格行中，找"行内每个键值都被请求 spec 覆盖"
 * 的行；多个命中时键数最多者胜出（更具体），键数相同则取积分最低者。
 * 行 spec 为空或请求缺键/值不等则不命中。'auto' 按字面量参与比较
 * （价格表里没有 auto 行，所以 auto 请求仍走 ② 现算/409，不会悄悄按低价成交）。
 */
async function findSubsetPriceRow(input: {
  modelId: string;
  capability: Capability;
  spec: Spec;
}): Promise<PricingRow | null> {
  const rows = await db().priceItem.findMany({
    where: { modelId: input.modelId, capability: input.capability, active: true },
    select: { spec: true, costUnits: true, markup: true, credits: true, active: true },
  });
  const want = input.spec as Record<string, unknown>;
  let best: (PricingRow & { keyCount: number }) | null = null;
  for (const r of rows) {
    const rs = (r.spec ?? {}) as Record<string, unknown>;
    const keys = Object.keys(rs);
    if (keys.length === 0) continue;
    let covered = true;
    for (const k of keys) {
      if (want[k] !== rs[k]) {
        covered = false;
        break;
      }
    }
    if (!covered) continue;
    if (
      !best ||
      keys.length > best.keyCount ||
      (keys.length === best.keyCount && r.credits < best.credits)
    ) {
      best = {
        costUnits: r.costUnits,
        markup: r.markup,
        credits: r.credits,
        active: r.active,
        keyCount: keys.length,
      };
    }
  }
  return best;
}

async function buildQuote(input: {
  capability: Capability;
  model: { id: string; code: string; displayName: string };  spec: Spec;
  /** 原始 params：现算按 token 口径时需要 inputTokens/hasRefVideo 等非规格键 */
  params: Record<string, string | number | boolean | string[]>;
  userId?: string;
  constants: PricingConstants;
  now: Date;
}): Promise<QuoteResult> {
  const { capability, model, spec, params, userId, constants, now } = input;
  const specHash = hashSpec(spec);

  // ① 查表：price_items(model, capability, specHash) 是唯一真源
  const row: PricingRow | null = await db().priceItem.findUnique({
    where: { modelId_capability_specHash: { modelId: model.id, capability, specHash } },
    select: { costUnits: true, markup: true, credits: true, active: true },
  });

  // ①b 子集回退：请求常带"非价格维度"（如生图模型的 quality / aspectRatio / version，
  //     只影响上游生成效果，不影响按次计价），精确 hash 会失配。此时在该模型该能力
  //     的有效价格行里找"被请求完全覆盖的最具体一行"（行内每个键值都与请求一致，
  //     键数最多者胜出，如 {resolution:2K,background:transparent} 优先于 {resolution:2K}）。
  //     命中则同样视为查表价（estimated=false）；找不到才走 ② 现算。
  const subsetRow: PricingRow | null =
    row && row.active ? null : await findSubsetPriceRow({ modelId: model.id, capability, spec });

  const hit: PricingRow | null = row && row.active ? row : subsetRow;

  let costUnits: number;
  let markup: number;
  let standardCredits: number;
  let estimated: boolean;

  if (hit) {
    costUnits = toNumber(hit.costUnits);
    markup = toNumber(hit.markup) || constants.markup;
    // 表里的 credits 是唯一真源；但若历史行与公式漂移，以公式为准重算并保留表值更保守。
    // 这里严格用表值（PRD §6.2「查表为准」）。
    standardCredits = hit.credits;
    estimated = false;
  } else {
    // ② 未命中 → 按三口径公式现算
    //    注意传原始 params（而不是 spec）：per_token 口径要用 inputTokens、
    //    hasRefVideo 这类**非规格维度**的键，spec 里没有它们。
    const computed = await computeCostUnits({
      modelId: model.id,
      capability,
      spec,
      params,
    });
    costUnits = computed.costUnits;
    markup = computed.markup;
    standardCredits = costUnitsToCredits(costUnits, constants);
    estimated = true;
  }

  // ③ 折扣：限时优惠 → 订阅 → 优惠券（顺序由 sortDiscounts 固定）
  const rawDiscounts = await loadDiscounts({ capability, modelId: model.id, userId, now, constants });
  const discounts = sortDiscounts(rawDiscounts);
  const credits = applyDiscounts(standardCredits, discounts);

  const breakdown: QuoteBreakdown = {
    costUnits,
    markup,
    standardCredits,
    discounts,
    credits,
  };

  return {
    sku: skuOf(capability, spec),
    modelId: model.id,
    modelCode: model.code,
    displayName: model.displayName,
    capability,
    credits,
    breakdown,
    estimated,
  };
}

function pricingConstants(): PricingConstants {
  // 三常数可由运营通过环境变量调整（config.ts USD_TO_CNY / MARKUP / CREDITS_PER_USD）
  // 这里直接读 config，保证 quote 与每日同步用同一套系数。
  try {
    // 延迟导入避免测试环境未设 env 时崩溃
    const cfg = getPricingConstants();
    return { usdToCny: cfg.usdToCny, markup: cfg.markup, creditsPerUsd: cfg.creditsPerUsd };
  } catch {
    return DEFAULT_PRICING;
  }
}

let cachedConstants: PricingConstants | null = null;

function getPricingConstants(): PricingConstants {
  if (cachedConstants) return cachedConstants;
  // 动态读取，避免与 config 模块形成循环静态依赖
  const env = process.env;
  const usdToCny = Number(env.USD_TO_CNY ?? DEFAULT_PRICING.usdToCny) || DEFAULT_PRICING.usdToCny;
  const markup = Number(env.MARKUP ?? DEFAULT_PRICING.markup) || DEFAULT_PRICING.markup;
  const creditsPerUsd = Number(env.CREDITS_PER_USD ?? DEFAULT_PRICING.creditsPerUsd) || DEFAULT_PRICING.creditsPerUsd;
  cachedConstants = { usdToCny, markup, creditsPerUsd };
  return cachedConstants;
}

/** 测试用：重置已缓存的定价系数 */
export function resetPricingConstants(): void {
  cachedConstants = null;
}

/**
 * 按条件查模型；**把 PG 的类型转换错误当作"没查到"**。
 *
 * 为什么必须这样：`models.id` 是 UUID 列，传非 UUID 字符串时 PostgreSQL 会在
 * 类型转换阶段抛错（而不是返回空结果），若不捕获会把 400 语义退化成 500。
 * 只有"类型非法"才吞掉；其他数据库错误照常上抛（不能掩盖真实故障）。
 */
async function tryFindModel(
  where: { id: string } | { code: string },
): Promise<{ id: string; code: string; displayName: string } | null> {
  try {
    return await db().model.findFirst({
      where: { ...where, active: true, enabled: true },
      select: { id: true, code: true, displayName: true },
    });
  } catch (e) {
    if (isInvalidUuidError(e)) {
      // 非 UUID 字符串查 id 列：属于"这个键不是 id"，安静地继续尝试 code
      return null;
    }
    throw e;
  }
}

/** Prisma 在 UUID 列收到非法字符串时报 P2023（Inconsistent column data） */
function isInvalidUuidError(e: unknown): boolean {
  if (typeof e !== 'object' || e === null) return false;
  const code = (e as { code?: string }).code;
  const meta = (e as { meta?: unknown }).meta;
  const message = String(
    (typeof meta === 'object' && meta && 'message' in meta ? (meta as { message: unknown }).message : '') ??
      (e as { message?: string }).message ??
      '',
  );
  return code === 'P2023' || message.includes('invalid character') || message.includes('Invalid UUID');
}

export const pricingEngine: PricingEngine = {
  /**
   * 报价（PRD §6.11）。
   * 同一规格不同模型必须报价不同：因为查表键含 modelId，且现算走各模型自己的成本口径。
   */
  async quote(input: QuoteInput): Promise<QuoteResult> {
    const now = new Date();
    const constants = pricingConstants();
    const model = await resolveModel({ capability: input.capability, modelId: input.modelId });
    const spec = normalizeSpec(input.params);

    return buildQuote({
      capability: input.capability,
      model,
      spec,
      params: input.params,
      ...(input.userId ? { userId: input.userId } : {}),
      constants,
      now,
    });
  },

  /**
   * 按任务算报价（Worker 结算 / 重算用）。
   * 走任务落库的 params 与 modelId，保证与提交时同一把尺子。
   */
  async quoteForTask(input: QuoteForTaskInput): Promise<QuoteResult> {
    const task = await db().task.findUnique({
      where: { id: input.taskId },
      select: { modelId: true, capability: true, params: true, userId: true },
    });
    if (!task) throw err.notFound({ taskId: input.taskId });

    const params = (task.params ?? {}) as Record<string, string | number | boolean | string[]>;
    const model = await resolveModel({
      capability: input.capability,
      modelId: task.modelId,
    });

    return buildQuote({
      capability: input.capability,
      model,
      spec: normalizeSpec(params),
      params,
      userId: input.userId,
      constants: pricingConstants(),
      now: new Date(),
    });
  },
};

export { toNumber as decimalToNumber };
