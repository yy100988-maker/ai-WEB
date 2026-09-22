/**
 * 计费相关定时任务逻辑（详细设计 §5）—— 导出**纯函数**供主代理的 cron 调用。
 *
 * 本文件不含调度器、不抢 leader 锁（由调用方用 acquireCronLock 决定单实例执行）。
 * 每个任务都必须**可重复执行**（幂等），因为 cron 可能因多个 API 实例/重试而跑多次。
 */

import { db, transaction } from '../../core/db.js';
import { childLogger } from '../../core/logger.js';
import { startOfUtcDay } from './ledger.js';

const log = childLogger({ mod: 'billing-jobs' });

export interface ResetDailyQuotasResult {
  users: number;
  expiredCredits: number;
}

/**
 * 额度重置（详细设计 §5「额度重置」每日 00:05）。
 *
 * 处理两类过期：
 *  ① signup 7 天过期 + 签到当日过期（都是 `expires_at` 到点的正向批次）；
 *  ② Pro 月度重置（按订阅周期）。
 *
 * ⚠️ 核心正确性：**不删除、不修改任何历史流水**，而是为每个过期批次写一条
 * `type='expire', delta=-剩余` 的负向流水 + `daily_balance_reset` 记录。
 * 这样 `SUM(delta)` 始终等于真实可用余额（append-only 不变式），
 * 且"已花掉的钱"不会被过期规则复活成负余额（详细设计 §2.5 反例）。
 *
 * 幂等：以 `expire:<ledgerId>` 为 idempotencyKey（(user_id, idempotency_key) 唯一），
 * 同一批次无论扫多少次都只冲销一次。
 *
 * 「剩余额」的算法：一个正批次 grant 的可用余额 = delta − 已被冲销额。
 * 若该批次已被完全冲销（存在 expire:<id> 行），跳过；否则冲销 `delta − 已冲销`。
 */
export async function resetDailyQuotas(now: Date = new Date()): Promise<ResetDailyQuotasResult> {
  // 找所有「已到期、正向、且尚未被冲销」的批次
  const expiredBatches = await db().$queryRaw<
    Array<{ id: string; user_id: string; delta: number; expires_at: Date }>
  >`
    SELECT g.id, g.user_id, g.delta, g.expires_at
    FROM credit_ledger g
    WHERE g.delta > 0
      AND g.expires_at IS NOT NULL
      AND g.expires_at <= ${now}
      AND g.type IN ('grant_signup', 'grant_checkin', 'promo', 'purchase', 'admin_adjust', 'task_refund')
      AND NOT EXISTS (
        SELECT 1 FROM credit_ledger e
        WHERE e.user_id = g.user_id
          AND e.delta < 0
          AND e.idempotency_key = 'expire:' || g.id::text
      )
    ORDER BY g.expires_at ASC
    LIMIT 5000
  `;

  let users = 0;
  let expiredCredits = 0;
  const touched = new Set<string>();

  for (const batch of expiredBatches) {
    const ledgerId = batch.id;
    const userId = batch.user_id;
    const amount = Number(batch.delta);

    try {
      await transaction(async (tx) => {
        // 事务内二次确认（并发/重试下唯一键才是最终防线，这里减少无谓写）
        const already = await tx.creditLedger.findUnique({
          where: { userId_idempotencyKey: { userId, idempotencyKey: `expire:${ledgerId}` } },
          select: { id: true },
        });
        if (already) return;

        const rows = await tx.$queryRaw<Array<{ bal: bigint | number | null }>>`
          SELECT COALESCE(SUM(delta), 0)::bigint AS bal FROM credit_ledger WHERE user_id = ${userId}::uuid
        `;
        const raw = rows[0]?.bal ?? 0;
        const bal = typeof raw === 'bigint' ? Number(raw) : Number(raw ?? 0);

        // 冲销额不能超过真实余额（用户可能已把这批额度花光甚至花超）
        const effective = Math.min(amount, Math.max(0, bal));
        if (effective <= 0) return;

        await tx.creditLedger.create({
          data: {
            id: crypto.randomUUID(),
            userId,
            delta: -effective,
            type: 'expire',
            balanceAfter: bal - effective,
            idempotencyKey: `expire:${ledgerId}`,
            expiresAt: null,
            note: `expired batch ${ledgerId} (expired at ${batch.expires_at.toISOString()})`,
          },
        });

        await tx.dailyBalanceReset.upsert({
          where: { userId_date: { userId, date: startOfUtcDay(now) } },
          create: {
            id: crypto.randomUUID(),
            userId,
            date: startOfUtcDay(now),
            resetAmount: effective,
          },
          update: { resetAmount: { increment: effective } },
        });

        touched.add(userId);
        expiredCredits += effective;
      });
    } catch (e) {
      // 单批次失败不阻断整批（幂等键保证下次还能再试）
      log.warn({ err: e, ledgerId, userId }, 'expire batch failed, will retry next run');
    }
  }

  // Pro 月度重置：订阅周期已结束的订阅 → 按周期发放新额度（幂等键含周期起点）
  const monthlyGranted = await grantMonthlyQuotas(now);

  users = touched.size + monthlyGranted.users;
  expiredCredits += monthlyGranted.credits;

  log.info({ users, expiredCredits, batches: expiredBatches.length }, 'resetDailyQuotas done');
  return { users, expiredCredits };
}

/**
 * Pro 月度重置（PRD §6.6）。
 *
 * 订阅处于 active 且 `currentPeriodStart` 对应的额度尚未发放时，
 * 按 `plan.monthlyCredits` 发一笔，幂等键 `sub:<subscriptionId>:<periodStart ISO>`。
 * 有效期到 `currentPeriodEnd`（订阅到期未续费则额度随之过期，符合"月度额度"语义）。
 */
async function grantMonthlyQuotas(now: Date): Promise<{ users: number; credits: number }> {
  const subs = await db().subscription.findMany({
    where: { status: 'active', currentPeriodEnd: { gt: now } },
    include: { plan: true },
    take: 5000,
  });

  let users = 0;
  let credits = 0;

  for (const sub of subs) {
    if (sub.plan.monthlyCredits <= 0) continue;

    const idempotencyKey = `sub:${sub.id}:${sub.currentPeriodStart.toISOString()}`;
    const existing = await db().creditLedger.findUnique({
      where: { userId_idempotencyKey: { userId: sub.userId, idempotencyKey } },
      select: { id: true },
    });
    if (existing) continue;

    try {
      await transaction(async (tx) => {
        const rows = await tx.$queryRaw<Array<{ bal: bigint | number | null }>>`
          SELECT COALESCE(SUM(delta), 0)::bigint AS bal FROM credit_ledger WHERE user_id = ${sub.userId}::uuid
        `;
        const raw = rows[0]?.bal ?? 0;
        const bal = typeof raw === 'bigint' ? Number(raw) : Number(raw ?? 0);

        await tx.creditLedger.create({
          data: {
            id: crypto.randomUUID(),
            userId: sub.userId,
            delta: sub.plan.monthlyCredits,
            type: 'grant_signup', // 订阅额度在 LedgerType 枚举里没有独立值，沿用正向赠送类
            balanceAfter: bal + sub.plan.monthlyCredits,
            idempotencyKey,
            expiresAt: sub.currentPeriodEnd,
            note: `subscription ${sub.plan.code} period ${sub.currentPeriodStart.toISOString()}`,
          },
        });

        await tx.dailyBalanceReset.upsert({
          where: { userId_date: { userId: sub.userId, date: startOfUtcDay(now) } },
          create: {
            id: crypto.randomUUID(),
            userId: sub.userId,
            date: startOfUtcDay(now),
            resetAmount: sub.plan.monthlyCredits,
          },
          update: { resetAmount: { increment: sub.plan.monthlyCredits } },
        });
      });

      users += 1;
      credits += sub.plan.monthlyCredits;
    } catch (e) {
      log.warn({ err: e, subscriptionId: sub.id }, 'monthly quota grant failed');
    }
  }

  return { users, credits };
}

export interface ReconcileResult {
  checked: number;
  mismatches: Array<{ userId: string; expected: number; actual: number }>;
}

/**
 * 账本对账（详细设计 §5「账本对账」每日 03:00，差异 ≠ 0 → P0 告警）。
 *
 * 逐用户重算 `SUM(delta)`（**全量求和，绝不过滤 expires_at**）
 * 对比其**最新一条流水**的 `balance_after` 快照；
 * 差异 ≠ 0 说明 append-only 不变式被破坏（人工改库/事务悬挂/并发写漏锁），必须 P0。
 *
 * 只抽样比对最新快照是不够的；这里对全量用户都算一遍，
 * 并通过 `ROW_NUMBER()` 取每用户最新流水，避免 N+1 查询。
 */
export async function reconcileLedger(now: Date = new Date()): Promise<ReconcileResult> {
  const rows = await db().$queryRaw<
    Array<{ user_id: string; expected: bigint | number; actual: number | null }>
  >`
    WITH totals AS (
      SELECT user_id, SUM(delta)::bigint AS expected
      FROM credit_ledger
      GROUP BY user_id
    ),
    latest AS (
      SELECT user_id, balance_after,
             ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at DESC, id DESC) AS rn
      FROM credit_ledger
    )
    SELECT t.user_id, t.expected, l.balance_after AS actual
    FROM totals t
    LEFT JOIN latest l ON l.user_id = t.user_id AND l.rn = 1
  `;

  const mismatches: Array<{ userId: string; expected: number; actual: number }> = [];

  for (const r of rows) {
    const expected = typeof r.expected === 'bigint' ? Number(r.expected) : Number(r.expected ?? 0);
    const actual = r.actual === null || r.actual === undefined ? 0 : Number(r.actual);
    if (expected !== actual) {
      mismatches.push({ userId: r.user_id, expected, actual });
    }
  }

  if (mismatches.length > 0) {
    // P0：账本不平。这里只记日志，由调用方/告警通道发 Sentry（详细设计 §6.3）
    log.error(
      { count: mismatches.length, sample: mismatches.slice(0, 10), at: now.toISOString() },
      'LEDGER RECONCILE MISMATCH (P0)',
    );
  } else {
    log.info({ checked: rows.length }, 'ledger reconcile ok');
  }

  return { checked: rows.length, mismatches };
}
