/**
 * LK888 契约测试 —— **全部用 undici MockAgent 拦截 HTTP，绝不真连上游**。
 *
 * fixture 全部来自 `docs/lk888-capabilities.md`（§3.1 实测报文 / §8 错误码 / §10 实测记录）。
 *
 * ⚠️ **为什么不用 nock**（实测结论，勿回退）：
 * nock 劫持的是 `http.ClientRequest`，而本项目上游调用走 **undici 的 `request()`**
 * （自研 llhttp + 连接池，不走 node:http 客户端路径）。
 * 实测：`nock.disableNetConnect()` + nock 拦截后，undici `request()` **直接穿透真的打到了
 * `api.lk888.ai`**（返回真实 401 missing_api_key）。
 * 因此这里改用 undici 自带的 `MockAgent` + `setGlobalDispatcher`：
 * 命中已注册路由正常返回，未注册的请求抛 `MockNotMatchedError`，是真正的网络隔离。
 * `agent.disableNetConnect()` 进一步保证任何漏网请求都会失败而不是出网。
 *
 * 覆盖的平台"反直觉"点（PRD 附录 D，每条都对应一个真实踩坑）：
 * 1. `POST /v1/media/generate` 判 **`code=200`**，不是 HTTP 状态码
 * 2. `/v1/skills/*` 判**有无 `error` 对象**
 * 3. 终态必须看 **`is_final=true`**（status 文本不可信）
 * 4. 中文兼容字段（`任务ids`/`成功数量`）变更/缺失**不炸**
 * 5. 三种计费口径的 cost 解析（按次/按秒/按token）
 * 6. `refunded=true` 的失败解析
 * 7. `channel_group` 被平台忽略（我方不传；上游返回的分组只作记录）
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MockAgent, setGlobalDispatcher, getGlobalDispatcher, type Dispatcher } from 'undici';
import type { ChannelCreds, GenerationRequest, ModelDescriptor } from '../../src/core/types.js';
import { LingkeProvider, joinUrl, mapLingkeErrorType } from '../../src/modules/providers/lingke.js';

// ---------------------------------------------------------------- 常量

/** 平台基址（**已含 `/api`**，必须验证路径不重复拼接） */
const BASE = 'https://api.lk888.ai/api';
const ORIGIN = 'https://api.lk888.ai';

const creds: ChannelCreds = {
  apiKey: 'sk-test-0000000000000000000000000000ae56',
  apiKeyId: 'key-uuid-1',
  baseUrl: BASE,
  timeoutMs: 5000,
};

/** 一个典型的按次计费视频模型（viduq3，参数定义来自 §7 实测） */
const model: ModelDescriptor = {
  id: 'm-viduq3',
  code: 'viduq3',
  displayName: 'Vidu Q3',
  channelId: 'c-lk888',
  channelCode: 'lk888',
  capabilities: ['text_to_video'],
  paramMapping: {
    modelVariant: { target: 'model_variant', type: 'select', allowed: ['turbo', 'pro'], required: true, coerce: 'string' },
    resolution: { target: 'resolution', type: 'select', allowed: ['540p', '720p', '1080p'], required: true },
    durationSec: { target: 'duration', type: 'select', allowed: ['4', '8', '12', '16'], required: true, coerce: 'string' },
    aspectRatio: { target: 'aspect_ratio', type: 'select', allowed: ['16:9', '9:16'], required: true },
    offPeak: { target: 'off_peak', type: 'select', allowed: ['false', 'true'], required: true },
  },
  requiredParams: ['modelVariant', 'resolution', 'durationSec', 'aspectRatio', 'offPeak'],
  constraints: {},
  enabled: true,
  active: true,
  qualityScore: 90,
};

function req(over: Partial<GenerationRequest> = {}): GenerationRequest {
  return {
    taskId: 'task-1',
    capability: 'text_to_video',
    prompt: 'a golden retriever running on the beach at sunset',
    inputs: [],
    params: {
      modelVariant: 'turbo',
      resolution: '540p',
      durationSec: '4',
      aspectRatio: '16:9',
      offPeak: 'true',
    },
    idempotencyKey: 'idem-1',
    modelCode: 'viduq3',
    channelCode: 'lk888',
    ...over,
  };
}

const provider = new LingkeProvider();

// ---------------------------------------------------------------- MockAgent 装配

let agent: MockAgent;
let originalDispatcher: Dispatcher;
/** 捕获上游收到的请求（断言 header / body 用） */
let captured: Array<{ path: string; method: string; headers: Record<string, unknown>; body: string }>;

beforeEach(() => {
  originalDispatcher = getGlobalDispatcher();
  agent = new MockAgent();
  agent.disableNetConnect(); // 未注册的请求 → MockNotMatchedError，绝不出网
  setGlobalDispatcher(agent);
  captured = [];
});

afterEach(async () => {
  await agent.close();
  setGlobalDispatcher(originalDispatcher);
});

/** MockAgent 能直接序列化的响应体类型（不能用 unknown：undici 的 reply 是强类型的） */
type MockBody = string | object | Buffer;

/** 注册一个 POST /api/v1/media/generate 响应，并捕获请求 */
function mockGenerate(reply: { status?: number; body: MockBody }) {
  const pool = agent.get(ORIGIN);
  pool
    .intercept({ path: '/api/v1/media/generate', method: 'POST' })
    .reply((opts) => {
      captured.push({
        path: '/api/v1/media/generate',
        method: 'POST',
        headers: (opts.headers ?? {}) as Record<string, unknown>,
        body: typeof opts.body === 'string' ? opts.body : String(opts.body ?? ''),
      });
      return { statusCode: reply.status ?? 200, data: reply.body };
    });
  pool
    .intercept({ path: '/api/v1/media/generate', method: 'POST' })
    .reply(reply.status ?? 200, reply.body);
}

/** 注册一个 GET /api/v1/skills/task-status 响应 */
function mockTaskStatus(taskId: string, reply: { status?: number; body: MockBody }) {
  agent
    .get(ORIGIN)
    .intercept({ path: `/api/v1/skills/task-status?task_id=${taskId}`, method: 'GET' })
    .reply(reply.status ?? 200, reply.body);
}

/** MockAgent 捕获的 header 保留原始大小写 → 归一化为小写键便于断言 */
function lowerHeaders(h: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(h)) out[k.toLowerCase()] = v;
  return out;
}

// ---------------------------------------------------------------- 成功判定

describe('submit —— 成功判定只看 code=200（不是 HTTP 状态）', () => {
  it('HTTP 200 + code=200 → 成功，读 data.task_id', async () => {
    mockGenerate({ body: { code: 200, data: { task_id: 135983791 } } });

    const res = await provider.submit(req(), model, creds);

    expect(res.externalJobId).toBe('135983791');
  });

  it('HTTP 200 但 code=400（业务失败）→ **必须判失败**', async () => {
    // 平台会用 HTTP 200 返回业务错误 —— 只看 HTTP 状态就会误判成成功
    mockGenerate({ body: { code: 400, msg: 'invalid params: resolution', data: null } });

    await expect(provider.submit(req(), model, creds)).rejects.toThrow(/invalid params/i);
  });

  it('HTTP 200 但 code=500 → 判失败', async () => {
    mockGenerate({ body: { code: 500, msg: 'upstream exploded' } });
    await expect(provider.submit(req(), model, creds)).rejects.toThrow();
  });

  it('HTTP 500 但 code=200 → **只有 code 说了算，判成功**', async () => {
    mockGenerate({ status: 500, body: { code: 200, data: { task_id: 999 } } });

    const res = await provider.submit(req(), model, creds);
    expect(res.externalJobId).toBe('999');
  });

  it('code=200 但缺 data.task_id → 判失败（绝不猜中文兼容字段）', async () => {
    mockGenerate({ body: { code: 200, data: { 任务ids: [999], 成功数量: 1 } } });

    await expect(provider.submit(req(), model, creds)).rejects.toThrow(/task_id missing/i);
  });

  it('中文兼容字段与 task_id 并存时不炸（忽略兼容字段）', async () => {
    mockGenerate({
      body: { code: 200, data: { task_id: 135983791, 任务ids: [135983791], 对话组ID: 'g-1', 成功数量: 1 } },
    });

    const res = await provider.submit(req(), model, creds);
    expect(res.externalJobId).toBe('135983791');
  });

  it('请求体**不含** notify_url 与 channel_group（首期纯轮询 + 平台忽略该字段）', async () => {
    mockGenerate({ body: { code: 200, data: { task_id: 1 } } });

    await provider.submit(req({ callbackUrl: 'https://our.app/webhook' }), model, creds);

    const body = JSON.parse(captured[0]?.body ?? '{}') as Record<string, unknown>;
    expect(body).not.toHaveProperty('notify_url');
    expect(body).not.toHaveProperty('channel_group');
    expect(body['model']).toBe('viduq3');
    expect(body['prompt']).toBe('a golden retriever running on the beach at sunset');
  });

  it('params 按 target 映射为上游字段名', async () => {
    mockGenerate({ body: { code: 200, data: { task_id: 1 } } });

    await provider.submit(req(), model, creds);

    const body = JSON.parse(captured[0]?.body ?? '{}') as Record<string, unknown>;
    expect(body['params']).toEqual({
      model_variant: 'turbo',
      resolution: '540p',
      duration: '4',
      aspect_ratio: '16:9',
      off_peak: 'true',
    });
  });

  it('Authorization 头带 Bearer Key，X-Request-Id 存在', async () => {
    mockGenerate({ body: { code: 200, data: { task_id: 1 } } });

    await provider.submit(req(), model, creds);

    // MockAgent 捕获的 header 保留原始大小写，这里大小写不敏感地取值
    const h = lowerHeaders(captured[0]?.headers ?? {});
    expect(h['authorization']).toBe(`Bearer ${creds.apiKey}`);
    expect(h['x-request-id']).toBe('gen-task-1');
  });

  it('路径拼接不重复 /api（baseUrl 已含 /api）', async () => {
    // MockAgent 只注册了 /api/v1/media/generate；若拼成 /api/api/v1/... 会抛 MockNotMatchedError
    mockGenerate({ body: { code: 200, data: { task_id: 7 } } });
    const res = await provider.submit(req(), model, creds);
    expect(res.externalJobId).toBe('7');
  });
});

describe('joinUrl —— 路径拼接', () => {
  it('baseUrl 含 /api，端点以 /v1 开头 → 不重复', () => {
    expect(joinUrl('https://api.lk888.ai/api', '/v1/media/generate')).toBe(
      'https://api.lk888.ai/api/v1/media/generate',
    );
  });

  it('baseUrl 末尾多余斜杠被规整', () => {
    expect(joinUrl('https://api.lk888.ai/api/', '/v1/skills/task-status')).toBe(
      'https://api.lk888.ai/api/v1/skills/task-status',
    );
  });

  it('端点缺前导斜杠也能拼', () => {
    expect(joinUrl('https://api.lk888.ai/api', 'v1/media/generate')).toBe(
      'https://api.lk888.ai/api/v1/media/generate',
    );
  });
});

// ---------------------------------------------------------------- is_final

describe('poll —— 终态判定必须看 is_final（不是 status 文本）', () => {
  it('status=processing 但 is_final=true 且 success → **必须判终态成功**', async () => {
    // 真实踩坑：平台 status 文本是中文且可能滞后/本地化，只有 is_final 是契约
    mockTaskStatus('135983791', {
      body: {
        task_id: 135983791,
        model: 'viduq3',
        status: 'processing',
        status_group: '进行中',
        state: 'success',
        progress: '100',
        is_final: true,
        result_url: 'https://tos.lingkeai.vip/uploads/x.mp4',
        result_type: 'video',
        cost: 0.2753,
        channel_group: 'TX-Y3',
        refunded: false,
      },
    });

    const res = await provider.poll('135983791', model, creds);

    expect(res.isFinal).toBe(true);
    expect(res.state).toBe('succeeded');
    expect(res.outputs?.[0]?.remoteUrl).toBe('https://tos.lingkeai.vip/uploads/x.mp4');
    expect(res.outputs?.[0]?.mimeType).toBe('video/mp4');
    expect(res.costUnits).toBe(0.2753);
    expect(res.channelGroup).toBe('TX-Y3');
  });

  it('status=已完成 但 is_final=false → **必须判未终态**（继续轮询）', async () => {
    mockTaskStatus('2', {
      body: {
        task_id: 2,
        status: '已完成',
        status_group: '已完成',
        state: 'success',
        progress: '100',
        is_final: false, // ← 尚未终态
        result_url: null,
      },
    });

    const res = await provider.poll('2', model, creds);

    expect(res.isFinal).toBe(false);
    expect(res.state).toBe('running');
    expect(res.outputs).toBeUndefined();
  });

  it('处理中（is_final=false）→ running，带 progress', async () => {
    mockTaskStatus('3', {
      body: { task_id: 3, status: '处理中', status_group: '进行中', state: 'processing', progress: '42', is_final: false },
    });

    const res = await provider.poll('3', model, creds);
    expect(res.state).toBe('running');
    expect(res.isFinal).toBe(false);
    expect(res.progress).toBe(42);
  });

  it('is_final=true + state=failed → failed 终态', async () => {
    mockTaskStatus('4', {
      body: {
        task_id: 4,
        status: '生成失败',
        status_group: '失败',
        state: 'failed',
        is_final: true,
        refunded: true,
        refunded_amount: 0.2753,
        cost: 0.2753,
        error: { type: 'upstream_error', message: 'upstream timeout' },
      },
    });

    const res = await provider.poll('4', model, creds);

    expect(res.isFinal).toBe(true);
    expect(res.state).toBe('failed');
    expect(res.error?.retryable).toBe(true);
    expect(res.refunded).toBe(true);
  });

  it('progress 是字符串也能解析', async () => {
    mockTaskStatus('5', { body: { task_id: 5, state: 'processing', progress: '77', is_final: false } });

    const res = await provider.poll('5', model, creds);
    expect(res.progress).toBe(77);
  });

  it('result_urls 数组 → 多个产物', async () => {
    mockTaskStatus('6', {
      body: {
        task_id: 6,
        state: 'success',
        is_final: true,
        result_url: 'https://tos.lingkeai.vip/a.mp4',
        result_urls: ['https://tos.lingkeai.vip/a.mp4', 'https://tos.lingkeai.vip/b.mp4'],
        result_type: 'video',
      },
    });

    const res = await provider.poll('6', model, creds);
    expect(res.outputs).toHaveLength(2);
    expect(res.outputs?.map((o) => o.remoteUrl)).toEqual([
      'https://tos.lingkeai.vip/a.mp4',
      'https://tos.lingkeai.vip/b.mp4',
    ]);
  });
});

// ---------------------------------------------------------------- 中文兼容字段

describe('中文兼容字段变更/缺失不炸', () => {
  it('task-status 只有中文 status 字段，无 state → 仍能解析终态', async () => {
    mockTaskStatus('10', {
      body: {
        task_id: 10,
        status: '已完成',
        status_group: '已完成',
        // 没有 state 字段（可能被平台下线），但有 result_url
        is_final: true,
        result_url: 'https://tos.lingkeai.vip/c.mp4',
      },
    });

    const res = await provider.poll('10', model, creds);
    expect(res.state).toBe('succeeded');
    expect(res.outputs?.[0]?.remoteUrl).toBe('https://tos.lingkeai.vip/c.mp4');
  });

  it('status 字段被完全移除（只剩 is_final）→ 不炸，按 failed 处理', async () => {
    mockTaskStatus('11', { body: { task_id: 11, is_final: true, state: 'failed' } });

    const res = await provider.poll('11', model, creds);
    expect(res.state).toBe('failed');
    expect(res.error).toBeDefined();
  });

  it('submit 响应含未知/新增字段 → 不炸', async () => {
    mockGenerate({ body: { code: 200, data: { task_id: 12, 未来字段: { nested: true }, another: [1, 2, 3] }, extra: 'whatever' } });

    const res = await provider.submit(req(), model, creds);
    expect(res.externalJobId).toBe('12');
  });

  it('poll 响应含未知字段 → 不炸', async () => {
    mockTaskStatus('13', {
      body: {
        task_id: 13,
        is_final: true,
        state: 'success',
        result_url: 'https://tos.lingkeai.vip/d.mp4',
        未来新增: 'x',
        nested: { a: { b: 1 } },
      },
    });

    const res = await provider.poll('13', model, creds);
    expect(res.state).toBe('succeeded');
  });

  it('中文兼容字段被整体删除 → 不炸', async () => {
    mockGenerate({ body: { code: 200, data: { task_id: 14 } } });
    const res = await provider.submit(req(), model, creds);
    expect(res.externalJobId).toBe('14');
  });
});

// ---------------------------------------------------------------- 三种计费口径

describe('三种计费口径的 cost 解析', () => {
  it('按次（per_call）：cost 为固定单价', async () => {
    mockTaskStatus('20', {
      body: {
        task_id: 20,
        state: 'success',
        is_final: true,
        result_url: 'https://tos.lingkeai.vip/a.mp4',
        cost: 3.1036, // kling-v3-video TX-Y3 按次
        channel_group: 'TX-Y3',
        status_group: '已完成',
      },
    });

    const res = await provider.poll('20', model, creds);
    expect(res.costUnits).toBe(3.1036);
    // channelGroup 取自 channel_group（实际命中分组），不是 status_group（中文任务分组）
    expect(res.channelGroup).toBe('TX-Y3');
  });

  it('channelGroup 只认 channel_group，不会误取 status_group', async () => {
    mockTaskStatus('25', {
      body: {
        task_id: 25,
        state: 'success',
        is_final: true,
        result_url: 'https://tos.lingkeai.vip/e.mp4',
        channel_group: '火山官方',
        status_group: '已完成',
      },
    });

    const res = await provider.poll('25', model, creds);
    expect(res.channelGroup).toBe('火山官方');
  });

  it('按秒（per_second）：cost 随时长变化', async () => {
    mockTaskStatus('21', {
      body: {
        task_id: 21,
        state: 'success',
        is_final: true,
        result_url: 'https://tos.lingkeai.vip/b.mp4',
        cost: 4.6554, // 15s 档（10 秒 ×2、15 秒 ×3 的档位逻辑）
        duration_seconds: 147,
      },
    });

    const res = await provider.poll('21', model, creds);
    expect(res.costUnits).toBe(4.6554);
  });

  it('按 token：cost 由 token 数折算（base_price=0 不代表免费）', async () => {
    // 平台陷阱：按 token 计费时 base_price 恒为 0，成交价看 output_token_price
    mockTaskStatus('22', {
      body: {
        task_id: 22,
        state: 'success',
        is_final: true,
        result_url: 'https://tos.lingkeai.vip/c.mp4',
        cost: 2.61, // 5 秒 720p 约 2.6~7.6 算力
      },
    });

    const res = await provider.poll('22', model, creds);
    expect(res.costUnits).toBe(2.61);
  });

  it('cost 为字符串也能解析为数字', async () => {
    mockTaskStatus('23', {
      body: { task_id: 23, state: 'success', is_final: true, result_url: 'https://x/a.mp4', cost: '0.2753' },
    });

    const res = await provider.poll('23', model, creds);
    expect(res.costUnits).toBe(0.2753);
  });

  it('缺 cost 字段 → costUnits 为 undefined（交给定价层兜底，不假装 0）', async () => {
    mockTaskStatus('24', { body: { task_id: 24, state: 'success', is_final: true, result_url: 'https://x/a.mp4' } });

    const res = await provider.poll('24', model, creds);
    expect(res.costUnits).toBeUndefined();
  });
});

// ---------------------------------------------------------------- refunded

describe('refunded=true 的失败解析', () => {
  it('refunded=true + upstream_error → 可原样重提（retryable）', async () => {
    mockTaskStatus('30', {
      body: {
        task_id: 30,
        state: 'failed',
        is_final: true,
        refunded: true,
        refunded_amount: 0.2753,
        cost: 0.2753,
        error: { type: 'upstream_error', message: 'upstream timeout after 300s' },
      },
    });

    const res = await provider.poll('30', model, creds);
    expect(res.refunded).toBe(true);
    expect(res.error?.retryable).toBe(true);
    expect(res.costUnits).toBe(0.2753);
  });

  it('refunded=false + 内容政策拒绝 → 不可重试（应改提示词）', async () => {
    mockTaskStatus('31', {
      body: {
        task_id: 31,
        state: 'failed',
        is_final: true,
        refunded: false,
        error: { type: 'invalid_request_error', message: 'content policy violation detected' },
      },
    });

    const res = await provider.poll('31', model, creds);
    expect(res.refunded).toBe(false);
    expect(res.error?.retryable).toBe(false);
    expect(res.error?.code).toBe('CONTENT_REJECTED');
  });

  it('refunded=true 时即使类型是 invalid_request_error 也可重试', async () => {
    // 上游已退费 = 平台确认这次没扣钱 → 原样重提是安全的
    mockTaskStatus('32', {
      body: {
        task_id: 32,
        state: 'failed',
        is_final: true,
        refunded: true,
        error: { type: 'invalid_request_error', message: 'temporary param issue' },
      },
    });

    const res = await provider.poll('32', model, creds);
    expect(res.error?.retryable).toBe(true);
  });
});

// ---------------------------------------------------------------- /v1/skills/* 错误判定

describe('poll —— /v1/skills/* 判有无 error 对象', () => {
  it('返回 error 对象 → 抛错（即使 HTTP 200）', async () => {
    mockTaskStatus('40', { body: { error: { type: 'not_found', message: 'task not found' } } });

    await expect(provider.poll('40', model, creds)).rejects.toThrow(/not_found/);
  });

  it('error 为 null → 不算错误，正常解析', async () => {
    mockTaskStatus('41', {
      body: { task_id: 41, state: 'success', is_final: true, result_url: 'https://x/a.mp4', error: null },
    });

    const res = await provider.poll('41', model, creds);
    expect(res.state).toBe('succeeded');
  });

  it('HTTP 429 + error 对象 → 抛错', async () => {
    mockTaskStatus('42', { status: 429, body: { error: { type: 'rate_limit_exceeded', message: 'too many requests' } } });

    await expect(provider.poll('42', model, creds)).rejects.toThrow(/rate_limit/);
  });
});

// ---------------------------------------------------------------- mapError

describe('mapError —— §4.2 错误映射表', () => {
  it('invalid_request_error → INVALID_PARAMS 不可重试', () => {
    expect(mapLingkeErrorType('invalid_request_error')).toMatchObject({
      code: 'INVALID_PARAMS',
      retryable: false,
    });
  });

  it('insufficient_balance → PLATFORM_BALANCE 不可重试（触发 P0 告警）', () => {
    expect(mapLingkeErrorType('insufficient_balance')).toMatchObject({
      code: 'PLATFORM_BALANCE',
      retryable: false,
    });
  });

  it('rate_limit_exceeded → RATE_LIMITED 可重试', () => {
    expect(mapLingkeErrorType('rate_limit_exceeded')).toMatchObject({
      code: 'RATE_LIMITED',
      retryable: true,
    });
  });

  it('upstream_error → PROVIDER_ERROR 可重试', () => {
    expect(mapLingkeErrorType('upstream_error')).toMatchObject({
      code: 'PROVIDER_ERROR',
      retryable: true,
    });
  });

  it('submit 的 insufficient_balance 错误带上 lingkeType → mapError 正确映射', async () => {
    mockGenerate({ status: 402, body: { error: { type: 'insufficient_balance', message: 'balance is not enough' } } });

    const e = await provider.submit(req(), model, creds).catch((x: unknown) => x);
    const mapped = provider.mapError(e);
    expect(mapped.code).toBe('PLATFORM_BALANCE');
    expect(mapped.retryable).toBe(false);
  });

  it('网络超时类错误 → PROVIDER_ERROR 可重试', () => {
    const e = new Error('headers timeout');
    e.name = 'HeadersTimeoutError';
    expect(provider.mapError(e)).toMatchObject({ code: 'PROVIDER_ERROR', retryable: true });
  });

  it('未知错误兜底 → PROVIDER_ERROR 可重试', () => {
    expect(provider.mapError(new Error('totally unknown'))).toMatchObject({
      code: 'PROVIDER_ERROR',
      retryable: true,
    });
  });

  it('映射结果恒有 userMessage（用户可读）', () => {
    for (const t of [
      'invalid_request_error',
      'insufficient_balance',
      'rate_limit_exceeded',
      'upstream_error',
      'server_error',
      'not_found',
      'authentication_error',
    ]) {
      const m = mapLingkeErrorType(t);
      expect(m.userMessage.length).toBeGreaterThan(0);
      expect(m.code.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------- channel_group 忽略

describe('channel_group 被平台忽略（行为锁定）', () => {
  it('submit 请求体不带 channel_group', async () => {
    mockGenerate({ body: { code: 200, data: { task_id: 1 } } });

    await provider.submit(req(), model, creds);

    const body = JSON.parse(captured[0]?.body ?? '{}') as Record<string, unknown>;
    expect(body).not.toHaveProperty('channel_group');
  });

  it('即使请求 params 被强行塞了 channel_group，也不会透传上游', async () => {
    mockGenerate({ body: { code: 200, data: { task_id: 55 } } });

    // 攻击性输入：params 里带 channel_group（未在映射表里 → 被丢弃）
    const res = await provider.submit(
      req({ params: { ...req().params, channel_group: 'TX-Y3' } }),
      model,
      creds,
    );

    expect(res.externalJobId).toBe('55');
    const body = JSON.parse(captured[0]?.body ?? '{}') as Record<string, unknown>;
    const params = body['params'] as Record<string, unknown>;
    expect(params).not.toHaveProperty('channel_group');
  });

  it('上游返回的 channel_group 只作为记录读取（不可请求指定）', async () => {
    mockTaskStatus('56', {
      body: {
        task_id: 56,
        state: 'success',
        is_final: true,
        result_url: 'https://x/a.mp4',
        channel_group: '火山官方',
      },
    });

    const res = await provider.poll('56', model, creds);
    expect(res.channelGroup).toBe('火山官方');
  });
});

// ---------------------------------------------------------------- cancel

describe('cancel —— 平台不支持则静默成功', () => {
  it('不抛错（调用方据此本地置 cancelled + 返还积分）', async () => {
    await expect(provider.cancel('135983791', model, creds)).resolves.toBeUndefined();
  });

  it('不发任何 HTTP 请求（平台无取消端点；未注册路由会抛 MockNotMatchedError）', async () => {
    await provider.cancel('1', model, creds);
    // 走到这里即证明没有出网请求
    expect(true).toBe(true);
  });
});

// ---------------------------------------------------------------- validate 委托

describe('validate —— 委托给共享校验器', () => {
  it('缺 required 参数报错', () => {
    const res = provider.validate(req({ params: {} }), model);
    expect(res.valid).toBe(false);
    expect(res.errors?.length).toBeGreaterThan(0);
  });

  it('合法参数通过', () => {
    expect(provider.validate(req(), model).valid).toBe(true);
  });
});

// ---------------------------------------------------------------- 网络隔离保证

describe('网络隔离（硬性要求 #4）', () => {
  it('未注册的上游请求抛 MockNotMatchedError，绝不出网', async () => {
    const { request } = await import('undici');
    await expect(request(`${ORIGIN}/api/v1/not-registered`)).rejects.toThrow(/Mock dispatch not matched/);
  });

  it('指向 mock 之外域名的请求同样被拦截', async () => {
    const { request } = await import('undici');
    await expect(request('https://evil.example.com/x')).rejects.toThrow();
  });

  it('provider 调的每个上游请求都必须命中已注册路由（否则上面的隔离断言会失败）', async () => {
    // 正向用例：注册即通
    mockGenerate({ body: { code: 200, data: { task_id: 123 } } });
    await expect(provider.submit(req(), model, creds)).resolves.toMatchObject({ externalJobId: '123' });
  });
});

// ---------------------------------------------------------------- Mock 模式硬保险

describe('Mock 模式硬保险（MOCK_PROVIDER=true 时拒绝出网）', () => {
  it('MOCK_PROVIDER=true 时 submit 抛 MockModeViolationError，且不发任何请求', async () => {
    const { loadConfig, resetConfig } = await import('../../src/core/config.js');
    const { MockModeViolationError } = await import('../../src/modules/providers/lingke.js');

    const original = { ...process.env };
    process.env['MOCK_PROVIDER'] = 'true';
    resetConfig();
    loadConfig();

    try {
      // 故意**不注册**任何路由：若真发了请求会抛 MockNotMatchedError，从而暴露问题
      const e = await provider.submit(req(), model, creds).catch((x: unknown) => x);
      expect(e).toBeInstanceOf(MockModeViolationError);
      expect((e as Error).message).toContain('MOCK_PROVIDER=true');
    } finally {
      process.env = original;
      resetConfig();
      loadConfig();
    }
  });

  it('MOCK_PROVIDER=true 时 poll 同样被拒绝', async () => {
    const { loadConfig, resetConfig } = await import('../../src/core/config.js');
    const { MockModeViolationError } = await import('../../src/modules/providers/lingke.js');

    const original = { ...process.env };
    process.env['MOCK_PROVIDER'] = 'true';
    resetConfig();
    loadConfig();

    try {
      const e = await provider.poll('1', model, creds).catch((x: unknown) => x);
      expect(e).toBeInstanceOf(MockModeViolationError);
    } finally {
      process.env = original;
      resetConfig();
      loadConfig();
    }
  });

  it('MOCK_PROVIDER=false 时正常出网（硬保险不误伤）', async () => {
    mockGenerate({ body: { code: 200, data: { task_id: 321 } } });
    const res = await provider.submit(req(), model, creds);
    expect(res.externalJobId).toBe('321');
  });
});
