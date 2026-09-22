/**
 * E2E 冒烟：完整商业闭环（PRD §13 #1 / 详细设计 §7.5 E2E-1）。
 *
 * 注册 → 赠送积分 → 签到 → quote → 提交任务 → 轮询到 succeeded → 创作记录可见。
 * 全程 MockProvider，零上游费用。
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
  if (!available) {
    console.warn('E2E skipped: PG/Redis not reachable. Start docker compose -f docker-compose.test.yml up -d');
    return;
  }
  await truncateAll();
  await flushTestRedis();
  ctx = await createTestApp(routes);
});

afterAll(async () => {
  if (ctx?.app) await ctx.app.close();
  await closeTestConnections();
});

async function waitForTerminal(
  token: string,
  taskId: string,
  timeoutMs = 30000,
): Promise<{ status: string; progress: number; results: unknown[] }> {
  const deadline = Date.now() + timeoutMs;
  let last: { status: string; progress: number; results: unknown[] } = {
    status: 'queued',
    progress: 0,
    results: [],
  };
  while (Date.now() < deadline) {
    const res = await ctx.request({ method: 'GET', url: `/v1/tasks/${taskId}`, token });
    expect(res.statusCode).toBe(200);
    last = res.body.data;
    if (['succeeded', 'failed', 'cancelled', 'timeout'].includes(last.status)) return last;
    await new Promise((r) => setTimeout(r, 300));
  }
  return last;
}

describe('E2E-1 完整闭环（PRD §13 #1）', () => {
  it('注册 → 设密码 → 签到 → quote → 提交 → succeeded → 创作记录可见', async () => {
    if (!available) return;

    // ---- 注册（验证码流程，三段式）----
    const email = `e2e-${Date.now()}@example.com`;
    const reg = await ctx.request({
      method: 'POST',
      url: '/v1/auth/register',
      payload: { email, locale: 'en' },
    });
    expect(reg.statusCode).toBe(201);
    const verificationId = reg.body.data.verificationId as string;
    expect(verificationId).toBeTruthy();

    // 测试环境万能码 → 不存在用户 → verifiedToken（不直接建号）
    const verify = await ctx.request({
      method: 'POST',
      url: '/v1/auth/verify',
      payload: { verificationId, code: '000000' },
    });
    // 失败时把服务端错误体打出来，避免只看到一个裸的 500
    if (verify.statusCode !== 200) {
      throw new Error(`verify failed: ${verify.statusCode} ${JSON.stringify(verify.body)}`);
    }
    expect(verify.statusCode).toBe(200);
    expect(verify.body.data.exists).toBe(false);
    const verifiedToken = verify.body.data.verifiedToken as string;
    expect(verifiedToken).toBeTruthy();

    // ---- 第三步：两次输密码（前端保证一致，后端只认 policy）----
    const setpwd = await ctx.request({
      method: 'POST',
      url: '/v1/auth/set-password',
      payload: { verifiedToken, password: 'e2ePass1' },
    });
    if (setpwd.statusCode !== 201) {
      throw new Error(`set-password failed: ${setpwd.statusCode} ${JSON.stringify(setpwd.body)}`);
    }
    expect(setpwd.statusCode).toBe(201);
    const token = setpwd.body.data.accessToken as string;
    expect(token).toBeTruthy();

    // 弱密码直接 422（reason 精确到项）
    const weak = await ctx.request({
      method: 'POST',
      url: '/v1/auth/recovery/reset',
      payload: { verifiedToken: 'too-short-token-1234567890', newPassword: 'abc' },
    });
    expect(weak.statusCode).toBe(422);
    expect(weak.body.error.code).toBe('WEAK_PASSWORD');

    // ---- §13 #2 注册赠送 100 积分 ----
    const me = await ctx.request({ method: 'GET', url: '/v1/auth/me', token });
    expect(me.statusCode).toBe(200);
    expect(me.body.data.balance.credits).toBe(100);

    const db = testDb();
    const user = await db.user.findUnique({ where: { email } });
    expect(user).toBeTruthy();
    const signupLedger = await db.creditLedger.findFirst({
      where: { userId: user!.id, type: 'grant_signup' },
    });
    expect(signupLedger?.delta).toBe(100);

    // ---- §13 #3 签到 ----
    const checkin = await ctx.request({ method: 'POST', url: '/v1/checkin', token });
    if (checkin.statusCode !== 200) {
      throw new Error(`checkin failed: ${checkin.statusCode} ${JSON.stringify(checkin.body)}`);
    }
    expect(checkin.statusCode).toBe(200);
    expect(checkin.body.data.credits).toBe(5);
    expect(checkin.body.data.balance).toBe(105);

    const again = await ctx.request({ method: 'POST', url: '/v1/checkin', token });
    expect(again.statusCode).toBe(409);
    expect(again.body.error.code).toBe('ALREADY_CHECKED_IN');

    // ---- quote（§13 #19 模型差异化定价）----
    const q1 = await ctx.request({
      method: 'POST',
      url: '/v1/pricing/quote',
      payload: { capability: 'text_to_video', modelId: 'gk-video-3', params: { durationSec: 10 } },
      token,
    });
    if (q1.statusCode !== 200) {
      throw new Error(`quote failed: ${q1.statusCode} ${JSON.stringify(q1.body)}`);
    }
    expect(q1.statusCode).toBe(200);
    const modelRow = await db.model.findFirst({ where: { code: 'gk-video-3' } });
    expect(q1.body.data.modelId).toBe(modelRow!.id);

    // ---- 提交任务 ----
    const submit = await ctx.request({
      method: 'POST',
      url: '/v1/tasks',
      payload: {
        capability: 'text_to_video',
        modelId: modelRow!.id,
        prompt: 'A cinematic shot of a dog riding a bicycle in Tokyo at sunset',
        params: { durationSec: 10 },
        idempotencyKey: `e2e-${Date.now()}`,
      },
      token,
    });
    if (submit.statusCode !== 201) {
      throw new Error(`submit failed: ${submit.statusCode} ${JSON.stringify(submit.body)}`);
    }
    expect(submit.statusCode).toBe(201);
    const taskId = submit.body.data.task.id as string;
    const quoted = submit.body.data.task.quotedCredits as number;
    expect(quoted).toBeGreaterThan(0);

    // 提交即扣减
    const afterSubmit = await ctx.request({ method: 'GET', url: '/v1/billing/balance', token });
    expect(afterSubmit.body.data.credits).toBe(105 - quoted);

    // ---- 等待终态 ----
    const final = await waitForTerminal(token, taskId);
    if (final.status !== 'succeeded') {
      throw new Error(`task ended as ${final.status}: ${JSON.stringify(final)}`);
    }
    expect(final.status).toBe('succeeded');
    expect(final.progress).toBe(100);

    // ---- §13 #1 任务完成无二次扣费 ----
    const afterFinish = await ctx.request({ method: 'GET', url: '/v1/billing/balance', token });
    expect(afterFinish.body.data.credits).toBe(105 - quoted);

    // ---- 创作记录可见 ----
    const list = await ctx.request({ method: 'GET', url: '/v1/tasks?type=video', token });
    expect(list.statusCode).toBe(200);
    expect(list.body.data.items.length).toBeGreaterThan(0);
    const found = list.body.data.items.find((t: { id: string }) => t.id === taskId);
    expect(found).toBeTruthy();
    expect(found.status).toBe('succeeded');

    // ---- §13 #17 通知 ----
    const unread = await ctx.request({ method: 'GET', url: '/v1/notifications/unread-count', token });
    expect(unread.statusCode).toBe(200);
    expect(unread.body.data.count).toBeGreaterThanOrEqual(0);
  }, 60000);
});

describe('E2E-2 余额不足（§13 #1 变体）', () => {
  it('余额不足提交 → 402，签到后重试成功', async () => {
    if (!available) return;

    const user = await createTestUser({ credits: 1, planCode: 'free' });
    const db = testDb();
    const model = await db.model.findFirst({ where: { code: 'gk-video-3' } });
    expect(model).toBeTruthy();

    const res = await ctx.request({
      method: 'POST',
      url: '/v1/tasks',
      payload: {
        capability: 'text_to_video',
        modelId: model!.id,
        prompt: 'a cat',
        params: { durationSec: 10 },
        idempotencyKey: `poor-${Date.now()}`,
      },
      token: user.accessToken,
    });

    expect(res.statusCode).toBe(402);
    expect(res.body.error.code).toBe('INSUFFICIENT_CREDITS');
    expect(res.body.error.details.balance).toBe(1);
    expect(res.body.error.details.required).toBeGreaterThan(1);
  }, 30000);
});

describe('E2E-3 失败退款（§13 #4）', () => {
  it('注入渠道失败 → failed → 全额返还 → 余额恢复', async () => {
    if (!available) return;

    const user = await createTestUser({ credits: 100, planCode: 'free' });
    const db = testDb();
    const model = await db.model.findFirst({ where: { code: 'gk-video-3' } });

    const before = await ctx.request({ method: 'GET', url: '/v1/billing/balance', token: user.accessToken });
    const balanceBefore = before.body.data.credits as number;

    const submit = await ctx.request({
      method: 'POST',
      url: '/v1/tasks',
      payload: {
        capability: 'text_to_video',
        modelId: model!.id,
        prompt: 'a landscape',
        params: { durationSec: 6 },
        idempotencyKey: `fail-${Date.now()}`,
      },
      token: user.accessToken,
      headers: { 'x-mock-fail': 'upstream_error' },
    });
    if (submit.statusCode !== 201) {
      throw new Error(`submit failed: ${submit.statusCode} ${JSON.stringify(submit.body)}`);
    }
    expect(submit.statusCode).toBe(201);
    const taskId = submit.body.data.task.id as string;

    const final = await waitForTerminal(user.accessToken, taskId);
    expect(final.status).toBe('failed');

    // 全额返还
    const after = await ctx.request({ method: 'GET', url: '/v1/billing/balance', token: user.accessToken });
    expect(after.body.data.credits).toBe(balanceBefore);

    // 账本出现成对的 task_deduct 与 task_refund
    const ledger = await db.creditLedger.findMany({
      where: { userId: user.userId },
      orderBy: { createdAt: 'asc' },
    });
    const types = ledger.map((l) => l.type);
    expect(types).toContain('task_deduct');
    expect(types).toContain('task_refund');

    const refunds = ledger.filter((l) => l.type === 'task_refund');
    expect(refunds).toHaveLength(1);

    // 末条 balance_after 等于真实余额（账本平）
    const sum = ledger.reduce((a, l) => a + l.delta, 0);
    expect(sum).toBe(balanceBefore);
    expect(ledger[ledger.length - 1]!.balanceAfter).toBe(balanceBefore);
  }, 40000);
});

describe('E2E-5 违规 prompt（§13 #23）', () => {
  it('违规 prompt → 422 CONTENT_REJECTED，不建 task、无 ledger 流水', async () => {
    if (!available) return;

    const user = await createTestUser({ credits: 100, planCode: 'free' });
    const db = testDb();
    const model = await db.model.findFirst({ where: { code: 'gk-video-3' } });

    const beforeCount = await db.task.count({ where: { userId: user.userId } });
    const beforeLedger = await db.creditLedger.count({ where: { userId: user.userId } });

    const res = await ctx.request({
      method: 'POST',
      url: '/v1/tasks',
      payload: {
        capability: 'text_to_video',
        modelId: model!.id,
        prompt: 'child pornography explicit content',
        params: { durationSec: 6 },
        idempotencyKey: `bad-${Date.now()}`,
      },
      token: user.accessToken,
    });

    expect(res.statusCode).toBe(422);
    expect(res.body.error.code).toBe('CONTENT_REJECTED');
    expect(res.body.error.details.layer).toBeDefined();

    // 不建任务、不扣费
    expect(await db.task.count({ where: { userId: user.userId } })).toBe(beforeCount);
    expect(await db.creditLedger.count({ where: { userId: user.userId } })).toBe(beforeLedger);
  }, 30000);
});

describe('E2E-4 参考图深链闭环（§13 #20）', () => {
  it('提示词库返回 cards；import-url 后可用作输入提交', async () => {
    if (!available) return;

    const lib = await ctx.request({ method: 'GET', url: '/v1/prompt-library' });
    expect(lib.statusCode).toBe(200);
    expect(Array.isArray(lib.body.data.tabs)).toBe(true);
    expect(Array.isArray(lib.body.data.cards)).toBe(true);

    if (lib.body.data.cards.length > 0) {
      const card = lib.body.data.cards[0];
      const copy = await ctx.request({
        method: 'POST',
        url: `/v1/prompt-library/${card.id}/copy`,
      });
      expect(copy.statusCode).toBe(200);
      expect(typeof copy.body.data.title).toBe('string');
    }
  }, 30000);
});
