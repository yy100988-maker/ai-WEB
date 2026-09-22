/**
 * MockProvider 单测（CONTRACT §5 —— 本期测试基线）。
 *
 * 覆盖：
 * - 延迟前后 poll 的 running → succeeded 转换（线性进度 5%~95%）
 * - 四种失败注入（timeout / upstream_error / content_rejected / insufficient_balance）
 * - 注入的安全门槛（生产环境 / 开关关闭时忽略）
 * - fixture 是**合法媒体文件**（transfer 队列魔数校验必过）
 * - fixture 路由真实可下载且 Content-Type 正确
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Capability, ChannelCreds, GenerationRequest, ModelDescriptor } from '../../core/types.js';

// ---------------------------------------------------------------- mock redis / db

const redisStore = new Map<string, string>();

vi.mock('../../core/redis.js', () => ({
  REDIS_KEYS: {
    breaker: (m: string) => `breaker:${m}`,
    taskChannel: (id: string) => `task:${id}`,
  },
  redis: () => ({
    get: async (k: string) => redisStore.get(k) ?? null,
    set: async (k: string, v: string) => {
      redisStore.set(k, v);
      return 'OK';
    },
    del: async (k: string) => (redisStore.delete(k) ? 1 : 0),
    publish: async () => 1,
  }),
  createRedis: () => {
    throw new Error('not used');
  },
  acquireCronLock: async () => false,
}));

/** mock 渠道没有任何模型 → listModels 应返回 []（不抛） */
vi.mock('../../core/db.js', () => ({
  db: () => ({
    channel: { findUnique: async () => null },
    model: { findMany: async () => [] },
  }),
  transaction: async () => {
    throw new Error('not used');
  },
  Prisma: {},
}));

const { MockProvider, MOCK_FIXTURES, mockFixtureBuffer, resetMockJobs, MOCK_FAIL_MODES, isMockFailMode } =
  await import('./mock.js');

const { loadConfig, resetConfig } = await import('../../core/config.js');

// ---------------------------------------------------------------- 辅助

const creds: ChannelCreds = { apiKey: 'mock-key', apiKeyId: 'k1', baseUrl: 'http://localhost', timeoutMs: 1000 };

const model: ModelDescriptor = {
  id: 'm-mock',
  code: 'mock-video',
  displayName: 'Mock Video',
  channelId: 'c-mock',
  channelCode: 'mock',
  capabilities: ['text_to_video'],
  paramMapping: {},
  requiredParams: [],
  constraints: {},
  enabled: true,
  active: true,
  qualityScore: null,
};

function req(over: Partial<GenerationRequest> = {}): GenerationRequest {
  return {
    taskId: 't-1',
    capability: 'text_to_video',
    prompt: 'a cat',
    inputs: [],
    params: {},
    idempotencyKey: 'i-1',
    modelCode: 'mock-video',
    channelCode: 'mock',
    ...over,
  };
}

/** 用指定环境跑一段逻辑，结束后恢复 */
async function withEnv(env: Record<string, string>, fn: () => Promise<void>): Promise<void> {
  const snapshot: Record<string, string | undefined> = {};
  for (const k of Object.keys(env)) snapshot[k] = process.env[k];
  Object.assign(process.env, env);
  resetConfig();
  loadConfig();
  try {
    await fn();
  } finally {
    // 逐键还原（不能整体替换 process.env，否则会丢掉 vitest 自身的注入变量）
    for (const [k, v] of Object.entries(snapshot)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    resetConfig();
    loadConfig();
    // 还原后要重新套用基线：否则下一个用例会跑在"上一个用例残留"的环境下
    applyBaseEnv();
  }
}

/**
 * 默认环境：test + Mock 模式 + 注入开启 + 零延迟。
 *
 * ⚠️ 这里**不能**用 withEnv —— 它的 finally 会把刚设的值又还原掉，
 * 导致后续用例读到 MOCK_PROVIDER=false，注入类断言全部失真。
 * 基线环境需要"设置后保持"，故直接写 process.env 并重载配置。
 */
function applyBaseEnv(): void {
  process.env['NODE_ENV'] = 'test';
  process.env['MOCK_PROVIDER'] = 'true';
  process.env['MOCK_FAIL_INJECTION'] = 'true';
  process.env['MOCK_LATENCY_MS'] = '0';
  resetConfig();
  loadConfig();
}

beforeEach(async () => {
  redisStore.clear();
  resetMockJobs();
  applyBaseEnv();
});

// ---------------------------------------------------------------- 基本属性

describe('MockProvider —— 基本契约', () => {
  it('channelCode = mock', () => {
    expect(new MockProvider().channelCode).toBe('mock');
  });

  it('supportedCapabilities 覆盖全部 CAPABILITIES', () => {
    const p = new MockProvider();
    expect(p.supportedCapabilities).toHaveLength(10);
    expect(p.supportedCapabilities).toContain('text_to_video');
    expect(p.supportedCapabilities).toContain('tts');
    expect(p.supportedCapabilities).toContain('avatar_talk');
  });

  it('listModels 在 seed 未建 mock 渠道时返回 []（不抛）', async () => {
    await expect(new MockProvider().listModels()).resolves.toEqual([]);
  });

  it('submit 返回 mock_<taskId> 格式的 externalJobId', async () => {
    const p = new MockProvider();
    const res = await p.submit(req({ taskId: 'abc123' }), model, creds);
    expect(res.externalJobId).toBe('mock_abc123');
  });

  it('submit 把 job 状态写入 Redis（mock:job:<id>，跨进程可见）', async () => {
    const p = new MockProvider();
    await p.submit(req({ taskId: 'r1' }), model, creds);

    const raw = redisStore.get('mock:job:mock_r1');
    expect(raw).toBeDefined();
    const state = JSON.parse(raw!) as Record<string, unknown>;
    expect(state['taskId']).toBe('r1');
    expect(state['capability']).toBe('text_to_video');
    expect(typeof state['submittedAt']).toBe('number');
    expect(typeof state['latencyMs']).toBe('number');
  });

  it('validate 复用共享校验器', () => {
    const strict: ModelDescriptor = {
      ...model,
      paramMapping: { durationSec: { target: 'duration', type: 'select', allowed: [6, 10], required: true } },
      requiredParams: ['durationSec'],
    };
    const p = new MockProvider();
    expect(p.validate(req({ params: {} }), strict).valid).toBe(false);
    expect(p.validate(req({ params: { durationSec: 6 } }), strict).valid).toBe(true);
  });

  it('mapError 恒返回 PROVIDER_ERROR / retryable', () => {
    const p = new MockProvider();
    expect(p.mapError(new Error('whatever'))).toEqual({
      code: 'PROVIDER_ERROR',
      retryable: true,
      userMessage: 'mock failure',
    });
    expect(p.mapError('string error')).toEqual({
      code: 'PROVIDER_ERROR',
      retryable: true,
      userMessage: 'mock failure',
    });
  });
});

// ---------------------------------------------------------------- 延迟与进度

describe('MockProvider —— 延迟与进度', () => {
  it('未到延迟时间 → running 且 isFinal=false', async () => {
    const p = new MockProvider({ latencyMs: 60_000 });
    const { externalJobId } = await p.submit(req(), model, creds);

    const res = await p.poll(externalJobId, model, creds);
    expect(res.state).toBe('running');
    expect(res.isFinal).toBe(false);
    expect(res.progress).toBeGreaterThanOrEqual(5);
    expect(res.progress).toBeLessThanOrEqual(95);
  });

  it('到达延迟时间 → succeeded / progress=100 / isFinal=true', async () => {
    const p = new MockProvider({ latencyMs: 0 });
    const { externalJobId } = await p.submit(req(), model, creds);

    const res = await p.poll(externalJobId, model, creds);
    expect(res.state).toBe('succeeded');
    expect(res.isFinal).toBe(true);
    expect(res.progress).toBe(100);
    expect(res.refunded).toBe(false);
    expect(res.channelGroup).toBe('MOCK-G1');
    expect(res.costUnits).toBeGreaterThan(0);
  });

  it('进度随时间线性推进（越接近延迟越大）', async () => {
    const p = new MockProvider({ latencyMs: 400 });
    const { externalJobId } = await p.submit(req(), model, creds);

    const first = await p.poll(externalJobId, model, creds);
    await new Promise((r) => setTimeout(r, 200));
    const second = await p.poll(externalJobId, model, creds);
    await new Promise((r) => setTimeout(r, 250));
    const third = await p.poll(externalJobId, model, creds);

    expect(first.progress).toBeLessThan(second.progress!);
    expect(second.progress).toBeLessThan(third.progress!);
    expect(third.state).toBe('succeeded');
  });

  it('未知 job（Redis 过期）→ 报 running 而非 failed（交给超时扫描兜底）', async () => {
    const p = new MockProvider();
    const res = await p.poll('mock_never_submitted', model, creds);
    expect(res.state).toBe('running');
    expect(res.isFinal).toBe(false);
  });

  it('MOCK_LATENCY_MS 配置生效（构造参数优先）', async () => {
    const p = new MockProvider();
    const res = await p.submit(req(), model, creds);
    expect(res.estimatedSec).toBe(0); // setup 里 MOCK_LATENCY_MS=0
  });
});

// ---------------------------------------------------------------- 产出 fixture

describe('MockProvider —— 产物按 capability 决定', () => {
  const cases: Array<[Capability, string]> = [
    ['text_to_video', 'video/mp4'],
    ['image_to_video', 'video/mp4'],
    ['text_to_image', 'image/png'],
    ['image_to_image', 'image/png'],
    ['text_to_audio', 'audio/mpeg'],
    ['tts', 'audio/mpeg'],
    ['text_to_music', 'audio/mpeg'],
  ];

  for (const [capability, mimeType] of cases) {
    it(`${capability} → ${mimeType}`, async () => {
      const p = new MockProvider({ latencyMs: 0 });
      const { externalJobId } = await p.submit(req({ capability }), model, creds);
      const res = await p.poll(externalJobId, model, creds);

      expect(res.state).toBe('succeeded');
      expect(res.outputs).toHaveLength(1);
      expect(res.outputs?.[0]?.mimeType).toBe(mimeType);
      expect(res.outputs?.[0]?.remoteUrl).toMatch(/^http:\/\/localhost:8080\/mock-fixture\//);
    });
  }

  it('fixtureBaseUrl 可覆盖（供 transfer 队列真实下载）', async () => {
    const p = new MockProvider({ latencyMs: 0, fixtureBaseUrl: 'http://api:8080/' });
    const { externalJobId } = await p.submit(req(), model, creds);
    const res = await p.poll(externalJobId, model, creds);

    // 末尾斜杠被规整，不产生双斜杠
    expect(res.outputs?.[0]?.remoteUrl).toBe('http://api:8080/mock-fixture/video.mp4');
  });

  it('outputs[].meta 给出合理的 width/height/sizeBytes', async () => {
    const p = new MockProvider({ latencyMs: 0 });
    const { externalJobId } = await p.submit(req(), model, creds);
    const res = await p.poll(externalJobId, model, creds);

    const meta = res.outputs?.[0]?.meta;
    expect(meta?.width).toBeGreaterThan(0);
    expect(meta?.height).toBeGreaterThan(0);
    expect(meta?.durationSec).toBeGreaterThan(0);
    expect(meta?.sizeBytes).toBeGreaterThan(0);
  });

  it('costUnits 落在合理区间（不产生 0 成本）', async () => {
    const p = new MockProvider({ latencyMs: 0 });
    for (let i = 0; i < 20; i++) {
      const { externalJobId } = await p.submit(req({ taskId: `c${i}` }), model, creds);
      const res = await p.poll(externalJobId, model, creds);
      expect(res.costUnits).toBeGreaterThan(0);
      expect(res.costUnits).toBeLessThan(10);
    }
  });
});

// ---------------------------------------------------------------- 失败注入

describe('MockProvider —— 失败注入', () => {
  it('timeout → poll 永远 running（由 Worker 超时扫描兜底）', async () => {
    const p = new MockProvider({ latencyMs: 0 });
    const { externalJobId } = await p.submit(req({ params: { __mockFail: 'timeout' } }), model, creds);

    for (let i = 0; i < 5; i++) {
      const res = await p.poll(externalJobId, model, creds);
      expect(res.state).toBe('running');
      expect(res.isFinal).toBe(false);
    }
  });

  it('upstream_error → failed + retryable + refunded=true（可原样重提）', async () => {
    const p = new MockProvider({ latencyMs: 0 });
    const { externalJobId } = await p.submit(req({ params: { __mockFail: 'upstream_error' } }), model, creds);

    const res = await p.poll(externalJobId, model, creds);
    expect(res.state).toBe('failed');
    expect(res.isFinal).toBe(true);
    expect(res.refunded).toBe(true);
    expect(res.error?.retryable).toBe(true);
    expect(res.error?.code).toBe('PROVIDER_ERROR');
  });

  it('content_rejected → failed + 不可重试', async () => {
    const p = new MockProvider({ latencyMs: 0 });
    const { externalJobId } = await p.submit(req({ params: { __mockFail: 'content_rejected' } }), model, creds);

    const res = await p.poll(externalJobId, model, creds);
    expect(res.state).toBe('failed');
    expect(res.error?.code).toBe('CONTENT_REJECTED');
    expect(res.error?.retryable).toBe(false);
  });

  it('insufficient_balance → failed + PLATFORM_BALANCE + 不可重试（触发余额告警路径）', async () => {
    const p = new MockProvider({ latencyMs: 0 });
    const { externalJobId } = await p.submit(req({ params: { __mockFail: 'insufficient_balance' } }), model, creds);

    const res = await p.poll(externalJobId, model, creds);
    expect(res.state).toBe('failed');
    expect(res.error?.code).toBe('PLATFORM_BALANCE');
    expect(res.error?.retryable).toBe(false);
  });

  it('未注入失败 → 正常成功', async () => {
    const p = new MockProvider({ latencyMs: 0 });
    const { externalJobId } = await p.submit(req(), model, creds);
    const res = await p.poll(externalJobId, model, creds);
    expect(res.state).toBe('succeeded');
  });

  it('未知注入模式被忽略（不炸、按成功处理）', async () => {
    const p = new MockProvider({ latencyMs: 0 });
    const { externalJobId } = await p.submit(req({ params: { __mockFail: 'nonsense' } }), model, creds);
    const res = await p.poll(externalJobId, model, creds);
    expect(res.state).toBe('succeeded');
  });

  it('MOCK_FAIL_MODES 覆盖四种模式', () => {
    expect([...MOCK_FAIL_MODES].sort()).toEqual([
      'content_rejected',
      'insufficient_balance',
      'timeout',
      'upstream_error',
    ]);
    expect(isMockFailMode('timeout')).toBe(true);
    expect(isMockFailMode('nope')).toBe(false);
    expect(isMockFailMode(123)).toBe(false);
  });
});

// ---------------------------------------------------------------- 注入安全门槛

describe('MockProvider —— 失败注入的安全门槛', () => {
  it('MOCK_FAIL_INJECTION=false → 忽略注入', async () => {
    await withEnv({ MOCK_FAIL_INJECTION: 'false' }, async () => {
      const p = new MockProvider({ latencyMs: 0 });
      const { externalJobId } = await p.submit(req({ params: { __mockFail: 'content_rejected' } }), model, creds);
      const res = await p.poll(externalJobId, model, creds);
      expect(res.state).toBe('succeeded');
    });
  });

  it('MOCK_PROVIDER=false → **忽略注入**（真实上游模式下绝不注入）', async () => {
    await withEnv(
      { NODE_ENV: 'production', MOCK_PROVIDER: 'false', MOCK_FAIL_INJECTION: 'true' },
      async () => {
        const p = new MockProvider({ latencyMs: 0 });
        const { externalJobId } = await p.submit(
          req({ params: { __mockFail: 'insufficient_balance' } }),
          model,
          creds,
        );
        const res = await p.poll(externalJobId, model, creds);
        expect(res.state).toBe('succeeded');
      },
    );
  });

  it('构造参数 failInjection=false → 忽略注入（最高优先级）', async () => {
    await withEnv({ MOCK_PROVIDER: 'true', MOCK_FAIL_INJECTION: 'true' }, async () => {
      const p = new MockProvider({ latencyMs: 0, failInjection: false });
      const { externalJobId } = await p.submit(req({ params: { __mockFail: 'upstream_error' } }), model, creds);
      const res = await p.poll(externalJobId, model, creds);
      expect(res.state).toBe('succeeded');
    });
  });

  it('Mock 模式 + 开关开启 → 注入生效（含 NODE_ENV=production，因为生产部署本身即 Mock）', async () => {
    await withEnv(
      { NODE_ENV: 'production', MOCK_PROVIDER: 'true', MOCK_FAIL_INJECTION: 'true' },
      async () => {
        const p = new MockProvider({ latencyMs: 0 });
        const { externalJobId } = await p.submit(
          req({ params: { __mockFail: 'upstream_error' } }),
          model,
          creds,
        );
        const res = await p.poll(externalJobId, model, creds);
        expect(res.state).toBe('failed');
      },
    );
  });

  it('__mockFail 为数组时取首元素', async () => {
    const p = new MockProvider({ latencyMs: 0 });
    const { externalJobId } = await p.submit(
      req({ params: { __mockFail: ['content_rejected', 'x'] as unknown as string } }),
      model,
      creds,
    );
    const res = await p.poll(externalJobId, model, creds);
    expect(res.state).toBe('failed');
  });
});

// ---------------------------------------------------------------- cancel

describe('MockProvider —— cancel', () => {
  it('cancel 后 poll 返回 cancelled 终态', async () => {
    const p = new MockProvider({ latencyMs: 60_000 });
    const { externalJobId } = await p.submit(req(), model, creds);

    await p.cancel(externalJobId, model, creds);
    const res = await p.poll(externalJobId, model, creds);

    expect(res.state).toBe('cancelled');
    expect(res.isFinal).toBe(true);
  });

  it('cancel 未知 job 不抛错', async () => {
    await expect(new MockProvider().cancel('mock_nope', model, creds)).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------- fixture 合法性

describe('内嵌 fixture —— 必须是合法媒体文件（transfer 魔数校验要用）', () => {
  it('video.mp4 含 ftyp box', () => {
    const buf = mockFixtureBuffer('video.mp4');
    expect(buf).not.toBeNull();
    expect(buf!.subarray(4, 8).toString('ascii')).toBe('ftyp');
    expect(buf!.length).toBeGreaterThan(1000);
  });

  it('image.png 含 PNG 签名', () => {
    const buf = mockFixtureBuffer('image.png');
    expect(buf).not.toBeNull();
    expect([...buf!.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  });

  it('audio.mp3 含 ID3 头', () => {
    const buf = mockFixtureBuffer('audio.mp3');
    expect(buf).not.toBeNull();
    expect(buf!.subarray(0, 3).toString('ascii')).toBe('ID3');
  });

  it('MOCK_FIXTURES 声明的 sizeBytes 与实际解码长度一致', () => {
    for (const [name, def] of Object.entries(MOCK_FIXTURES)) {
      const buf = Buffer.from(def.base64, 'base64');
      expect(buf.length, name).toBe(def.sizeBytes);
    }
  });

  it('mockFixtureBuffer 对未知 name 返回 null', () => {
    expect(mockFixtureBuffer('nope.bin')).toBeNull();
  });
});

// ---------------------------------------------------------------- fixture 路由

describe('mockFixtureRoutes —— 真实可下载', () => {
  it('GET /mock-fixture/:name 返回正确 Content-Type 与字节', async () => {
    const Fastify = (await import('fastify')).default;
    const app = Fastify();
    const { mockFixtureRoutes } = await import('./mock.js');
    mockFixtureRoutes(app);
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/mock-fixture/video.mp4' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('video/mp4');
    expect(res.rawPayload.subarray(4, 8).toString('ascii')).toBe('ftyp');

    await app.close();
  });

  it('未知 fixture → 404', async () => {
    const Fastify = (await import('fastify')).default;
    const app = Fastify();
    const { mockFixtureRoutes } = await import('./mock.js');
    mockFixtureRoutes(app);
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/mock-fixture/etc-passwd' });
    expect(res.statusCode).toBe(404);

    await app.close();
  });

  it('目录穿越尝试被安全处理（不读到任意文件）', async () => {
    const Fastify = (await import('fastify')).default;
    const app = Fastify();
    const { mockFixtureRoutes } = await import('./mock.js');
    mockFixtureRoutes(app);
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/mock-fixture/..%2F..%2Fpackage.json' });
    expect(res.statusCode).toBe(404);

    await app.close();
  });

  it('三个 fixture 都能正常下发', async () => {
    const Fastify = (await import('fastify')).default;
    const app = Fastify();
    const { mockFixtureRoutes } = await import('./mock.js');
    mockFixtureRoutes(app);
    await app.ready();

    for (const [name, def] of Object.entries(MOCK_FIXTURES)) {
      const res = await app.inject({ method: 'GET', url: `/mock-fixture/${name}` });
      expect(res.statusCode, name).toBe(200);
      expect(res.headers['content-type']).toContain(def.mimeType);
      expect(res.rawPayload.length, name).toBe(def.sizeBytes);
    }

    await app.close();
  });
});
