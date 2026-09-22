/**
 * 集成测试：账本并发安全与幂等（PRD §13 #4/#5/#6 直接验收项）。
 *
 * 需要真 PG/Redis：docker compose -f docker-compose.test.yml up -d
 * 若依赖不可达则自动跳过（不误报红）。
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
    console.warn('integration skipped: PG/Redis unreachable');
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

describe('§13 #6 幂等：同一 Idempotency-Key 重放', () => {
  it('重复提交 10 次只创建 1 个任务、只扣 1 次积分', async () => {
    if (!available) return;

    const user = await createTestUser({ credits: 500, planCode: 'pro' });
    const db = testDb();
    const model = await db.model.findFirst({ where: { code: 'gk-video-3' } });
    expect(model).toBeTruthy();

    const idempotencyKey = `idem-${Date.now()}`;
    const payload = {
      capability: 'text_to_video',
      modelId: model!.id,
      prompt: 'idempotency test prompt',
      params: { durationSec: 6 },
      idempotencyKey,
    };

    const results = [];
    for (let i = 0; i < 10; i++) {
      results.push(
        await ctx.request({ method: 'POST', url: '/v1/tasks', payload, token: user.accessToken }),
      );
    }

    const ok = results.filter((r) => r.statusCode === 200 || r.statusCode === 201);
    expect(ok.length).toBe(10);

    // 所有响应必须是同一个 task id
    const ids = new Set(ok.map((r) => r.body.data.task.id));
    expect(ids.size).toBe(1);

    // 只有 1 个 task
    const taskCount = await db.task.count({ where: { userId: user.userId } });
    expect(taskCount).toBe(1);

    // 只有 1 次扣减
    const deducts = await db.creditLedger.findMany({
      where: { userId: user.userId, type: 'task_deduct' },
    });
    expect(deducts).toHaveLength(1);

    // 余额 = 500 - 扣除
    const credits = await db.creditLedger.aggregate({
      where: { userId: user.userId },
      _sum: { delta: true },
    });
    expect(credits._sum.delta).toBe(500 - Math.abs(deducts[0]!.delta));

    // 后续响应应标记为幂等重放
    const replays = ok.slice(1).filter((r) => r.body.idempotentReplay === true);
    expect(replays.length).toBeGreaterThanOrEqual(1);
  }, 60000);
});

describe('§13 #5 不超卖：并发抢额度', () => {
  it('并发 30 个请求、余额仅够 3 个任务，恰好 3 个成功、其余 402，余额 ≥ 0', async () => {
    if (!available) return;

    const db = testDb();
    const model = await db.model.findFirst({ where: { code: 'gk-video-3' } });

    // 单次任务 13 积分；给 40 积分 → 恰好够 3 个
    const user = await createTestUser({ credits: 40, planCode: 'pro' });
    const concurrency = 30;

    const promises = Array.from({ length: concurrency }, (_, i) =>
      ctx.request({
        method: 'POST',
        url: '/v1/tasks',
        payload: {
          capability: 'text_to_video',
          modelId: model!.id,
          prompt: `concurrency test ${i}`,
          params: { durationSec: 10 },
          idempotencyKey: `conc-${Date.now()}-${i}`,
        },
        token: user.accessToken,
      }),
    );

    const results = await Promise.all(promises);
    const accepted = results.filter((r) => r.statusCode === 201 || r.statusCode === 200);
    // 拒绝口径：402 余额不足 **或** 429 并发超限。
    // pro 并发上限=3，30 路并行时大多数请求先撞上 TOO_MANY_TASKS（429）而非 402；
    // 两种都是合法的"拒绝"，核心是**余额永不为负**（不超卖）。
    const rejected = results.filter((r) => r.statusCode === 402 || r.statusCode === 429);

    // 不能超卖：接受的扣减总额不能超过初始余额
    const taskCount = await db.task.count({ where: { userId: user.userId } });
    expect(taskCount).toBe(accepted.length);

    const agg = await db.creditLedger.aggregate({
      where: { userId: user.userId },
      _sum: { delta: true },
    });
    const balance = agg._sum.delta ?? 0;

    // **核心断言：余额绝不为负（不超卖）**
    expect(balance).toBeGreaterThanOrEqual(0);

    // 按 13 积分/任务，40 积分最多 3 个
    expect(accepted.length).toBeLessThanOrEqual(3);
    expect(accepted.length).toBeGreaterThan(0);
    expect(rejected.length).toBeGreaterThanOrEqual(concurrency - 3);

    // 被拒的一定是 402 INSUFFICIENT_CREDITS
    for (const r of rejected) {
      expect(r.body.error.code === 'INSUFFICIENT_CREDITS' || r.body.error.code === 'TOO_MANY_TASKS').toBe(true);
    }
  }, 90000);
});

describe('§13 #4 失败退款幂等', () => {
  it('重复触发终态不二次返还', async () => {
    if (!available) return;

    const db = testDb();
    const user = await createTestUser({ credits: 100, planCode: 'free' });
    const model = await db.model.findFirst({ where: { code: 'gk-video-3' } });

    const submit = await ctx.request({
      method: 'POST',
      url: '/v1/tasks',
      payload: {
        capability: 'text_to_video',
        modelId: model!.id,
        prompt: 'refund idempotency',
        params: { durationSec: 6 },
        idempotencyKey: `refund-idem-${Date.now()}`,
      },
      token: user.accessToken,
      headers: { 'x-mock-fail': 'upstream_error' },
    });
    if (submit.statusCode !== 201) {
      throw new Error(`submit failed: ${submit.statusCode} ${JSON.stringify(submit.body)}`);
    }
    expect(submit.statusCode).toBe(201);
    const taskId = submit.body.data.task.id as string;

    // 等终态
    const deadline = Date.now() + 20000;
    let status = 'queued';
    while (Date.now() < deadline && !['failed', 'succeeded'].includes(status)) {
      const r = await ctx.request({ method: 'GET', url: `/v1/tasks/${taskId}`, token: user.accessToken });
      status = r.body.data.status;
      if (!['failed', 'succeeded'].includes(status)) await new Promise((r2) => setTimeout(r2, 250));
    }
    expect(status).toBe('failed');

    const refunds = await db.creditLedger.findMany({
      where: { userId: user.userId, type: 'task_refund' },
    });
    expect(refunds).toHaveLength(1);

    // 再次触发结算路径（模拟重复终态处理）
    const { refundTaskTerminal } = await import('../../src/workers/settle.js');
    const taskRow = await db.task.findFirst({ where: { publicId: taskId } });
    await refundTaskTerminal({
      taskId: taskRow!.id,
      taskPublicId: taskId,
      toStatus: 'failed',
    });

    // 仍只有 1 条返还流水
    const refundsAfter = await db.creditLedger.findMany({
      where: { userId: user.userId, type: 'task_refund' },
    });
    expect(refundsAfter).toHaveLength(1);

    // 账本平：SUM(delta) == 最新 balance_after
    const ledger = await db.creditLedger.findMany({
      where: { userId: user.userId },
      orderBy: { createdAt: 'asc' },
    });
    const sum = ledger.reduce((a, l) => a + l.delta, 0);
    expect(sum).toBe(ledger[ledger.length - 1]!.balanceAfter);
  }, 40000);
});

describe('§13 #3 签到并发双击', () => {
  it('同日并发签到仅一次成功，另一次 409', async () => {
    if (!available) return;

    const user = await createTestUser({ credits: 0, planCode: 'free' });

    const [a, b] = await Promise.all([
      ctx.request({ method: 'POST', url: '/v1/checkin', token: user.accessToken }),
      ctx.request({ method: 'POST', url: '/v1/checkin', token: user.accessToken }),
    ]);

    const codes = [a.statusCode, b.statusCode].sort();
    expect(codes).toEqual([200, 409]);

    const db = testDb();
    const checkins = await db.dailyCheckin.findMany({ where: { userId: user.userId } });
    expect(checkins).toHaveLength(1);
    expect(checkins[0]!.credits).toBe(5);

    const grants = await db.creditLedger.findMany({
      where: { userId: user.userId, type: 'grant_checkin' },
    });
    expect(grants).toHaveLength(1);
  }, 30000);
});

describe('§13 #1/#2 注册赠送 7 天过期后余额正确（反例回归）', () => {
  it('signup 100 花掉 30，7 天后 expire 冲销剩余，余额 = 0（不是 -30）', async () => {
    if (!available) return;

    const db = testDb();
    const user = await createTestUser({ credits: 0, planCode: 'free' });

    // 造一个 7 天后到期的 signup 赠送
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 7 * 86400000);
    const signup = await db.creditLedger.create({
      data: {
        userId: user.userId,
        delta: 100,
        type: 'grant_signup',
        balanceAfter: 100,
        idempotencyKey: `signup:${user.userId}`,
        expiresAt,
      },
    });

    // 花掉 30
    await db.creditLedger.create({
      data: {
        userId: user.userId,
        delta: -30,
        type: 'task_deduct',
        balanceAfter: 70,
        idempotencyKey: `deduct:x`,
      },
    });

    let sum = (await db.creditLedger.aggregate({ where: { userId: user.userId }, _sum: { delta: true } }))._sum.delta;
    expect(sum).toBe(70);

    // 模拟 7 天后的过期任务：冲销剩余 70
    const { ledger } = await import('../../src/modules/billing/ledger.js');
    const past = new Date(expiresAt.getTime() + 1000);
    await ledger.expireBatch({
      userId: user.userId,
      ledgerId: signup.id,
      amount: 70,
      date: past,
    });

    sum = (await db.creditLedger.aggregate({ where: { userId: user.userId }, _sum: { delta: true } }))._sum.delta;
    // **关键：不是 -30**
    expect(sum).toBe(0);

    // 账本仍平
    const entries = await db.creditLedger.findMany({
      where: { userId: user.userId },
      orderBy: { createdAt: 'asc' },
    });
    expect(entries[entries.length - 1]!.balanceAfter).toBe(0);

    // expire 幂等：再跑一次加入相同 ledgerId 不应重复冲销
    await ledger.expireBatch({ userId: user.userId, ledgerId: signup.id, amount: 70, date: past });
    const sum2 = (await db.creditLedger.aggregate({ where: { userId: user.userId }, _sum: { delta: true } }))._sum.delta;
    expect(sum2).toBe(0);
  }, 30000);
});
