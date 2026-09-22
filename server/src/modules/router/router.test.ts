/**
 * Router 单测（PRD §5.3 / 详细设计 §4.3）。
 *
 * 覆盖验收点：
 * - 权重分布 χ² 检验（10k 次采样，落在期望 ±5%）
 * - 灰度哈希稳定性（同 userId 结果一致；grayPercent=0 永不入选、100 恒入选）
 * - 全灭 → 503 NO_HEALTHY_PROVIDER（断言 AppError.code 与 status）
 * - 显式指定不可用 → 409 MODEL_UNAVAILABLE + alternatives
 * - 参数约束过滤（gk-video-3 不会接 30s 的请求）
 *
 * DB 用可控的假 Prisma（不连真库）。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModelDescriptor } from '../../core/types.js';

// ---------------------------------------------------------------- mock DB

/** 测试数据容器：每个用例通过 setModels/setPolicy 注入 */
let MODELS: ModelDescriptor[] = [];
let POLICY: { strategy: string; candidates: unknown; circuitBreaker: unknown } | null = null;

function rowOf(m: ModelDescriptor) {
  return {
    id: m.id,
    channelId: m.channelId,
    code: m.code,
    displayName: m.displayName,
    capabilities: m.capabilities as string[],
    paramMapping: m.paramMapping,
    requiredParams: m.requiredParams,
    constraints: m.constraints,
    enabled: m.enabled,
    qualityScore: m.qualityScore,
    active: m.active,
    channel: { id: m.channelId, code: m.channelCode, baseUrl: 'https://api.lk888.ai/api', timeoutMs: 30000 },
  };
}

vi.mock('../../core/db.js', () => ({
  db: () => ({
    model: {
      findMany: async (args?: { where?: { active?: boolean; enabled?: boolean; capabilities?: { has?: string } } }) => {
        let rows = MODELS;
        const w = args?.where;
        if (w?.active === true) rows = rows.filter((m) => m.active);
        if (w?.enabled === true) rows = rows.filter((m) => m.enabled);
        const cap = w?.capabilities?.has;
        if (cap) rows = rows.filter((m) => m.capabilities.includes(cap as never));
        return rows.map(rowOf);
      },
      findUnique: async (args: { where: { id?: string; channelId_code?: { channelId: string; code: string } } }) => {
        const w = args.where;
        if (w.id) {
          const m = MODELS.find((x) => x.id === w.id);
          return m ? rowOf(m) : null;
        }
        if (w.channelId_code) {
          const m = MODELS.find(
            (x) => x.channelId === w.channelId_code!.channelId && x.code === w.channelId_code!.code,
          );
          return m ? rowOf(m) : null;
        }
        return null;
      },
    },
    channel: {
      findUnique: async () => ({ id: 'c-lk888', code: 'lk888', baseUrl: 'https://api.lk888.ai/api', timeoutMs: 30000 }),
    },
    modelPricingSnapshot: { findFirst: async () => null },
    routingPolicy: {
      findUnique: async () => (POLICY ? { capability: 'text_to_video', ...POLICY, fallbackEnabled: true } : null),
    },
  }),
  transaction: async () => {
    throw new Error('not used');
  },
  Prisma: {},
}));

// 熔断器：全部 healthy（本文件专测路由逻辑，熔断另有一套测试）
vi.mock('./breaker.js', () => ({
  circuitBreaker: {
    isOpen: async () => false,
    recordSuccess: async () => undefined,
    recordFailure: async () => undefined,
    earliestRecoverySec: async () => 0,
    state: async () => 'closed' as const,
  },
}));

const { router, grayBucket, inGray, weightedPickIndex, resetRouterCache } = await import('./index.js');

// ---------------------------------------------------------------- 模型工厂

function model(over: Partial<ModelDescriptor> & { code: string }): ModelDescriptor {
  return {
    id: `m-${over.code}`,
    displayName: over.code,
    channelId: 'c-lk888',
    channelCode: 'lk888',
    capabilities: ['text_to_video'],
    // 默认无必填参数，避免参数约束干扰权重测试
    paramMapping: {},
    requiredParams: [],
    constraints: {},
    enabled: true,
    active: true,
    qualityScore: null,
    ...over,
  };
}

beforeEach(() => {
  MODELS = [];
  POLICY = null;
  resetRouterCache();
});

// ---------------------------------------------------------------- 灰度哈希

describe('灰度哈希稳定性', () => {
  it('同一 userId 多次调用结果一致', () => {
    const buckets = new Set<number>();
    for (let i = 0; i < 50; i++) buckets.add(grayBucket('usr_abc123'));
    expect(buckets.size).toBe(1);
  });

  it('不同 userId 分布均匀（10k 用户，卡方检验）', () => {
    const counts = new Array<number>(100).fill(0);
    for (let i = 0; i < 10_000; i++) counts[grayBucket(`usr_${i}`)]! += 1;

    // 期望每个桶 100 次；卡方检验 df=99，临界值 148.2（α=0.001）
    const expected = 100;
    let chi2 = 0;
    for (const c of counts) chi2 += (c - expected) ** 2 / expected;
    expect(chi2).toBeLessThan(148.2);
  });

  it('grayPercent=0 永不入选', () => {
    for (let i = 0; i < 500; i++) {
      expect(inGray(0, `usr_${i}`)).toBe(false);
    }
  });

  it('grayPercent=100 恒入选', () => {
    for (let i = 0; i < 500; i++) {
      expect(inGray(100, `usr_${i}`)).toBe(true);
    }
  });

  it('grayPercent=50 命中率接近 50%（±5%）', () => {
    let hit = 0;
    const N = 10_000;
    for (let i = 0; i < N; i++) if (inGray(50, `usr_${i}`)) hit += 1;
    const ratio = hit / N;
    expect(ratio).toBeGreaterThan(0.45);
    expect(ratio).toBeLessThan(0.55);
  });
});

// ---------------------------------------------------------------- 加权随机

describe('加权随机分布', () => {
  it('weightedPickIndex 按权重分布（χ² 检验，10k 次）', () => {
    const weights = [40, 25, 20, 15];
    const counts = new Array<number>(weights.length).fill(0);
    const N = 10_000;

    for (let i = 0; i < N; i++) {
      const idx = weightedPickIndex(weights);
      counts[idx]! += 1;
    }

    const total = weights.reduce((a, b) => a + b, 0);
    let chi2 = 0;
    for (let i = 0; i < weights.length; i++) {
      const expected = (N * weights[i]!) / total;
      chi2 += (counts[i]! - expected) ** 2 / expected;
    }
    // df=3，临界值 16.27（α=0.001）
    expect(chi2).toBeLessThan(16.27);

    // 同时断言每个占比落在期望 ±5%（绝对值，即 ±5 个百分点）
    for (let i = 0; i < weights.length; i++) {
      const expectedRatio = weights[i]! / total;
      const actualRatio = counts[i]! / N;
      expect(Math.abs(actualRatio - expectedRatio), `weight[${i}]`).toBeLessThan(0.05);
    }
  });

  it('全零权重返回 -1', () => {
    expect(weightedPickIndex([0, 0, 0])).toBe(-1);
    expect(weightedPickIndex([])).toBe(-1);
  });

  it('单一权重恒返回该索引', () => {
    for (let i = 0; i < 100; i++) expect(weightedPickIndex([5])).toBe(0);
  });
});

// ---------------------------------------------------------------- pick 权重

describe('router.pick —— 加权选择', () => {
  it('按 DB 策略 weight 加权分布（10k 次，±5%）', async () => {
    MODELS = [model({ code: 'A' }), model({ code: 'B' }), model({ code: 'C' })];
    POLICY = {
      strategy: 'weighted',
      candidates: [
        { model: 'A', weight: 50, enabled: true, grayPercent: 100 },
        { model: 'B', weight: 30, enabled: true, grayPercent: 100 },
        { model: 'C', weight: 20, enabled: true, grayPercent: 100 },
      ],
      circuitBreaker: { failureThreshold: 5, cooldownSec: 120 },
    };

    const counts: Record<string, number> = { A: 0, B: 0, C: 0 };
    const N = 10_000;
    for (let i = 0; i < N; i++) {
      const r = await router.pick({ capability: 'text_to_video', userId: `usr_${i}`, params: {} });
      counts[r.modelCode] = (counts[r.modelCode] ?? 0) + 1;
    }

    expect(Math.abs(counts['A']! / N - 0.5)).toBeLessThan(0.05);
    expect(Math.abs(counts['B']! / N - 0.3)).toBeLessThan(0.05);
    expect(Math.abs(counts['C']! / N - 0.2)).toBeLessThan(0.05);
  });

  it('candidates 里 enabled=false 的模型被排除', async () => {
    MODELS = [model({ code: 'A' }), model({ code: 'B' })];
    POLICY = {
      strategy: 'weighted',
      candidates: [
        { model: 'A', weight: 1, enabled: false, grayPercent: 100 },
        { model: 'B', weight: 1, enabled: true, grayPercent: 100 },
      ],
      circuitBreaker: { failureThreshold: 5, cooldownSec: 120 },
    };

    for (let i = 0; i < 100; i++) {
      const r = await router.pick({ capability: 'text_to_video', userId: `usr_${i}`, params: {} });
      expect(r.modelCode).toBe('B');
    }
  });

  it('grayPercent=0 的候选永不入选', async () => {
    MODELS = [model({ code: 'A' }), model({ code: 'B' })];
    POLICY = {
      strategy: 'weighted',
      candidates: [
        { model: 'A', weight: 100, enabled: true, grayPercent: 0 },
        { model: 'B', weight: 1, enabled: true, grayPercent: 100 },
      ],
      circuitBreaker: { failureThreshold: 5, cooldownSec: 120 },
    };

    for (let i = 0; i < 200; i++) {
      const r = await router.pick({ capability: 'text_to_video', userId: `usr_${i}`, params: {} });
      expect(r.modelCode).toBe('B');
    }
  });

  it('grayPercent 按 userId 分流（同一用户结果稳定）', async () => {
    MODELS = [model({ code: 'A' }), model({ code: 'B' })];
    POLICY = {
      strategy: 'weighted',
      candidates: [
        { model: 'A', weight: 1, enabled: true, grayPercent: 50 },
        { model: 'B', weight: 1, enabled: true, grayPercent: 100 },
      ],
      circuitBreaker: { failureThreshold: 5, cooldownSec: 120 },
    };

    // 同一用户反复 pick：A 的可达性必须恒定（灰度稳定）
    const reachable = new Set<boolean>();
    for (let i = 0; i < 30; i++) {
      const r = await router.pick({ capability: 'text_to_video', userId: 'usr_stable', params: {} });
      reachable.add(r.modelCode === 'A' || inGray(50, 'usr_stable'));
    }
    expect(reachable.size).toBe(1);
  });
});

// ---------------------------------------------------------------- 参数约束

describe('router.pick —— 参数约束过滤', () => {
  it('gk-video-3 不会被 30s 的请求选中（能力/参数过滤）', async () => {
    // gk-video-3 只允许 6/10s；seedance-2.5 允许 4~30s（PRD §5.4 §5.2 模型表）
    MODELS = [
      model({
        code: 'gk-video-3',
        paramMapping: { durationSec: { target: 'duration', type: 'select', allowed: [6, 10], required: true } },
        requiredParams: ['durationSec'],
      }),
      model({
        code: 'seedance-2.5-guanfang',
        paramMapping: { durationSec: { target: 'duration', type: 'int', min: 4, max: 30, required: true } },
        requiredParams: ['durationSec'],
      }),
    ];
    POLICY = null; // 默认策略（全 active weight=1）

    for (let i = 0; i < 200; i++) {
      const r = await router.pick({
        capability: 'text_to_video',
        userId: `usr_${i}`,
        params: { durationSec: 30 },
      });
      // 30s 只有 seedance 能接，gk-video-3 必须被过滤掉
      expect(r.modelCode).toBe('seedance-2.5-guanfang');
    }
  });

  it('gk-video-3 与 hailuo-h3 都不能接 30s 时 → 503（全灭）', async () => {
    MODELS = [
      model({
        code: 'gk-video-3',
        paramMapping: { durationSec: { target: 'duration', type: 'select', allowed: [6, 10], required: true } },
        requiredParams: ['durationSec'],
      }),
      model({
        code: 'hailuo-h3',
        paramMapping: { durationSec: { target: 'duration', type: 'int', min: 4, max: 15, required: true } },
        requiredParams: ['durationSec'],
      }),
    ];
    POLICY = null;

    await expect(
      router.pick({ capability: 'text_to_video', userId: 'usr_1', params: { durationSec: 30 } }),
    ).rejects.toMatchObject({ code: 'NO_HEALTHY_PROVIDER', status: 503 });
  });

  it('6s 请求两个模型都可参与', async () => {
    MODELS = [
      model({
        code: 'gk-video-3',
        paramMapping: { durationSec: { target: 'duration', type: 'select', allowed: [6, 10], required: true } },
        requiredParams: ['durationSec'],
      }),
      model({
        code: 'hailuo-h3',
        paramMapping: { durationSec: { target: 'duration', type: 'int', min: 4, max: 15, required: true } },
        requiredParams: ['durationSec'],
      }),
    ];
    POLICY = null;

    const seen = new Set<string>();
    for (let i = 0; i < 300; i++) {
      const r = await router.pick({
        capability: 'text_to_video',
        userId: `usr_${i}`,
        params: { durationSec: 6 },
      });
      seen.add(r.modelCode);
    }
    expect(seen).toEqual(new Set(['gk-video-3', 'hailuo-h3']));
  });

  it('缺少 required 参数的模型被过滤掉', async () => {
    MODELS = [
      model({
        code: 'needsResolution',
        paramMapping: { resolution: { target: 'resolution', type: 'select', allowed: ['1080P'], required: true } },
        requiredParams: ['resolution'],
      }),
      model({ code: 'free' }), // 无必填
    ];
    POLICY = null;

    for (let i = 0; i < 100; i++) {
      const r = await router.pick({ capability: 'text_to_video', userId: `usr_${i}`, params: {} });
      expect(r.modelCode).toBe('free');
    }
  });
});

// ---------------------------------------------------------------- 全灭 503

describe('router.pick —— 全灭返回 503 NO_HEALTHY_PROVIDER', () => {
  it('无 active 模型 → AppError code/status 正确', async () => {
    MODELS = [];

    await expect(
      router.pick({ capability: 'text_to_video', userId: 'usr_1', params: {} }),
    ).rejects.toMatchObject({ code: 'NO_HEALTHY_PROVIDER', status: 503 });
  });

  it('灰度全排除 → 503', async () => {
    MODELS = [model({ code: 'A' })];
    POLICY = {
      strategy: 'weighted',
      candidates: [{ model: 'A', weight: 1, enabled: true, grayPercent: 0 }],
      circuitBreaker: { failureThreshold: 5, cooldownSec: 120 },
    };

    const e = await router
      .pick({ capability: 'text_to_video', userId: 'usr_1', params: {} })
      .catch((x: unknown) => x as { code: string; status: number; details?: Record<string, unknown> });

    expect(e).toMatchObject({ code: 'NO_HEALTHY_PROVIDER', status: 503 });
    expect((e as { details?: Record<string, unknown> }).details).toHaveProperty('estimatedRecoverySec');
  });

  it('候选全部 disabled → 503', async () => {
    MODELS = [model({ code: 'A' })];
    POLICY = {
      strategy: 'weighted',
      candidates: [{ model: 'A', weight: 1, enabled: false, grayPercent: 100 }],
      circuitBreaker: { failureThreshold: 5, cooldownSec: 120 },
    };

    await expect(
      router.pick({ capability: 'text_to_video', userId: 'usr_1', params: {} }),
    ).rejects.toMatchObject({ code: 'NO_HEALTHY_PROVIDER', status: 503 });
  });

  it('模型 enabled=false 被过滤 → 503', async () => {
    MODELS = [model({ code: 'A', enabled: false })];
    POLICY = null;

    await expect(
      router.pick({ capability: 'text_to_video', userId: 'usr_1', params: {} }),
    ).rejects.toMatchObject({ code: 'NO_HEALTHY_PROVIDER', status: 503 });
  });

  it('策略行存在但 candidates 为显式空数组 → 503（运营主动关停，未提及模型不再默认参与）', async () => {
    MODELS = [model({ code: 'A' }), model({ code: 'B' })];
    POLICY = {
      strategy: 'weighted',
      candidates: [],
      circuitBreaker: { failureThreshold: 5, cooldownSec: 120 },
    };

    await expect(
      router.pick({ capability: 'text_to_video', userId: 'usr_1', params: {} }),
    ).rejects.toMatchObject({ code: 'NO_HEALTHY_PROVIDER', status: 503 });
  });
});

// ---------------------------------------------------------------- 显式指定

describe('router.pick —— 显式指定模型', () => {
  it('指定 active 且满足约束的模型 → 直接返回', async () => {
    MODELS = [model({ code: 'hailuo-h3' }), model({ code: 'gk-video-3' })];
    POLICY = null;

    const r = await router.pick({
      capability: 'text_to_video',
      requestedModelId: 'm-hailuo-h3',
      userId: 'usr_1',
      params: {},
    });
    expect(r.modelId).toBe('m-hailuo-h3');
    expect(r.modelCode).toBe('hailuo-h3');
    expect(r.channelCode).toBe('lk888');
    expect(r.displayName).toBe('hailuo-h3');
  });

  it('指定的模型不存在 → 409 MODEL_UNAVAILABLE', async () => {
    MODELS = [model({ code: 'hailuo-h3' })];
    POLICY = null;

    await expect(
      router.pick({
        capability: 'text_to_video',
        requestedModelId: 'm-does-not-exist',
        userId: 'usr_1',
        params: {},
      }),
    ).rejects.toMatchObject({ code: 'MODEL_UNAVAILABLE', status: 409 });
  });

  it('指定的模型 active=false → 409', async () => {
    MODELS = [model({ code: 'hailuo-h3', active: false })];
    POLICY = null;

    await expect(
      router.pick({
        capability: 'text_to_video',
        requestedModelId: 'm-hailuo-h3',
        userId: 'usr_1',
        params: {},
      }),
    ).rejects.toMatchObject({ code: 'MODEL_UNAVAILABLE', status: 409 });
  });

  it('指定的模型不支持该 capability → 409', async () => {
    MODELS = [model({ code: 'tt-image-2', capabilities: ['text_to_image'] })];
    POLICY = null;

    await expect(
      router.pick({
        capability: 'text_to_video',
        requestedModelId: 'm-tt-image-2',
        userId: 'usr_1',
        params: {},
      }),
    ).rejects.toMatchObject({ code: 'MODEL_UNAVAILABLE', status: 409 });
  });

  it('指定的模型参数约束不通过 → 409（gk-video-3 要 30s）', async () => {
    MODELS = [
      model({
        code: 'gk-video-3',
        paramMapping: { durationSec: { target: 'duration', type: 'select', allowed: [6, 10], required: true } },
        requiredParams: ['durationSec'],
      }),
    ];
    POLICY = null;

    await expect(
      router.pick({
        capability: 'text_to_video',
        requestedModelId: 'm-gk-video-3',
        userId: 'usr_1',
        params: { durationSec: 30 },
      }),
    ).rejects.toMatchObject({ code: 'MODEL_UNAVAILABLE', status: 409 });
  });

  it('409 时 details.alternatives 给出可替代模型', async () => {
    MODELS = [model({ code: 'hailuo-h3' }), model({ code: 'gk-video-3', active: false })];
    POLICY = null;

    const e = (await router
      .pick({
        capability: 'text_to_video',
        requestedModelId: 'm-gk-video-3',
        userId: 'usr_1',
        params: {},
      })
      .catch((x: unknown) => x)) as { code: string; details?: { alternatives?: string[] } };

    expect(e.code).toBe('MODEL_UNAVAILABLE');
    expect(e.details?.alternatives).toEqual(['m-hailuo-h3']);
  });
});

// ---------------------------------------------------------------- alternatives

describe('router.alternatives', () => {
  it('返回该能力下所有 active 模型（可排除指定模型）', async () => {
    MODELS = [model({ code: 'A' }), model({ code: 'B' }), model({ code: 'C', active: false })];

    const all = await router.alternatives('text_to_video');
    expect(all.map((a) => a.id).sort()).toEqual(['m-A', 'm-B']);

    const excl = await router.alternatives('text_to_video', 'm-A');
    expect(excl.map((a) => a.id)).toEqual(['m-B']);
  });

  it('包含 displayName（前端展示用）', async () => {
    MODELS = [model({ code: 'A', displayName: 'Hailuo H3' })];
    const alts = await router.alternatives('text_to_video');
    expect(alts[0]).toEqual({ id: 'm-A', displayName: 'Hailuo H3' });
  });
});

// ---------------------------------------------------------------- 策略

describe('router.pick —— 策略', () => {
  it('quality_first 选中 qualityScore 最高的模型', async () => {
    MODELS = [
      model({ code: 'low', qualityScore: 10 }),
      model({ code: 'high', qualityScore: 99 }),
      model({ code: 'mid', qualityScore: 50 }),
    ];
    POLICY = {
      strategy: 'quality_first',
      // 注意：candidates 为显式空数组表示"全部关停"（会 503），
      // 这里要表达"三个都参与、按分值择优"，必须逐个列出。
      candidates: [
        { model: 'low', weight: 1, enabled: true, grayPercent: 100 },
        { model: 'high', weight: 1, enabled: true, grayPercent: 100 },
        { model: 'mid', weight: 1, enabled: true, grayPercent: 100 },
      ],
      circuitBreaker: { failureThreshold: 5, cooldownSec: 120 },
    };

    for (let i = 0; i < 50; i++) {
      const r = await router.pick({ capability: 'text_to_video', userId: `usr_${i}`, params: {} });
      expect(r.modelCode).toBe('high');
    }
  });

  it('qualityScore 为 null 时排在有分值的后面', async () => {
    MODELS = [model({ code: 'none', qualityScore: null }), model({ code: 'scored', qualityScore: 1 })];
    POLICY = {
      strategy: 'quality_first',
      candidates: [
        { model: 'none', weight: 1, enabled: true, grayPercent: 100 },
        { model: 'scored', weight: 1, enabled: true, grayPercent: 100 },
      ],
      circuitBreaker: { failureThreshold: 5, cooldownSec: 120 },
    };

    const r = await router.pick({ capability: 'text_to_video', userId: 'usr_1', params: {} });
    expect(r.modelCode).toBe('scored');
  });

  it('无 DB 策略时回落默认 weighted（全部 active 参与）', async () => {
    MODELS = [model({ code: 'A' }), model({ code: 'B' })];
    POLICY = null;

    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const r = await router.pick({ capability: 'text_to_video', userId: `usr_${i}`, params: {} });
      seen.add(r.modelCode);
    }
    expect(seen.size).toBe(2);
  });
});
