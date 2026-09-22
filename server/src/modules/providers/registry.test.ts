/**
 * ProviderRegistry 单测。
 *
 * 覆盖：
 * - DB Json → 强类型的收窄（脏数据不炸）
 * - loadModelDescriptor 附带派生 params
 * - getChannelCreds 的 Key 池解析 + 5min 缓存 + 缺 Key 抛 noHealthyProvider
 * - **MOCK_PROVIDER=true → getActiveProvider() 必须返回 MockProvider，绝不实例化 LingkeProvider**
 * - 凭据日志脱敏
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------- mock DB

interface FakeModelRow {
  id: string;
  channelId: string;
  code: string;
  displayName: string;
  capabilities: string[];
  paramMapping: unknown;
  requiredParams: unknown;
  constraints: unknown;
  enabled: boolean;
  active: boolean;
  qualityScore: number | null;
}

let MODEL_ROWS: FakeModelRow[] = [];
let CHANNEL_ROW: { id: string; code: string; baseUrl: string; timeoutMs: number } | null = null;
let KEY_ROWS: Array<{ id: string; keyRef: string; priority: number; enabled: boolean }> = [];

function withChannel(row: FakeModelRow) {
  return { ...row, channel: CHANNEL_ROW! };
}

vi.mock('../../core/db.js', () => ({
  db: () => ({
    model: {
      findUnique: async (args: {
        where: { id?: string; channelId_code?: { channelId: string; code: string } };
      }) => {
        const w = args.where;
        const row = w.id
          ? MODEL_ROWS.find((m) => m.id === w.id)
          : MODEL_ROWS.find((m) => m.channelId === w.channelId_code!.channelId && m.code === w.channelId_code!.code);
        return row ? withChannel(row) : null;
      },
      findMany: async () => MODEL_ROWS.map(withChannel),
    },
    channel: { findUnique: async () => CHANNEL_ROW },
    channelApiKey: {
      findFirst: async (_args: { where: { channelId: string; enabled: boolean } }) =>
        KEY_ROWS.filter((k) => k.enabled).sort((a, b) => a.priority - b.priority)[0] ?? null,
    },
    modelPricingSnapshot: { findFirst: async () => null },
    routingPolicy: { findUnique: async () => null },
  }),
  transaction: async () => {
    throw new Error('not used');
  },
  Prisma: {},
}));

const {
  getProvider,
  getActiveProvider,
  resetProviders,
  resetCredsCache,
  loadModelDescriptor,
  loadModelByCode,
  getChannelCreds,
  resolveApiKey,
  parseParamMapping,
  parseConstraints,
  parseRequiredParams,
  parseCapabilities,
} = await import('./registry.js');

const { MockProvider } = await import('./mock.js');
const { LingkeProvider } = await import('./lingke.js');
const { loadConfig, resetConfig } = await import('../../core/config.js');

async function withEnv(env: Record<string, string>, fn: () => Promise<void>): Promise<void> {
  const snapshot: Record<string, string | undefined> = {};
  for (const k of Object.keys(env)) snapshot[k] = process.env[k];
  Object.assign(process.env, env);
  resetConfig();
  loadConfig();
  try {
    await fn();
  } finally {
    for (const [k, v] of Object.entries(snapshot)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    resetConfig();
    loadConfig();
  }
}

beforeEach(() => {
  MODEL_ROWS = [];
  CHANNEL_ROW = { id: 'c-1', code: 'lk888', baseUrl: 'https://api.lk888.ai/api', timeoutMs: 30_000 };
  KEY_ROWS = [];
  resetProviders();
  resetCredsCache();
});

// ---------------------------------------------------------------- Json 收窄

describe('Json 收窄（脏数据不炸）', () => {
  it('parseParamMapping 收窄合法项', () => {
    const out = parseParamMapping({
      durationSec: { target: 'duration', type: 'select', allowed: [6, 10], required: true, coerce: 'string' },
      resolution: { target: 'resolution', type: 'select', allowed: ['720P'], min: 1, max: 5 },
    });
    expect(out['durationSec']).toEqual({
      target: 'duration',
      type: 'select',
      allowed: [6, 10],
      required: true,
      coerce: 'string',
    });
    expect(out['resolution']?.allowed).toEqual(['720P']);
  });

  it('parseParamMapping 丢弃未知 type 与非法结构', () => {
    const out = parseParamMapping({
      good: { target: 'g', type: 'int', min: 1, max: 2 },
      badType: { target: 'b', type: 'nonsense' },
      notObject: 'string-value',
      noType: { target: 'x' },
    });
    expect(Object.keys(out)).toEqual(['good']);
  });

  it('parseParamMapping 对 null / 数组 / 字符串输入返回 {}', () => {
    expect(parseParamMapping(null)).toEqual({});
    expect(parseParamMapping([1, 2])).toEqual({});
    expect(parseParamMapping('x')).toEqual({});
    expect(parseParamMapping(undefined)).toEqual({});
  });

  it('target 缺失时回落为内部 key（保证映射仍可用）', () => {
    const out = parseParamMapping({ durationSec: { type: 'int' } });
    expect(out['durationSec']?.target).toBe('durationSec');
  });

  it('parseParamMapping 丢弃非 string/number 的 allowed 项', () => {
    const out = parseParamMapping({
      p: { target: 'p', type: 'select', allowed: ['a', 1, null, { x: 1 }, true] },
    });
    expect(out['p']?.allowed).toEqual(['a', 1]);
  });

  it('parseRequiredParams 只保留字符串', () => {
    expect(parseRequiredParams(['a', 1, null, 'b'])).toEqual(['a', 'b']);
    expect(parseRequiredParams('nope')).toEqual([]);
    expect(parseRequiredParams({})).toEqual([]);
  });

  it('parseConstraints 只保留已知字段与正确类型', () => {
    expect(
      parseConstraints({
        maxPromptChars: 2000,
        maxInputImages: 3,
        videoNeedsUrl: true,
        fixedResolution: '720P',
        bogus: 'ignored',
        maxInputVideos: 'not-a-number',
      }),
    ).toEqual({ maxPromptChars: 2000, maxInputImages: 3, videoNeedsUrl: true, fixedResolution: '720P' });
  });

  it('parseCapabilities 过滤非 Capability 值', () => {
    expect(parseCapabilities(['text_to_video', 'nonsense', 1, 'tts'])).toEqual(['text_to_video', 'tts']);
    expect(parseCapabilities('x')).toEqual([]);
  });
});

// ---------------------------------------------------------------- 模型装载

describe('loadModelDescriptor', () => {
  const baseRow: FakeModelRow = {
    id: 'm-1',
    channelId: 'c-1',
    code: 'gk-video-3',
    displayName: 'GK Video 3',
    capabilities: ['text_to_video'],
    paramMapping: {
      durationSec: { target: 'duration', type: 'select', allowed: [6, 10], required: true },
    },
    requiredParams: ['durationSec'],
    constraints: { fixedResolution: '720P' },
    enabled: true,
    active: true,
    qualityScore: 80,
  };

  it('装配强类型描述符并附上派生 params', async () => {
    MODEL_ROWS = [baseRow];
    const d = await loadModelDescriptor('m-1');

    expect(d.code).toBe('gk-video-3');
    expect(d.channelCode).toBe('lk888');
    expect(d.capabilities).toEqual(['text_to_video']);
    expect(d.requiredParams).toEqual(['durationSec']);
    expect(d.constraints.fixedResolution).toBe('720P');
    expect(d.params).toBeDefined();
    expect(d.params?.['durationSec']?.options).toEqual([6, 10]);
  });

  it('派生 params 里不出现上游内部代号', async () => {
    MODEL_ROWS = [baseRow];
    const d = await loadModelDescriptor('m-1');
    const keys = Object.keys(d.params ?? {});
    expect(keys).toContain('durationSec');
    expect(keys).not.toContain('duration');
    expect(JSON.stringify(d.params)).not.toContain('"target"');
  });

  it('模型不存在 → notFound', async () => {
    MODEL_ROWS = [];
    await expect(loadModelDescriptor('nope')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('loadModelByCode 命中 / 未命中', async () => {
    MODEL_ROWS = [baseRow];
    const hit = await loadModelByCode('c-1', 'gk-video-3');
    expect(hit?.id).toBe('m-1');
    const miss = await loadModelByCode('c-1', 'nope');
    expect(miss).toBeNull();
  });
});

// ---------------------------------------------------------------- Provider 选择

describe('getProvider / getActiveProvider', () => {
  it('channelCode=mock → MockProvider（无论 MOCK_PROVIDER）', async () => {
    await withEnv({ MOCK_PROVIDER: 'false' }, async () => {
      resetProviders();
      expect(getProvider('mock')).toBeInstanceOf(MockProvider);
    });
    await withEnv({ MOCK_PROVIDER: 'true' }, async () => {
      resetProviders();
      expect(getProvider('mock')).toBeInstanceOf(MockProvider);
    });
  });

  it('**MOCK_PROVIDER=true → getActiveProvider() 返回 MockProvider，绝不实例化 LingkeProvider**', async () => {
    await withEnv({ MOCK_PROVIDER: 'true' }, async () => {
      resetProviders();
      const p = getActiveProvider();
      expect(p).toBeInstanceOf(MockProvider);
      expect(p).not.toBeInstanceOf(LingkeProvider);
      expect(p.channelCode).toBe('mock');
    });
  });

  it('MOCK_PROVIDER=true 时 lk888 渠道码也被重定向到 MockProvider（零上游费用保证）', async () => {
    await withEnv({ MOCK_PROVIDER: 'true' }, async () => {
      resetProviders();
      expect(getProvider('lk888')).toBeInstanceOf(MockProvider);
    });
  });

  it('MOCK_PROVIDER=false → getActiveProvider() 返回 LingkeProvider', async () => {
    await withEnv({ MOCK_PROVIDER: 'false' }, async () => {
      resetProviders();
      expect(getActiveProvider()).toBeInstanceOf(LingkeProvider);
    });
  });

  it('同一实例复用（进程内单例）', async () => {
    await withEnv({ MOCK_PROVIDER: 'true' }, async () => {
      resetProviders();
      expect(getActiveProvider()).toBe(getActiveProvider());
    });
  });

  it('resetProviders 后拿到新实例', async () => {
    await withEnv({ MOCK_PROVIDER: 'true' }, async () => {
      resetProviders();
      const a = getActiveProvider();
      resetProviders();
      expect(getActiveProvider()).not.toBe(a);
    });
  });
});

// ---------------------------------------------------------------- 凭据

describe('getChannelCreds', () => {
  it('取 enabled 且 priority 最小的一条（忽略 disabled）', async () => {
    process.env['TEST_LK_KEY_HIGH'] = 'sk-high';
    process.env['TEST_LK_KEY_LOW'] = 'sk-low';
    KEY_ROWS = [
      { id: 'k-low', keyRef: 'TEST_LK_KEY_LOW', priority: 2, enabled: true },
      { id: 'k-high', keyRef: 'TEST_LK_KEY_HIGH', priority: 1, enabled: true },
      { id: 'k-disabled', keyRef: 'TEST_LK_KEY_LOW', priority: 0, enabled: false },
    ];

    const creds = await getChannelCreds('c-1');
    // priority=0 的那把 enabled=false，必须跳过 → 取 priority=1
    expect(creds.apiKeyId).toBe('k-high');
    expect(creds.apiKey).toBe('sk-high');

    delete process.env['TEST_LK_KEY_HIGH'];
    delete process.env['TEST_LK_KEY_LOW'];
  });

  it('正常解析环境变量形式的 keyRef', async () => {
    process.env['TEST_LK_KEY_OK'] = 'sk-abcdefghijklmnop';
    KEY_ROWS = [{ id: 'k1', keyRef: 'TEST_LK_KEY_OK', priority: 1, enabled: true }];

    const creds = await getChannelCreds('c-1');
    expect(creds.apiKey).toBe('sk-abcdefghijklmnop');
    expect(creds.baseUrl).toBe('https://api.lk888.ai/api');
    expect(creds.timeoutMs).toBe(30_000);
    delete process.env['TEST_LK_KEY_OK'];
  });

  it('keyRef 以 LK_API_KEYS 开头 → 从配置的 Key 池按序取', async () => {
    await withEnv({ LK_API_KEYS: 'sk-pool-0,sk-pool-1' }, async () => {
      resetProviders();
      expect(resolveApiKey('LK_API_KEYS:0')).toBe('sk-pool-0');
      expect(resolveApiKey('LK_API_KEYS:1')).toBe('sk-pool-1');
      expect(resolveApiKey('LK_API_KEYS')).toBe('sk-pool-0');
      // 越界回落第一把
      expect(resolveApiKey('LK_API_KEYS:99')).toBe('sk-pool-0');
    });
  });

  it('env: 前缀形式', () => {
    process.env['TEST_PREFIXED'] = 'sk-prefixed';
    expect(resolveApiKey('env:TEST_PREFIXED')).toBe('sk-prefixed');
    delete process.env['TEST_PREFIXED'];
  });

  it('无可用 Key → 抛 noHealthyProvider(300, no_credentials)', async () => {
    KEY_ROWS = [];
    const e = (await getChannelCreds('c-1').catch((x: unknown) => x)) as {
      code: string;
      status: number;
      details?: Record<string, unknown>;
    };
    expect(e.code).toBe('NO_HEALTHY_PROVIDER');
    expect(e.status).toBe(503);
    expect(e.details?.['reason']).toBe('no_credentials');
  });

  it('keyRef 解析为空 → 同样抛 no_credentials', async () => {
    KEY_ROWS = [{ id: 'k1', keyRef: 'DEFINITELY_MISSING_ENV_VAR', priority: 1, enabled: true }];

    const e = (await getChannelCreds('c-1').catch((x: unknown) => x)) as { code: string };
    expect(e.code).toBe('NO_HEALTHY_PROVIDER');
  });

  it('渠道不存在 → notFound', async () => {
    CHANNEL_ROW = null;
    await expect(getChannelCreds('c-1')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('5min 内存缓存（第二次不再查库）', async () => {
    process.env['TEST_LK_CACHE'] = 'sk-cached-key';
    KEY_ROWS = [{ id: 'k1', keyRef: 'TEST_LK_CACHE', priority: 1, enabled: true }];

    const first = await getChannelCreds('c-1');
    // 清空 DB 行：若未走缓存会抛 no_credentials
    KEY_ROWS = [];
    const second = await getChannelCreds('c-1');

    expect(second.apiKey).toBe(first.apiKey);
    expect(second.apiKeyId).toBe('k1');

    // resetCredsCache 后应重新查库（此时无 Key → 抛错）
    resetCredsCache();
    await expect(getChannelCreds('c-1')).rejects.toMatchObject({ code: 'NO_HEALTHY_PROVIDER' });

    delete process.env['TEST_LK_CACHE'];
  });

  it('凭据不含明文 Key 落日志（脱敏断言在契约测试覆盖）', async () => {
    process.env['TEST_LK_MASK'] = 'sk-1234567890abcdef';
    KEY_ROWS = [{ id: 'k1', keyRef: 'TEST_LK_MASK', priority: 1, enabled: true }];

    const creds = await getChannelCreds('c-1');
    // 明文只在内存流转（返回给调用方是必要的），但不得进入任何持久化
    expect(creds.apiKey).toBe('sk-1234567890abcdef');
    delete process.env['TEST_LK_MASK'];
  });
});
