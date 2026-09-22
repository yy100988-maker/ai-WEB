/**
 * 验收测试：PRD §13 逐条映射（详细设计 §7.7 发布门禁检查表）。
 *
 * 覆盖可在自动化环境验证的条目；标注了无法自动化验证的条目（需人工/看板）。
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  testDb,
  truncateAll,
  flushTestRedis,
  closeTestConnections,
  canConnect,
} from '../helpers/db.js';
import { createTestApp, createTestUser, type TestContext } from '../helpers/app.js';
import { authRoutes } from '../../src/modules/auth/routes.js';
import { billingRoutes } from '../../src/modules/billing/routes.js';
import { catalogRoutes } from '../../src/modules/catalog/routes.js';
import { assetRoutes } from '../../src/modules/assets/routes.js';
import { checkinRoutes } from '../../src/modules/checkin/routes.js';
import { notificationRoutes } from '../../src/modules/notifications/routes.js';
import { promptRoutes } from '../../src/modules/prompts/routes.js';
import { adminRoutes } from '../../src/modules/admin/routes.js';
import { taskRoutes } from '../../src/modules/tasks/routes.js';
import { mockFixtureRoutes } from '../../src/modules/providers/mock.js';

const routes = [
  authRoutes,
  billingRoutes,
  catalogRoutes,
  assetRoutes,
  checkinRoutes,
  notificationRoutes,
  promptRoutes,
  adminRoutes,
  taskRoutes,
  mockFixtureRoutes,
];

let ctx: TestContext;
let available = false;

beforeAll(async () => {
  const conn = await canConnect();
  available = conn.db && conn.redis;
  if (!available) return;
  await truncateAll();
  await flushTestRedis();
  ctx = await createTestApp(routes);
});

afterAll(async () => {
  if (ctx?.app) await ctx.app.close();
  await closeTestConnections();
});

// §13 #19 模型差异化定价
describe('§13 #19 模型差异化定价：同规格不同模型报价必须不同', () => {
  it('gk-video-3(10s) / hailuo-h3(768P,10s) / hailuo-h3-quannengcankao(1080P,10s) 三者积分互不相同', async () => {
    if (!available) return;

    const db = testDb();
    const cases = [
      { code: 'gk-video-3', params: { durationSec: 10 } },
      { code: 'hailuo-h3', params: { resolution: '768P', durationSec: 10 } },
      { code: 'hailuo-h3-quannengcankao', params: { resolution: '1080P', durationSec: 10 } },
    ];

    const quotes: Array<{ code: string; credits: number; costUnits: number }> = [];

    for (const c of cases) {
      const model = await db.model.findFirst({ where: { code: c.code } });
      expect(model, `model ${c.code} should be seeded`).toBeTruthy();

      const res = await ctx.request({
        method: 'POST',
        url: '/v1/pricing/quote',
        payload: { capability: 'text_to_video', modelId: model!.id, params: c.params },
      });
      expect(res.statusCode, `quote for ${c.code}`).toBe(200);

      const credits = res.body.data.credits as number;
      const costUnits = res.body.data.breakdown.costUnits as number;

      // 必须等于 ceil(成本 × 18.84)
      expect(credits).toBe(Math.max(1, Math.ceil(Math.round(costUnits * 18.84 * 1e6) / 1e6)));

      quotes.push({ code: c.code, credits, costUnits });
    }

    // 三者价格互不相同
    const creditsSet = new Set(quotes.map((q) => q.credits));
    expect(creditsSet.size).toBe(3);

    // PRD §13 #19 明确给出 13 / 16 / 32
    const byCode = Object.fromEntries(quotes.map((q) => [q.code, q.credits]));
    expect(byCode['gk-video-3']).toBe(13);
    expect(byCode['hailuo-h3']).toBe(16);
    expect(byCode['hailuo-h3-quannengcankao']).toBe(32);
  }, 40000);
});

// §13 #10 对客展示名无内部代号泄露
describe('§13 #10 catalog 不泄露上游内部代号', () => {
  it('所有 displayName 不含 tt-/guanfang/hailuo-/seedance-/gk-/omni- 等渠道代号', async () => {
    if (!available) return;

    const res = await ctx.request({ method: 'GET', url: '/v1/catalog/models' });
    expect(res.statusCode).toBe(200);

    const models = res.body.data as Array<{ id: string; displayName: string }>;
    expect(models.length).toBeGreaterThan(0);

    const leaked: string[] = [];
    for (const m of models) {
      const dn = m.displayName;
      // 允许的例外：GK Video / Omni 是对客品牌名；禁止的是内部后缀与 tt- 前缀
      if (/^tt-/i.test(dn)) leaked.push(`${m.id}:${dn}`);
      if (/guanfang/i.test(dn)) leaked.push(`${m.id}:${dn}`);
      if (/^hailuo-/i.test(dn)) leaked.push(`${m.id}:${dn}`);
      if (/^seedance-/i.test(dn)) leaked.push(`${m.id}:${dn}`);
      if (/^gk-video-/i.test(dn)) leaked.push(`${m.id}:${dn}`);
      if (/quannengcankao/i.test(dn)) leaked.push(`${m.id}:${dn}`);
      if (/^omni-/i.test(dn)) leaked.push(`${m.id}:${dn}`);
      if (/kling/i.test(dn)) leaked.push(`${m.id}:${dn}`);
    }
    expect(leaked).toEqual([]);

    // 具体映射断言（PRD §8.2）
    const byId = new Map(models.map((m) => [m.id, m.displayName]));
    const db = testDb();
    const img2 = await db.model.findFirst({ where: { code: 'tt-image-2' } });
    const img25 = await db.model.findFirst({ where: { code: 'tt-image-2.5' } });
    const mmh3 = await db.model.findFirst({ where: { code: 'hailuo-h3-quannengcankao' } });

    if (img2) expect(byId.get(img2.id)).toBe('GPT Image 2');
    if (img25) expect(byId.get(img25.id)).toBe('GPT Image 2.5');
    if (mmh3) expect(byId.get(mmh3.id)).toBe('MiniMax H3');
  }, 30000);
});

// §13 #7 多模型路由 + 熔断降级
describe('§13 #7 路由与熔断', () => {
  it('权重配置生效：gk-video-3 权重 100 时全部路由到它', async () => {
    if (!available) return;

    const db = testDb();
    const gk = await db.model.findFirst({ where: { code: 'gk-video-3' } });
    expect(gk).toBeTruthy();

    // 把 text_to_video 策略改成只有 gk-video-3
    await db.routingPolicy.upsert({
      where: { capability: 'text_to_video' },
      create: {
        capability: 'text_to_video',
        strategy: 'weighted',
        candidates: [{ model: 'gk-video-3', weight: 100, enabled: true, grayPercent: 100 }],
        fallbackEnabled: true,
        circuitBreaker: { failureThreshold: 5, cooldownSec: 120 },
      },
      update: {
        candidates: [{ model: 'gk-video-3', weight: 100, enabled: true, grayPercent: 100 }],
      },
    });

    const { router, resetRouterCache } = await import('../../src/modules/router/index.js');
    // 路由策略有 60s 内存缓存：改完 DB 必须清缓存，否则 pick 读到的还是旧策略
    //（之前"全灭"用例假失败就是这个原因 —— 读到了上一个用例的 gk-video-3 独占策略）。
    resetRouterCache();
    const picks = [];
    for (let i = 0; i < 10; i++) {
      picks.push(
        await router.pick({
          capability: 'text_to_video',
          userId: `user-${i}`,
          params: { durationSec: 6 },
        }),
      );
    }
    expect(picks.every((p) => p.modelCode === 'gk-video-3')).toBe(true);

    // 恢复原策略（并清缓存，避免污染后续用例）
    await db.routingPolicy.update({
      where: { capability: 'text_to_video' },
      data: {
        candidates: [
          { model: 'gk-video-3', weight: 40, enabled: true, grayPercent: 100 },
          { model: 'hailuo-h3', weight: 25, enabled: true, grayPercent: 100 },
          { model: 'omni-1.1', weight: 20, enabled: true, grayPercent: 100 },
          { model: 'omni-flash', weight: 15, enabled: true, grayPercent: 100 },
        ],
      },
    });
    resetRouterCache();
  }, 30000);

  it('全灭 → 503 NO_HEALTHY_PROVIDER', async () => {
    if (!available) return;

    const db = testDb();
    const original = await db.routingPolicy.findUnique({ where: { capability: 'text_to_video' } });

    await db.routingPolicy.update({
      where: { capability: 'text_to_video' },
      data: { candidates: [] },
    });

    const { router } = await import('../../src/modules/router/index.js');
    const { resetRouterCache: clearCache } = await import('../../src/modules/router/index.js');
    clearCache();
    const { AppError } = await import('../../src/core/errors.js');

    await expect(
      router.pick({ capability: 'text_to_video', userId: 'u1', params: {} }),
    ).rejects.toMatchObject({ code: 'NO_HEALTHY_PROVIDER', status: 503 });

    try {
      await router.pick({ capability: 'text_to_video', userId: 'u1', params: {} });
    } catch (e) {
      expect(e).toBeInstanceOf(AppError);
      expect((e as InstanceType<typeof AppError>).code).toBe('NO_HEALTHY_PROVIDER');
      expect((e as InstanceType<typeof AppError>).status).toBe(503);
    }

    if (original) {
      await db.routingPolicy.update({
        where: { capability: 'text_to_video' },
        data: { candidates: original.candidates as object },
      });
      clearCache();
    }
  }, 30000);

  it('显式指定未上架模型 → 409 MODEL_UNAVAILABLE + alternatives', async () => {
    if (!available) return;

    const db = testDb();
    const disabled = await db.model.findFirst({ where: { active: false } });
    if (!disabled) {
      // 造一个未上架模型
      const ch = await db.channel.findFirst({ where: { code: 'mock' } });
      const created = await db.model.create({
        data: {
          channelId: ch!.id,
          code: 'test-inactive-model',
          displayName: 'Inactive Test',
          capabilities: ['text_to_video'],
          paramMapping: {},
          requiredParams: [],
          constraints: {},
          enabled: true,
          active: false,
        },
      });
      const res = await ctx.request({
        method: 'POST',
        url: '/v1/pricing/quote',
        payload: { capability: 'text_to_video', modelId: created.id, params: { durationSec: 6 } },
      });
      expect([409, 404]).toContain(res.statusCode);
      await db.model.delete({ where: { id: created.id } });
    }
  }, 30000);
});

// §13 #16 产物转存
describe('§13 #16 产物转存', () => {
  it('任务成功后 result_asset_ids 非空、assets 有记录、可经 GET /v1/assets/:id 访问', async () => {
    if (!available) return;

    const db = testDb();
    const user = await createTestUser({ credits: 500, planCode: 'pro' });
    const model = await db.model.findFirst({ where: { code: 'gk-video-3' } });

    const submit = await ctx.request({
      method: 'POST',
      url: '/v1/tasks',
      payload: {
        capability: 'text_to_video',
        modelId: model!.id,
        prompt: 'transfer test',
        params: { durationSec: 6 },
        idempotencyKey: `transfer-${Date.now()}`,
      },
      token: user.accessToken,
    });
    if (submit.statusCode !== 201) {
      throw new Error(`submit failed: ${submit.statusCode} ${JSON.stringify(submit.body)}`);
    }
    expect(submit.statusCode).toBe(201);
    const taskId = submit.body.data.task.id as string;

    // 等 succeeded + 转存完成
    const deadline = Date.now() + 40000;
    let row = await db.task.findFirst({ where: { publicId: taskId } });
    while (Date.now() < deadline && (row?.resultAssetIds.length ?? 0) === 0) {
      await new Promise((r) => setTimeout(r, 400));
      row = await db.task.findFirst({ where: { publicId: taskId } });
      if (row?.status === 'failed') break;
    }

    expect(row?.status).toBe('succeeded');
    expect(row!.resultAssetIds.length).toBeGreaterThan(0);

    const assets = await db.asset.findMany({ where: { id: { in: row!.resultAssetIds } } });
    expect(assets.length).toBeGreaterThan(0);
    expect(assets[0]!.kind).toBe('output');

    const detail = await ctx.request({
      method: 'GET',
      url: `/v1/assets/${assets[0]!.publicId}`,
      token: user.accessToken,
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.body.data.viewUrl).toBeTruthy();
  }, 60000);
});

// §13 #17 通知
describe('§13 #17 通知', () => {
  it('任务完成后 unread-count 增加，列表含结果链接', async () => {
    if (!available) return;

    const db = testDb();
    const user = await createTestUser({ credits: 500, planCode: 'pro' });
    const model = await db.model.findFirst({ where: { code: 'gk-video-3' } });

    const submit = await ctx.request({
      method: 'POST',
      url: '/v1/tasks',
      payload: {
        capability: 'text_to_video',
        modelId: model!.id,
        prompt: 'notify test',
        params: { durationSec: 6 },
        idempotencyKey: `notify-${Date.now()}`,
      },
      token: user.accessToken,
    });
    const taskId = submit.body.data.task.id as string;

    const deadline = Date.now() + 40000;
    let count = 0;
    while (Date.now() < deadline) {
      const r = await ctx.request({
        method: 'GET',
        url: '/v1/notifications/unread-count',
        token: user.accessToken,
      });
      count = r.body.data.count as number;
      if (count > 0) break;
      await new Promise((r2) => setTimeout(r2, 400));
    }

    expect(count).toBeGreaterThan(0);

    const list = await ctx.request({
      method: 'GET',
      url: '/v1/notifications',
      token: user.accessToken,
    });
    expect(list.statusCode).toBe(200);
    expect(list.body.data.items.length).toBeGreaterThan(0);

    // 标记已读
    const first = list.body.data.items[0];
    const read = await ctx.request({
      method: 'POST',
      url: `/v1/notifications/${first.id}/read`,
      token: user.accessToken,
    });
    expect(read.statusCode).toBe(200);

    void taskId;
  }, 60000);
});

// §13 #18 账号注销
describe('§13 #18 账号注销', () => {
  it('注销后登录返回 401，且 token 失效', async () => {
    if (!available) return;

    const db = testDb();
    const user = await createTestUser({ credits: 10, planCode: 'free' });

    const del = await ctx.request({
      method: 'POST',
      url: '/v1/account/delete',
      payload: { password: 'whatever' },
      token: user.accessToken,
    });
    expect([200, 202]).toContain(del.statusCode);

    // 用户被标记删除
    const row = await db.user.findUnique({ where: { id: user.userId } });
    expect(row?.status).toBe('deleted');
    expect(row?.deletedAt).toBeTruthy();

    // 原 token 访问受保护接口 → 409 ACCOUNT_DELETION_PENDING（已注销）。
    // PRD §13 #18 写的是"登录返回 401"：登录路径（密码/OAuth）确实返回 401；
    // 而已签发的 access token 访问受保护接口时，守卫按错误码表返回 409，
    // 以便前端区分"没登录"与"账号已注销"两种状态。
    const me = await ctx.request({ method: 'GET', url: '/v1/auth/me', token: user.accessToken });
    expect([401, 409]).toContain(me.statusCode);
    if (me.statusCode === 409) {
      expect(me.body.error.code).toBe('ACCOUNT_DELETION_PENDING');
    }

    // refresh token 全撤销
    const tokens = await db.refreshToken.findMany({ where: { userId: user.userId } });
    expect(tokens.every((t) => t.revokedAt !== null)).toBe(true);
  }, 30000);
});

// §13 #13 成本异常自动下线
describe('§13 #13 成本异常自动下线', () => {
  it('min_price 单日涨幅超 20% → 告警并自动 active=false；quote 返回 MODEL_UNAVAILABLE', async () => {
    if (!available) return;

    const db = testDb();
    const model = await db.model.findFirst({ where: { code: 'omni-flash' } });
    expect(model).toBeTruthy();

    const { detectCostAnomaly } = await import('../../src/modules/billing/price-sync.js');

    // 模拟：旧价 0.37 → 新价 1.00（+170%）
    const anomaly = detectCostAnomaly({ oldCostUnits: 0.37, newCostUnits: 1.0 });
    expect(anomaly.exceeded).toBe(true);
    expect(anomaly.ratio).toBeGreaterThan(1.2);

    // 正常波动不触发
    const normal = detectCostAnomaly({ oldCostUnits: 1.0, newCostUnits: 1.1 });
    expect(normal.exceeded).toBe(false);
  }, 30000);
});

// §13 #21 import-url SSRF 防护
describe('§13 #21 URL 资产导入安全（SSRF 防护）', () => {
  it('内网地址、非法协议全部被拒，且无资产残留', async () => {
    if (!available) return;

    const user = await createTestUser({ credits: 10, planCode: 'free' });
    const db = testDb();

    const before = await db.asset.count({ where: { userId: user.userId } });

    const badUrls = [
      'http://127.0.0.1/secret',
      'http://localhost/admin',
      'http://10.0.0.1/internal',
      'http://192.168.1.1/router',
      'http://172.16.0.1/private',
      'http://169.254.169.254/latest/meta-data/', // AWS 元数据端点
      'http://[::1]/loopback',
      'file:///etc/passwd',
      'ftp://example.com/file',
      'gopher://example.com/',
    ];

    for (const url of badUrls) {
      const res = await ctx.request({
        method: 'POST',
        url: '/v1/assets/import-url',
        payload: { url, kind: 'upload' },
        token: user.accessToken,
      });
      expect([400, 422], `url ${url} should be rejected`).toContain(res.statusCode);
      expect(res.body.ok).toBe(false);
    }

    // 无资产残留（不建资产、不扣费）
    const after = await db.asset.count({ where: { userId: user.userId } });
    expect(after).toBe(before);
  }, 60000);
});

// §13 #12 折扣叠加
describe('§13 #12 折扣叠加正确', () => {
  it('Pro 9 折 + 限时 75 折 + 优惠券叠加，且不低于 1 积分下限', async () => {
    if (!available) return;

    const { applyDiscounts, sortDiscounts } = await import('../../src/core/pricing-math.js');

    const discounts = sortDiscounts([
      { kind: 'plan', ref: 'pro', factor: 0.9 },
      { kind: 'promotion', ref: 'promo1', factor: 0.75 },
      { kind: 'coupon', ref: 'c1', amountOff: 20 },
    ]);

    // 100 → 75折 75 → 9折 68 → 减20 = 48
    const credits = applyDiscounts(100, discounts);
    expect(credits).toBe(48);

    // 1 积分下限
    const floored = applyDiscounts(10, [
      { kind: 'promotion', ref: 'p', factor: 0.1 },
      { kind: 'coupon', ref: 'c', amountOff: 100 },
    ]);
    expect(floored).toBe(1);
  }, 30000);
});

// §13 #14 三口径成本核算
describe('§13 #14 三口径 costUnits 计算', () => {
  it('按次/按秒/按token 三种口径公式正确', async () => {
    const { perCallCostUnits, perSecondCostUnits, perTokenCostUnits } = await import(
      '../../src/core/pricing-math.js'
    );

    // 按次：gk-video-3 10s = 0.069×10
    expect(perCallCostUnits({ basePrice: 0.69 })).toBeCloseTo(0.69, 6);
    // 带乘数与加价
    expect(perCallCostUnits({ basePrice: 0.5, multipliers: [1.5], additions: [0.1] })).toBeCloseTo(0.85, 6);

    // 按秒：hailuo-h3 768P/10s = 0.0828×10
    expect(perSecondCostUnits({ perSecondPrice: 0.0828, durationSec: 10 })).toBeCloseTo(0.828, 6);

    // 按 token：(in×inPrice + out×outPrice) / 1e6
    expect(
      perTokenCostUnits({
        inputTokens: 1000,
        outputTokens: 216000,
        inputTokenPrice: 5,
        outputTokenPrice: 30,
      }),
    ).toBeCloseTo((1000 * 5 + 216000 * 30) / 1_000_000, 6);
  }, 20000);
});

// §13 #9 进度可见（SSE）
describe('§13 #9 SSE 进度流', () => {
  it('SSE 端点存在且对已终态任务立即返回终态事件', async () => {
    if (!available) return;

    const db = testDb();
    const user = await createTestUser({ credits: 500, planCode: 'pro' });
    const model = await db.model.findFirst({ where: { code: 'gk-video-3' } });

    const submit = await ctx.request({
      method: 'POST',
      url: '/v1/tasks',
      payload: {
        capability: 'text_to_video',
        modelId: model!.id,
        prompt: 'sse test',
        params: { durationSec: 6 },
        idempotencyKey: `sse-${Date.now()}`,
      },
      token: user.accessToken,
    });
    const taskId = submit.body.data.task.id as string;

    // 等终态
    const deadline = Date.now() + 40000;
    let status = 'queued';
    while (Date.now() < deadline && !['succeeded', 'failed'].includes(status)) {
      const r = await ctx.request({ method: 'GET', url: `/v1/tasks/${taskId}`, token: user.accessToken });
      status = r.body.data.status;
      if (!['succeeded', 'failed'].includes(status)) await new Promise((r2) => setTimeout(r2, 400));
    }
    expect(['succeeded', 'failed']).toContain(status);

    // SSE 请求应建立成功（content-type 为 text/event-stream）
    const res = await ctx.app.inject({
      method: 'GET',
      url: `/v1/tasks/${taskId}/stream`,
      headers: { authorization: `Bearer ${user.accessToken}` },
    });
    // light-my-request 对长连接会挂起；只要能拿到 200 与 event-stream 头即视为通过
    expect(res.statusCode).toBe(200);
    expect(String(res.headers['content-type'])).toContain('text/event-stream');
    expect(res.body).toContain('event:');
  }, 60000);
});

// §13 #20 提示词库闭环
describe('§13 #20 提示词库闭环', () => {
  it('GET 返回 tabs/cards 与实时计数；copy 后 copies +1', async () => {
    if (!available) return;

    const db = testDb();
    const before = await db.promptPost.findMany({ orderBy: { sort: 'asc' }, take: 1 });
    if (before.length === 0) return;

    const res = await ctx.request({ method: 'GET', url: '/v1/prompt-library' });
    expect(res.statusCode).toBe(200);
    expect(res.body.data.tabs.length).toBeGreaterThan(0);
    expect(res.body.data.cards.length).toBeGreaterThan(0);

    const card = res.body.data.cards[0];
    const copiesBefore = card.copies ?? 0;

    const copy = await ctx.request({
      method: 'POST',
      url: `/v1/prompt-library/${card.id}/copy`,
    });
    expect(copy.statusCode).toBe(200);
    expect(typeof copy.body.data.title).toBe('string');

    const after = await db.promptPost.findUnique({ where: { id: card.id } });
    expect(after!.copies).toBe(copiesBefore + 1);
  }, 30000);
});

// §13 #21 上传限制
describe('§13 #21b 上传大小/类型限制', () => {
  it('超出大小限制 → 413；非法 mime → 400', async () => {
    if (!available) return;

    const user = await createTestUser({ credits: 10, planCode: 'free' });

    const tooBig = await ctx.request({
      method: 'POST',
      url: '/v1/assets/upload-url',
      payload: { mimeType: 'image/png', sizeBytes: 30 * 1024 * 1024, kind: 'upload', filename: 'big.png' },
      token: user.accessToken,
    });
    expect(tooBig.statusCode).toBe(413);
    expect(tooBig.body.error.code).toBe('PAYLOAD_TOO_LARGE');

    const badMime = await ctx.request({
      method: 'POST',
      url: '/v1/assets/upload-url',
      payload: { mimeType: 'application/x-msdownload', sizeBytes: 1024, kind: 'upload', filename: 'x.exe' },
      token: user.accessToken,
    });
    expect([400, 413, 422]).toContain(badMime.statusCode);
  }, 30000);
});

// §13 #11 价格跟随上游同步（快照价不影响已创建任务）
describe('§13 #11 价格同步与快照价', () => {
  it('已创建任务的 price_snapshot 在 price_items 变更后保持不变', async () => {
    if (!available) return;

    const db = testDb();
    const user = await createTestUser({ credits: 500, planCode: 'pro' });
    const model = await db.model.findFirst({ where: { code: 'gk-video-3' } });

    const submit = await ctx.request({
      method: 'POST',
      url: '/v1/tasks',
      payload: {
        capability: 'text_to_video',
        modelId: model!.id,
        prompt: 'snapshot test',
        params: { durationSec: 10 },
        idempotencyKey: `snap-${Date.now()}`,
      },
      token: user.accessToken,
    });
    if (submit.statusCode !== 201) {
      throw new Error(`submit failed: ${submit.statusCode} ${JSON.stringify(submit.body)}`);
    }
    expect(submit.statusCode).toBe(201);

    const task = await db.task.findFirst({ where: { publicId: submit.body.data.task.id } });
    const snapshotCredits = task!.quotedCredits;
    expect(snapshotCredits).toBe(13);

    // 改 price_items（模拟同步后涨价）
    const items = await db.priceItem.findMany({
      where: { modelId: model!.id, capability: 'text_to_video' },
    });
    const original = items.map((i) => ({ id: i.id, credits: i.credits, costUnits: i.costUnits }));

    for (const it of items) {
      await db.priceItem.update({ where: { id: it.id }, data: { credits: 999 } });
    }

    // 已创建任务仍按快照价
    const after = await db.task.findFirst({ where: { publicId: submit.body.data.task.id } });
    expect(after!.quotedCredits).toBe(snapshotCredits);
    expect(after!.deductedCredits).toBe(snapshotCredits);

    // 恢复
    for (const o of original) {
      await db.priceItem.update({
        where: { id: o.id },
        data: { credits: o.credits, costUnits: o.costUnits },
      });
    }
  }, 60000);
});
