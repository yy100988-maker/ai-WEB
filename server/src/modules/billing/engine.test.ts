/**
 * PricingEngine 单元测试（详细设计 §7.2 / PRD §13 #19）。
 *
 * 全部用 vi.mock('../../core/db.js') 提供内存假实现，**不连真实 DB**。
 * 覆盖：
 *  - 三口径公式全组合（按次/按秒/按token）
 *  - ceil 边界（0.69×系数 = 12.9996 → 13，不能是 14；58.47 同类边界）
 *  - 折扣叠加顺序 + 1 积分下限（117 → Pro 9 折 106）
 *  - §13 #19 模型差异化定价（gk-video-3 10s=13 / hailuo-h3 768P 10s=16 /
 *    hailuo-h3-quannengcankao 1080P 10s=32，三者互不相同且 == ceil(成本×系数)）
 *  - spec 规范化 + specHash 稳定性（key 顺序不同 → 同 hash）
 */

import { describe, expect, it, beforeEach, vi } from 'vitest';
import type { Prisma } from '@prisma/client';
import type { Capability } from '../../core/types.js';
import {
  costUnitsToCredits,
  perCallCostUnits,
  perSecondCostUnits,
  perTokenCostUnits,
  applyDiscounts,
  sortDiscounts,
  MIN_CREDITS,
} from '../../core/pricing-math.js';
import { specHashOf } from '../../core/crypto.js';

// ---------------------------------------------------------------- 内存 DB 假实现
//
// 表结构只保留 engine 用到的字段。测试通过 seedModel 等函数注入数据。

interface FakeModel {
  id: string;
  code: string;
  displayName: string;
  active: boolean;
  enabled: boolean;
}

interface FakePriceItem {
  modelId: string;
  capability: string;
  specHash: string;
  spec: Record<string, unknown>;
  costUnits: Prisma.Decimal;
  markup: Prisma.Decimal;
  credits: number;
  active: boolean;
}

interface FakePromotion {
  id: string;
  scope: string;
  targetId: string | null;
  discount: Prisma.Decimal;
  startsAt: Date;
  endsAt: Date;
  active: boolean;
}

interface FakeCoupon {
  id: string;
  code: string;
  discount: Prisma.Decimal;
  usedAt: Date | null;
  expiresAt: Date;
}

interface FakeSubscription {
  userId: string;
  status: string;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  plan: { planDiscount: Prisma.Decimal | null; code: string } | null;
}

interface FakeSnapshot {
  modelId: string;
  isActive: boolean;
  billingMethod: 'per_call' | 'per_second' | 'per_token';
  basePrice: Prisma.Decimal;
  minPrice: Prisma.Decimal;
  inputTokenPrice: Prisma.Decimal | null;
  outputTokenPrice: Prisma.Decimal | null;
  optionPrices: unknown;
  capturedAt: Date;
}

interface Tables {
  models: FakeModel[];
  priceItems: FakePriceItem[];
  promotions: FakePromotion[];
  coupons: FakeCoupon[];
  subscriptions: FakeSubscription[];
  snapshots: FakeSnapshot[];
}

const tables: Tables = {
  models: [],
  priceItems: [],
  promotions: [],
  coupons: [],
  subscriptions: [],
  snapshots: [],
};

function resetTables(): void {
  tables.models = [];
  tables.priceItems = [];
  tables.promotions = [];
  tables.coupons = [];
  tables.subscriptions = [];
  tables.snapshots = [];
}

/**
 * 源码里的纯函数只用到了 `Number(d.toString())` 这一个 Decimal 能力，
 * 因此测试用最小替身即可，无需引入真实 Prisma Decimal 实例。
 */
function asDecimal(n: number): Prisma.Decimal {
  return { toString: () => String(n) } as unknown as Prisma.Decimal;
}

const dec = asDecimal;

const fakeDb = {
  model: {
    findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
      // engine 的 resolveModel 允许按 **id（UUID）** 或 **code（如 gk-video-3）** 定位模型，
      // 因此这里两种条件都要支持。
      const found = tables.models.find((m) => {
        if (where.id !== undefined && m.id !== where.id) return false;
        if (where.code !== undefined && m.code !== where.code) return false;
        if (where.active !== undefined && m.active !== where.active) return false;
        if (where.enabled !== undefined && m.enabled !== where.enabled) return false;
        return true;
      });
      return found ? { id: found.id, code: found.code, displayName: found.displayName } : null;
    }),
    findUnique: vi.fn(async ({ where }: { where: { id: string; code?: string } }) => {
      return (
        tables.models.find((m) =>
          where.code !== undefined ? m.code === where.code : m.id === where.id,
        ) ?? null
      );
    }),
    findMany: vi.fn(async () => tables.models),
  },

  priceItem: {
    // engine 用 modelId_capability_specHash 复合唯一键查行
    findUnique: vi.fn(
      async ({
        where,
      }: {
        where: { modelId_capability_specHash: { modelId: string; capability: string; specHash: string } };
      }) => {
        const k = where.modelId_capability_specHash;
        const found = tables.priceItems.find(
          (p) => p.modelId === k.modelId && p.capability === k.capability && p.specHash === k.specHash,
        );
        return found
          ? {
              costUnits: found.costUnits,
              markup: found.markup,
              credits: found.credits,
              active: found.active,
            }
          : null;
      },
    ),
    // resolveModel 未指定模型时取「最便宜 active 行」
    findFirst: vi.fn(
      async ({
        where,
        orderBy,
      }: {
        where: { capability: string; active: boolean; model: { active: boolean; enabled: boolean } };
        orderBy: Array<{ credits: 'asc' | 'desc' }>;
      }) => {
        const rows = tables.priceItems.filter((p) => {
          if (p.capability !== where.capability) return false;
          if (p.active !== where.active) return false;
          const m = tables.models.find((x) => x.id === p.modelId);
          if (!m) return false;
          if (m.active !== where.model.active) return false;
          if (m.enabled !== where.model.enabled) return false;
          return true;
        });
        if (rows.length === 0) return null;
        const asc = orderBy[0]?.credits === 'asc';
        rows.sort((a, b) => (asc ? a.credits - b.credits : b.credits - a.credits));
        const top = rows[0]!;
        const m = tables.models.find((x) => x.id === top.modelId)!;
        return { model: { id: m.id, code: m.code, displayName: m.displayName } };
      },
    ),
    findMany: vi.fn(async ({ where }: { where: { modelId?: string; capability?: string; active: boolean } }) => {
      return tables.priceItems
        .filter(
          (p) =>
            p.active === where.active &&
            (where.capability === undefined || p.capability === where.capability) &&
            (where.modelId === undefined || p.modelId === where.modelId),
        )
        .map((p) => ({
          spec: p.spec,
          costUnits: p.costUnits,
          markup: p.markup,
          credits: p.credits,
          active: p.active,
        }));
    }),
  },

  promotion: {
    findMany: vi.fn(async () => tables.promotions.filter((p) => p.active)),
  },

  userCoupon: {
    findMany: vi.fn(async () => tables.coupons),
  },

  subscription: {
    findFirst: vi.fn(async ({ where }: { where: { userId: string } }) => {
      return tables.subscriptions.find((s) => s.userId === where.userId && s.status === 'active') ?? null;
    }),
  },

  modelPricingSnapshot: {
    findFirst: vi.fn(async ({ where }: { where: { modelId: string; isActive: boolean } }) => {
      const rows = tables.snapshots
        .filter((s) => s.modelId === where.modelId && s.isActive === where.isActive)
        .sort((a, b) => b.capturedAt.getTime() - a.capturedAt.getTime());
      return rows[0] ?? null;
    }),
  },
};

vi.mock('../../core/db.js', () => ({
  db: () => fakeDb,
  transaction: async <T>(fn: (tx: unknown) => Promise<T>) => fn(fakeDb),
  disconnectDb: async () => undefined,
}));

// 必须在 mock 之后导入被测模块
const { pricingEngine, normalizeSpec, hashSpec, skuOf, pickBestPromotion, pickBestCoupon, planDiscountLine } =
  await import('./engine.js');

// ---------------------------------------------------------------- 三口径公式

describe('三口径 costUnits 公式（PRD §6.2）', () => {
  it('按次：base_price × ∏multiplier + Σaddition', () => {
    expect(perCallCostUnits({ basePrice: 2.5 })).toBe(2.5);
    // 单选乘数（wan3.0 prime ×1.5）
    expect(perCallCostUnits({ basePrice: 2.5, multipliers: [1.5] })).toBe(3.75);
    // 多乘数连乘 + 多加法累加
    expect(perCallCostUnits({ basePrice: 2, multipliers: [1.5, 2], additions: [0.1, 0.2] })).toBe(6.3);
    // 纯加法
    expect(perCallCostUnits({ basePrice: 0.5, additions: [0.2, 0.3] })).toBe(1);
  });

  it('按秒：per_second_price × durationSec', () => {
    expect(perSecondCostUnits({ perSecondPrice: 0.069, durationSec: 10 })).toBeCloseTo(0.69, 10);
    expect(perSecondCostUnits({ perSecondPrice: 0.0828, durationSec: 10 })).toBeCloseTo(0.828, 10);
    expect(perSecondCostUnits({ perSecondPrice: 0.0828, durationSec: 15 })).toBeCloseTo(1.242, 10);
    expect(perSecondCostUnits({ perSecondPrice: 0.1656, durationSec: 10 })).toBeCloseTo(1.656, 10);
  });

  it('按token：(in×in_price + out×out_price) ÷ 1e6', () => {
    // 720p 10s = 21600×10 = 216000 output tokens，out price 0.5 → 0.108
    expect(
      perTokenCostUnits({ inputTokens: 0, outputTokens: 216_000, inputTokenPrice: 0, outputTokenPrice: 0.5 }),
    ).toBeCloseTo(0.108, 10);
    // 输入 + 输出同时计费
    expect(
      perTokenCostUnits({ inputTokens: 1000, outputTokens: 1000, inputTokenPrice: 1, outputTokenPrice: 2 }),
    ).toBeCloseTo(0.003, 10);
    // 全零 → 0
    expect(perTokenCostUnits({ inputTokens: 0, outputTokens: 0, inputTokenPrice: 1, outputTokenPrice: 1 })).toBe(0);
  });

  it('三口径全组合 收敛到同一 credits 公式', () => {
    const cf = (cost: number) => costUnitsToCredits(cost);

    // 按次
    expect(cf(perCallCostUnits({ basePrice: 0.5 }))).toBe(cf(0.5));
    // 按秒
    expect(cf(perSecondCostUnits({ perSecondPrice: 0.069, durationSec: 10 }))).toBe(cf(0.69));
    // 按token（构造出与按秒等价的 0.69 成本）
    expect(
      cf(
        perTokenCostUnits({
          inputTokens: 0,
          outputTokens: 216_000,
          inputTokenPrice: 0,
          outputTokenPrice: 0.69 / 0.216,
        }),
      ),
    ).toBe(cf(0.69));
  });
});

// ---------------------------------------------------------------- ceil 边界

describe('ceil 边界（浮点陷阱回归）', () => {
  it('0.69 × 系数 = 12.9996… → 13（绝不能是 14）', () => {
    // 裸浮点：0.69 × 18.84 = 12.999599999999999156
    expect(0.69 * 18.84).toBeLessThan(13);
    expect(costUnitsToCredits(0.69)).toBe(13);
  });

  it('已知浮点值不被误进位', () => {
    // 0.828×18.84 = 15.599519999999998 → 16
    expect(costUnitsToCredits(0.828)).toBe(16);
    // 1.656×18.84 = 31.199039999999997 → 32
    expect(costUnitsToCredits(1.656)).toBe(32);
    // 0.414×18.84 = 7.79976 → 8
    expect(costUnitsToCredits(0.414)).toBe(8);
    // 1.242×18.84 = 23.39928 → 24
    expect(costUnitsToCredits(1.242)).toBe(24);
  });

  it('58.47 → 1102（与文档 58.47→59 同类的取整语义）', () => {
    // 58.47 × 18.8405… = 1101.608… → ceil = 1102
    expect(costUnitsToCredits(58.47)).toBe(1102);
  });

  it('严格单调：costUnits 增大，credits 不减', () => {
    const a = costUnitsToCredits(0.0531);
    const b = costUnitsToCredits(0.05307);
    expect(a).toBeGreaterThanOrEqual(b);
  });

  it('恰好整数倍的 costUnits 不额外进位', () => {
    // 注意：真实信用系数是 1.3×100÷6.9 = 18.840579710144926，不是近似写法 18.84。
    // 用 18.84 反推 costUnits 会偏小，导致 ceil 结果偏大 1 —— 这正是最容易踩的坑。
    const factor = (1.3 * 100) / 6.9;
    expect(factor).toBeGreaterThan(18.84);
    expect(costUnitsToCredits(13 / factor)).toBe(13);
    expect(costUnitsToCredits(16 / factor)).toBe(16);
    expect(costUnitsToCredits(32 / factor)).toBe(32);
  });

  it('下限 1 积分：costUnits=0 或负数也返回 1', () => {
    expect(costUnitsToCredits(0)).toBe(1);
    expect(costUnitsToCredits(-5)).toBe(1);
    expect(costUnitsToCredits(0.0001)).toBe(1);
  });
});

// ---------------------------------------------------------------- 折扣叠加

describe('折扣叠加顺序与 1 积分下限（PRD §6.8）', () => {
  it('Pro 9 折向上取整：117 → 106', () => {
    const discounts = sortDiscounts([{ kind: 'plan', ref: 'plan_discount', factor: 0.9 }]);
    expect(applyDiscounts(117, discounts)).toBe(106); // ceil(105.3) = 106
  });

  it('叠加顺序固定：promotion → plan → coupon（传入乱序结果相同）', () => {
    const promo = { kind: 'promotion', ref: 'p1', factor: 0.75 } as const;
    const plan = { kind: 'plan', ref: 'plan_discount', factor: 0.9 } as const;
    const coupon = { kind: 'coupon', ref: 'c1', amountOff: 5 } as const;

    const order1 = sortDiscounts([coupon, plan, promo]);
    const order2 = sortDiscounts([promo, coupon, plan]);
    const order3 = sortDiscounts([plan, promo, coupon]);

    expect(order1.map((d) => d.kind)).toEqual(['promotion', 'plan', 'coupon']);
    expect(order2.map((d) => d.kind)).toEqual(['promotion', 'plan', 'coupon']);
    expect(order3.map((d) => d.kind)).toEqual(['promotion', 'plan', 'coupon']);

    const v1 = applyDiscounts(117, order1);
    const v2 = applyDiscounts(117, order2);
    const v3 = applyDiscounts(117, order3);
    expect(v1).toBe(v2);
    expect(v2).toBe(v3);
    // ceil(117×0.75)=88 → ceil(88×0.9)=80 → 80−5=75
    expect(v1).toBe(75);
  });

  it('1 积分下限：叠加巨额优惠券也不低于 1', () => {
    const discounts = sortDiscounts([
      { kind: 'plan', ref: 'p', factor: 0.9 },
      { kind: 'coupon', ref: 'c', amountOff: 999 },
    ]);
    expect(applyDiscounts(117, discounts)).toBe(MIN_CREDITS);

    // 标准价本身为 1 时，比例折扣不会把它降到 0
    expect(applyDiscounts(1, [{ kind: 'plan', ref: 'p', factor: 0.5 }])).toBe(MIN_CREDITS);
  });

  it('空折扣返回标准价原值', () => {
    expect(applyDiscounts(117, [])).toBe(117);
  });
});

// ---------------------------------------------------------------- 折扣行选取

describe('折扣行选取', () => {
  const now = new Date('2026-01-01T00:00:00Z');

  it('促销取最优（最小 factor），scope 支持 global/capability/sku', () => {
    const rows: FakePromotion[] = [
      {
        id: 'p-global',
        scope: 'global',
        targetId: null,
        discount: dec(0.9),
        startsAt: now,
        endsAt: now,
        active: true,
      },
      {
        id: 'p-cap',
        scope: 'capability',
        targetId: 'text_to_video',
        discount: dec(0.8),
        startsAt: now,
        endsAt: now,
        active: true,
      },
      { id: 'p-sku', scope: 'sku', targetId: 'm1', discount: dec(0.85), startsAt: now, endsAt: now, active: true },
      // 不匹配的能力不参与
      {
        id: 'p-other',
        scope: 'capability',
        targetId: 'tts',
        discount: dec(0.1),
        startsAt: now,
        endsAt: now,
        active: true,
      },
    ];
    const best = pickBestPromotion(rows, 'text_to_video', 'm1');
    expect(best?.ref).toBe('p-cap');
    expect(best?.factor).toBeCloseTo(0.8, 10);
    expect(best?.kind).toBe('promotion');
  });

  it('无匹配促销返回 null', () => {
    const rows: FakePromotion[] = [
      {
        id: 'x',
        scope: 'capability',
        targetId: 'tts',
        discount: dec(0.5),
        startsAt: now,
        endsAt: now,
        active: true,
      },
    ];
    expect(pickBestPromotion(rows, 'text_to_video', 'm1')).toBeNull();
  });

  it('订阅折扣：1.000 与 null 都不产生折扣行', () => {
    expect(planDiscountLine(null)).toBeNull();
    expect(planDiscountLine(dec(1))).toBeNull();
    expect(planDiscountLine(dec(0.9))?.factor).toBeCloseTo(0.9, 10);
  });

  it('优惠券是直接减免积分数，取减免最大的一张', () => {
    const rows: FakeCoupon[] = [
      { id: 'c1', code: 'NEW20', discount: dec(20), usedAt: null, expiresAt: now },
      { id: 'c2', code: 'BIG50', discount: dec(50), usedAt: null, expiresAt: now },
    ];
    const best = pickBestCoupon(rows);
    expect(best?.ref).toBe('c2');
    expect(best?.amountOff).toBe(50);
    expect(best?.label).toBe('BIG50');
  });

  it('无券或券额为 0 返回 null', () => {
    expect(pickBestCoupon([])).toBeNull();
    expect(pickBestCoupon([{ id: 'c', code: 'X', discount: dec(0), usedAt: null, expiresAt: now }])).toBeNull();
  });
});

// ---------------------------------------------------------------- spec 规范化

describe('spec 规范化与 specHash 稳定性', () => {
  it('只抽取 SPEC_KEYS 中实际存在的键，值保持原始类型', () => {
    const spec = normalizeSpec({
      resolution: '768P',
      durationSec: 10,
      prompt: '一只猫', // 非规格键，必须丢弃
      model: 'x',
      seed: 42,
    });
    expect(spec).toEqual({ resolution: '768P', durationSec: 10 });
    expect(typeof spec.durationSec).toBe('number'); // 数字仍是数字，不转字符串
  });

  it('null/undefined 键被剔除', () => {
    const spec = normalizeSpec({
      resolution: '768P',
      durationSec: undefined,
      quality: null as unknown as string,
    });
    expect(spec).toEqual({ resolution: '768P' });
  });

  it('key 顺序不同 → 同 hash（canonicalJson 已排序）', () => {
    const a = normalizeSpec({ resolution: '1080P', durationSec: 10 });
    const b = normalizeSpec({ durationSec: 10, resolution: '1080P' });
    expect(hashSpec(a)).toBe(hashSpec(b));
    expect(specHashOf({ durationSec: 10, resolution: '1080P' })).toBe(
      specHashOf({ resolution: '1080P', durationSec: 10 }),
    );
  });

  it('数字 10 与字符串 "10" 是不同规格（类型参与 hash）', () => {
    const num = normalizeSpec({ durationSec: 10 });
    const str = normalizeSpec({ durationSec: '10' });
    expect(hashSpec(num)).not.toBe(hashSpec(str));
  });

  it('不同规格 → 不同 hash；空规格 hash 稳定', () => {
    expect(hashSpec(normalizeSpec({ resolution: '768P' }))).not.toBe(
      hashSpec(normalizeSpec({ resolution: '1080P' })),
    );
    expect(hashSpec({})).toBe(specHashOf({}));
  });

  it('skuOf 生成可读串', () => {
    expect(skuOf('text_to_video', { resolution: '720P', durationSec: 10 })).toBe('video.720p.10s');
    expect(skuOf('text_to_image', { size: '2K' })).toBe('image.2k');
  });
});

// ---------------------------------------------------------------- §13 #19 模型差异化定价

/**
 * 依据 PRD §6.3 价目表构造 mock price_items，断言引擎「查表为准」且
 * 同规格不同模型报价必须不同（§13 #19 硬性验收）。
 *
 * 表值来源（均为 ceil(成本 × 信用系数)）：
 *   gk-video-3 10s                     : 0.069  × 10 = 0.69  → 13
 *   hailuo-h3 768P 10s                 : 0.0828 × 10 = 0.828 → 16
 *   hailuo-h3-quannengcankao 1080P 10s : 0.1656 × 10 = 1.656 → 32
 */
describe('§13 #19 模型差异化定价', () => {
  const TV: Capability = 'text_to_video';

  /** 写入假库一条 (model, spec, costUnits)；credits 一律按公式现算，避免手抄错 */
  function seedModel(input: {
    id: string;
    code: string;
    displayName: string;
    spec: Record<string, unknown>;
    costUnits: number;
  }): number {
    tables.models.push({
      id: input.id,
      code: input.code,
      displayName: input.displayName,
      active: true,
      enabled: true,
    });
    const credits = costUnitsToCredits(input.costUnits);
    tables.priceItems.push({
      modelId: input.id,
      capability: TV,
      specHash: specHashOf(input.spec),
      spec: input.spec,
      costUnits: dec(input.costUnits),
      markup: dec(1.3),
      credits,
      active: true,
    });
    return credits;
  }

  beforeEach(() => {
    resetTables();

    seedModel({
      id: 'm-gk',
      code: 'gk-video-3',
      displayName: 'GK Video 3',
      spec: { durationSec: 10 },
      costUnits: 0.069 * 10,
    });

    seedModel({
      id: 'm-hailuo',
      code: 'hailuo-h3',
      displayName: 'Hailuo H3',
      spec: { resolution: '768P', durationSec: 10 },
      costUnits: 0.0828 * 10,
    });

    seedModel({
      id: 'm-hailuo-ref',
      code: 'hailuo-h3-quannengcankao',
      displayName: 'Hailuo H3 Universal Reference',
      spec: { resolution: '1080P', durationSec: 10 },
      costUnits: 0.1656 * 10,
    });
  });

  it('gk-video-3 10s = 13（查表）', async () => {
    const q = await pricingEngine.quote({ capability: TV, modelId: 'm-gk', params: { durationSec: 10 } });
    expect(q.credits).toBe(13);
    expect(q.estimated).toBe(false);
    expect(q.breakdown.costUnits).toBeCloseTo(0.69, 10);
    expect(q.breakdown.standardCredits).toBe(13);
    expect(q.modelCode).toBe('gk-video-3');
  });

  it('hailuo-h3 768P 10s = 16（查表）', async () => {
    const q = await pricingEngine.quote({
      capability: TV,
      modelId: 'm-hailuo',
      params: { resolution: '768P', durationSec: 10 },
    });
    expect(q.credits).toBe(16);
    expect(q.estimated).toBe(false);
    expect(q.breakdown.costUnits).toBeCloseTo(0.828, 10);
  });

  it('hailuo-h3-quannengcankao 1080P 10s = 32（查表）', async () => {
    const q = await pricingEngine.quote({
      capability: TV,
      modelId: 'm-hailuo-ref',
      params: { resolution: '1080P', durationSec: 10 },
    });
    expect(q.credits).toBe(32);
    expect(q.estimated).toBe(false);
    expect(q.breakdown.costUnits).toBeCloseTo(1.656, 10);
  });

  it('三个模型报价互不相同，且都等于 ceil(成本 × 信用系数)', async () => {
    const gk = await pricingEngine.quote({ capability: TV, modelId: 'm-gk', params: { durationSec: 10 } });
    const hl = await pricingEngine.quote({
      capability: TV,
      modelId: 'm-hailuo',
      params: { resolution: '768P', durationSec: 10 },
    });
    const ref = await pricingEngine.quote({
      capability: TV,
      modelId: 'm-hailuo-ref',
      params: { resolution: '1080P', durationSec: 10 },
    });

    const set = new Set([gk.credits, hl.credits, ref.credits]);
    expect(set.size).toBe(3); // 「换模型价格不变」= 验收失败

    expect(gk.credits).toBe(costUnitsToCredits(0.69));
    expect(hl.credits).toBe(costUnitsToCredits(0.828));
    expect(ref.credits).toBe(costUnitsToCredits(1.656));

    expect([gk.credits, hl.credits, ref.credits]).toEqual([13, 16, 32]);
  });

  it('不传 modelId 时按能力取价格最低的 active 模型', async () => {
    const q = await pricingEngine.quote({ capability: TV, params: { durationSec: 10 } });
    // 未指定规格 → spec 只有 {durationSec:10}，命中的是 gk-video-3（13 最便宜）
    expect(q.credits).toBe(13);
    expect(q.modelCode).toBe('gk-video-3');
  });

  it('查不到 price_items 时按三口径现算并标 estimated=true', async () => {
    // 2K 是该模型未录入的规格 → 回落现算
    tables.snapshots.push({
      modelId: 'm-hailuo-ref',
      isActive: true,
      billingMethod: 'per_second',
      basePrice: dec(0.1656),
      minPrice: dec(0.1656),
      inputTokenPrice: null,
      outputTokenPrice: null,
      optionPrices: {},
      capturedAt: new Date(),
    });

    const q = await pricingEngine.quote({
      capability: TV,
      modelId: 'm-hailuo-ref',
      params: { resolution: '2K', durationSec: 10 },
    });

    expect(q.estimated).toBe(true);
    // per_second: 0.1656 × 10 = 1.656 → 32
    expect(q.breakdown.costUnits).toBeCloseTo(1.656, 10);
    expect(q.credits).toBe(32);
  });

  it('模型未上架（active=false）抛 MODEL_UNAVAILABLE', async () => {
    const m = tables.models.find((x) => x.id === 'm-gk');
    if (m) m.active = false;
    await expect(
      pricingEngine.quote({ capability: TV, modelId: 'm-gk', params: { durationSec: 10 } }),
    ).rejects.toMatchObject({ code: 'MODEL_UNAVAILABLE' });
  });

  it('price_item.active=false 的行不被采信 → 回落现算', async () => {
    const row = tables.priceItems.find((p) => p.modelId === 'm-gk');
    if (row) row.active = false;

    tables.snapshots.push({
      modelId: 'm-gk',
      isActive: true,
      billingMethod: 'per_second',
      basePrice: dec(0.069),
      minPrice: dec(0.069),
      inputTokenPrice: null,
      outputTokenPrice: null,
      optionPrices: {},
      capturedAt: new Date(),
    });

    const q = await pricingEngine.quote({ capability: TV, modelId: 'm-gk', params: { durationSec: 10 } });
    expect(q.estimated).toBe(true);
    expect(q.credits).toBe(13); // 现算结果与表值一致
  });

  /**
   * 回归：per_token 现算必须拿到**非规格维度**的 params。
   *
   * spec 规范化只保留 8 个规格键，inputTokens / hasRefVideo 不在其中。
   * 若把 spec 当 params 传给 computeCostUnits，inputTokens 会永远是 0，
   * 按 token 计费的模型（seedance 系列）输入侧成本会被系统性低估。
   */
  it('per_token 现算能读到非规格键 inputTokens（用输入侧差异证明）', async () => {
    tables.models.push({
      id: 'm-seed',
      code: 'seedance-2.0-guanfang',
      displayName: 'Seedance 2.0',
      active: true,
      enabled: true,
    });
    // 不写 price_item → 强制走现算
    tables.snapshots.push({
      modelId: 'm-seed',
      isActive: true,
      billingMethod: 'per_token',
      basePrice: dec(0),
      minPrice: dec(0),
      inputTokenPrice: dec(31.25), // 每 1M 输入 token 31.25 算力
      outputTokenPrice: dec(0),
      optionPrices: {},
      capturedAt: new Date(),
    });

    // 无输入 token：只有输出侧，0 成本 → 下限 1 积分
    const noInput = await pricingEngine.quote({
      capability: TV,
      modelId: 'm-seed',
      params: { resolution: '480p', durationSec: 10 },
    });
    // 480p 10s = 9600×10 = 96000 output tokens × 0 = 0 → ceil(0)=0 → 封底 1
    expect(noInput.estimated).toBe(true);
    expect(noInput.credits).toBe(1);

    // 带 inputTokens=1_000_000 → 31.25 算力 → ceil(31.25×18.8406)=589
    const withInput = await pricingEngine.quote({
      capability: TV,
      modelId: 'm-seed',
      params: { resolution: '480p', durationSec: 10, inputTokens: 1_000_000 },
    });
    expect(withInput.estimated).toBe(true);
    expect(withInput.breakdown.costUnits).toBeCloseTo(31.25, 6);
    expect(withInput.credits).toBe(costUnitsToCredits(31.25));
  });
});

// ---------------------------------------------------------------- quote 全链路折扣

describe('quote 全链路折扣', () => {
  const TV: Capability = 'text_to_video';

  beforeEach(() => {
    resetTables();
    tables.models.push({
      id: 'm1',
      code: 'kling-v3-video',
      displayName: 'Kling V3',
      active: true,
      enabled: true,
    });
    // 标准价 117（对应详细设计 §2.5 示例）
    tables.priceItems.push({
      modelId: 'm1',
      capability: TV,
      specHash: specHashOf({ resolution: '720p', durationSec: 10 }),
      spec: { resolution: '720p', durationSec: 10 },
      costUnits: dec(6.2072),
      markup: dec(1.3),
      credits: 117,
      active: true,
    });
  });

  it('Pro 订阅 9 折：117 → 106，并出现在 breakdown.discounts', async () => {
    tables.subscriptions.push({
      userId: 'u1',
      status: 'active',
      currentPeriodStart: new Date(Date.now() - 86_400_000),
      currentPeriodEnd: new Date(Date.now() + 86_400_000),
      plan: { planDiscount: dec(0.9), code: 'pro' },
    });

    const q = await pricingEngine.quote({
      capability: TV,
      modelId: 'm1',
      params: { resolution: '720p', durationSec: 10 },
      userId: 'u1',
    });

    expect(q.breakdown.standardCredits).toBe(117);
    expect(q.credits).toBe(106);
    expect(q.breakdown.discounts).toHaveLength(1);
    expect(q.breakdown.discounts[0]?.kind).toBe('plan');
  });

  it('匿名用户无折扣', async () => {
    const q = await pricingEngine.quote({
      capability: TV,
      modelId: 'm1',
      params: { resolution: '720p', durationSec: 10 },
    });
    expect(q.credits).toBe(117);
    expect(q.breakdown.discounts).toEqual([]);
  });

  it('促销 + 订阅 + 优惠券 三层叠加，顺序固定', async () => {
    const now = Date.now();
    tables.promotions.push({
      id: 'promo-1',
      scope: 'global',
      targetId: null,
      discount: dec(0.75),
      startsAt: new Date(now - 3600_000),
      endsAt: new Date(now + 3600_000),
      active: true,
    });
    tables.subscriptions.push({
      userId: 'u1',
      status: 'active',
      currentPeriodStart: new Date(now - 86_400_000),
      currentPeriodEnd: new Date(now + 86_400_000),
      plan: { planDiscount: dec(0.9), code: 'pro' },
    });
    tables.coupons.push({
      id: 'c1',
      code: 'NEW20',
      discount: dec(20),
      usedAt: null,
      expiresAt: new Date(now + 86_400_000),
    });

    const q = await pricingEngine.quote({
      capability: TV,
      modelId: 'm1',
      params: { resolution: '720p', durationSec: 10 },
      userId: 'u1',
    });

    expect(q.breakdown.discounts.map((d) => d.kind)).toEqual(['promotion', 'plan', 'coupon']);
    // 117 → ceil(87.75)=88 → ceil(79.2)=80 → 80−20=60
    expect(q.credits).toBe(60);
  });

  it('折扣后仍不低于 1 积分', async () => {
    tables.coupons.push({
      id: 'c-big',
      code: 'BIG',
      discount: dec(9999),
      usedAt: null,
      expiresAt: new Date(Date.now() + 86_400_000),
    });

    const q = await pricingEngine.quote({
      capability: TV,
      modelId: 'm1',
      params: { resolution: '720p', durationSec: 10 },
      userId: 'u1',
    });
    expect(q.credits).toBe(MIN_CREDITS);
  });
});

// ---------------------------------------------------------------- 子集回退（非价格维度不影响查表价）

describe('quote 子集回退', () => {
  const IMG: Capability = 'text_to_image';

  beforeEach(() => {
    resetTables();
    tables.models.push({
      id: 'm-img25',
      code: 'tt-image-2.5',
      displayName: 'GPT Image 2.5',
      active: true,
      enabled: true,
    });
    const seed = (spec: Record<string, unknown>, credits: number) => {
      tables.priceItems.push({
        modelId: 'm-img25',
        capability: IMG,
        specHash: specHashOf(spec),
        spec,
        costUnits: dec(0.05),
        markup: dec(1.3),
        credits,
        active: true,
      });
    };
    seed({ resolution: '1K' }, 1);
    seed({ resolution: '2K' }, 2);
    seed({ resolution: '2K', background: 'transparent' }, 2);
    seed({ resolution: '4K' }, 3);
  });

  it('请求多带 quality/aspectRatio/version 仍命中 1K=1（estimated=false）', async () => {
    const q = await pricingEngine.quote({
      capability: IMG,
      modelId: 'm-img25',
      params: { resolution: '1K', aspectRatio: '1:1', quality: 'high', version: 'flare' },
    });
    expect(q.credits).toBe(1);
    expect(q.estimated).toBe(false);
  });

  it('background=transparent 命中更具体的 2K 透明行', async () => {
    const q = await pricingEngine.quote({
      capability: IMG,
      modelId: 'm-img25',
      params: { resolution: '2K', background: 'transparent', quality: 'auto' },
    });
    expect(q.credits).toBe(2);
    expect(q.estimated).toBe(false);
  });

  it('background=opaque 回退到普通 2K 行', async () => {
    const q = await pricingEngine.quote({
      capability: IMG,
      modelId: 'm-img25',
      params: { resolution: '2K', background: 'opaque' },
    });
    expect(q.credits).toBe(2);
    expect(q.estimated).toBe(false);
  });

  it('resolution=auto 无价格行 → 仍走现算/409（不悄悄按低价成交）', async () => {
    await expect(
      pricingEngine.quote({ capability: IMG, modelId: 'm-img25', params: { resolution: 'auto' } }),
    ).rejects.toMatchObject({ code: 'MODEL_UNAVAILABLE' });
  });

  it('价格维度对不上（如未知分辨率）→ 仍走现算/409', async () => {
    await expect(
      pricingEngine.quote({ capability: IMG, modelId: 'm-img25', params: { resolution: '8K' } }),
    ).rejects.toMatchObject({ code: 'MODEL_UNAVAILABLE' });
  });
});
