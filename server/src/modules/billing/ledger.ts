/**
 * 积分账本（PRD §6.4 / 详细设计 §2.5、§3.4）—— 全系统风险最高的文件。
 *
 * 三条铁律：
 *  ① **余额 = SUM(delta) 全量求和，绝不用 expires_at 过滤**（见下方 deduct 内注释的反例）。
 *  ② 所有入口 **幂等**：(user_id, idempotency_key) 唯一索引兜底，重放直接返回原结果。
 *  ③ 所有余额变动都在 **单事务** 内完成「锁 → 求和 → 写流水」，绝不做「先读后写」的非原子两步。
 *
 * append-only：任何情况下都不 UPDATE/DELETE 既有流水，余额只由流水聚合得出，
 * 因此 `balance_after` 快照必须与同事务内 SUM(delta) 严格一致（对账任务校验这一点）。
 */

import type { Prisma } from '@prisma/client';
import { db, transaction } from '../../core/db.js';
import { err } from '../../core/errors.js';
import { newPublicId } from '../../core/ids.js';
import { childLogger } from '../../core/logger.js';
import type { LedgerType } from '../../core/types.js';

const log = childLogger({ mod: 'ledger' });

/** 默认赠送积分有效期（小时）——expiringSoon 的默认窗口 */
const DEFAULT_EXPIRING_WINDOW_HOURS = 24;

/**
 * 账本入口允许的运行上下文。
 *
 * `tx` 是可选的事务客户端：tasks 模块必须在「扣减 + 建任务」同一个事务里调用 deduct，
 * 否则会出现「扣了钱任务没建」或「任务建了没扣钱」的撕裂状态。
 * 传入 tx 时，本模块**不再自己开事务**，直接复用调用方的事务与 advisory 锁。
 */
export interface LedgerTxContext {
  tx?: Prisma.TransactionClient;
}

export interface DeductInput extends LedgerTxContext {
  userId: string;
  credits: number;
  taskId: string;
  /** 幂等键，建议 `deduct:<taskPublicId>`；与 userId 组成唯一键 */
  idempotencyKey: string;
}

export interface RefundTaskInput extends LedgerTxContext {
  userId: string;
  taskId: string;
  credits: number;
}

export interface GrantInput extends LedgerTxContext {
  userId: string;
  type: LedgerType;
  amount: number;
  idempotencyKey: string;
  expiresAt?: Date | null;
  note?: string;
}

export interface ExpireBatchInput extends LedgerTxContext {
  userId: string;
  /** 被冲销的原始正向批次 id（credit_ledger.id），用于派生幂等键 `expire:<ledgerId>` */
  ledgerId: string;
  amount: number;
  date: Date;
}

/**
 * tasks / worker 依赖的账本接口（CONTRACT.md §4 冻结形状）。
 * 注意：CONTRACT 列表里没有 `tx`，但字段是**可选增量**，不影响既有调用方的类型兼容；
 * tasks 传入 tx 时走调用方事务，不传则本模块自开事务。
 */
export interface LedgerApi {
  balance(userId: string): Promise<number>;
  deduct(input: DeductInput): Promise<{ balanceAfter: number }>;
  refundTask(input: RefundTaskInput): Promise<{ refunded: boolean; balanceAfter: number }>;
  grant(input: GrantInput): Promise<{ balanceAfter: number }>;
  expiringSoon(userId: string, withinHours?: number): Promise<number>;
  expireBatch(input: ExpireBatchInput): Promise<{ balanceAfter: number }>;
}

// ---------------------------------------------------------------- 内部工具

/** 当前余额 = 全量 SUM(delta)（唯一真源） */
async function sumDelta(client: Prisma.TransactionClient | ReturnType<typeof db>, userId: string): Promise<number> {
  const rows = await client.$queryRaw<Array<{ bal: bigint | number | null }>>`
    SELECT COALESCE(SUM(delta), 0)::bigint AS bal
    FROM credit_ledger
    WHERE user_id = ${userId}::uuid
  `;
  const raw = rows[0]?.bal ?? 0;
  return typeof raw === 'bigint' ? Number(raw) : Number(raw ?? 0);
}

/**
 * 串行化同一用户的并发余额变动。
 *
 * 用 `pg_advisory_xact_lock` 而不是 `SELECT ... FOR UPDATE` 锁 ledger 行：
 *  - 余额是聚合值、没有「那一行」可锁（users 表也没有 credits 列）；
 *  - 锁 ledger 会被热点行争抢（同一用户所有流水同一行/同一索引页），advisory 锁不碰任何数据行；
 *  - xact 变体随事务结束自动释放，进程崩溃也不会留死锁。
 * 哈希成 int4 与详细设计 §2.5 的 SQL 完全一致（hashtext 是 PG 内建函数，可能为负，无妨）。
 */
async function lockUser(tx: Prisma.TransactionClient, userId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}))`;
}

/** 在（可选）外部事务内执行；无外部事务则自开一个 */
async function withTx<T>(
  ctx: LedgerTxContext,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  if (ctx.tx) return fn(ctx.tx);
  return transaction(fn);
}

/** Prisma 唯一键冲突（(user_id, idempotency_key) 撞键 = 并发重放） */
function isUniqueViolation(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: string }).code === 'P2002';
}

// ---------------------------------------------------------------- 实现

export const ledger: LedgerApi = {
  /**
   * 当前余额。
   * 全量 SUM(delta)，**不按 expires_at 过滤**——过期语义只由 `expire` 负向流水表达（§5 定时任务）。
   */
  async balance(userId: string): Promise<number> {
    return sumDelta(db(), userId);
  },

  /**
   * 提交扣减（PRD §6.5 / 详细设计 §2.5 落地）。
   *
   * 单事务内四步：
   *   1. pg_advisory_xact_lock(hashtext(userId))  —— 串行化同用户并发提交
   *   2. SELECT COALESCE(SUM(delta),0)            —— 实时余额
   *   3. bal < credits → 402 INSUFFICIENT_CREDITS
   *   4. INSERT 负向流水（balance_after = bal - credits）
   *
   * ⚠️ 为什么余额不能用 expires_at 过滤（详细设计 §2.5 反例，本文件最重要的正确性约束）：
   *   signup 送 +100（7 天后过期），用户当天花掉 30。
   *   若按「expires_at > now()」筛行求和：7 天后 +100 那行被滤掉，而 -30 那行 expires_at 为 NULL
   *   仍被计入 → 余额 = **−30**，用户被凭空扣成负值，且负值无法审计、无法解释。
   *   本研究用 SUM(delta) + 00:05 定时任务写 expire 流水：7 天时扫到该 grant 剩余 70，
   *   写 `expire, delta=-70` → 余额 = (100 − 30 − 70) = **0**，正确、可审计、append-only 不变式成立。
   *
   * 幂等：先查后插（在 advisory lock 内先查更安全），命中原记录直接返回其 balance_after，不重复扣。
   */
  async deduct(input: DeductInput): Promise<{ balanceAfter: number }> {
    if (!Number.isInteger(input.credits) || input.credits < 0) {
      throw err.invalidParams({ credits: input.credits, reason: 'credits must be a non-negative integer' });
    }

    return withTx(input, async (tx) => {
      await lockUser(tx, input.userId);

      // 锁内先查幂等键：并发重放会在这里被第一个到达者挡住，后来者读到同一条记录
      const existing = await tx.creditLedger.findUnique({
        where: {
          userId_idempotencyKey: { userId: input.userId, idempotencyKey: input.idempotencyKey },
        },
        select: { balanceAfter: true, delta: true },
      });
      if (existing) {
        log.info(
          { userId: input.userId, idempotencyKey: input.idempotencyKey },
          'deduct replayed: return original result',
        );
        return { balanceAfter: existing.balanceAfter };
      }

      const bal = await sumDelta(tx, input.userId);
      if (bal < input.credits) {
        throw err.insufficientCredits(input.credits, bal);
      }

      const balanceAfter = bal - input.credits;

      try {
        await tx.creditLedger.create({
          data: {
            id: crypto.randomUUID(),
            userId: input.userId,
            delta: -input.credits,
            type: 'task_deduct',
            taskId: input.taskId,
            balanceAfter,
            idempotencyKey: input.idempotencyKey,
            expiresAt: null, // 扣减不是批次，永不过期
            note: null,
          },
        });
      } catch (e) {
        // 理论上被 advisory 锁挡住不会到这；但自开事务/外部事务混用时仍可能撞键，
        // 兜底查一次既有行返回，保证「幂等」在数据库层面也成立。
        if (isUniqueViolation(e)) {
          const row = await tx.creditLedger.findUnique({
            where: {
              userId_idempotencyKey: { userId: input.userId, idempotencyKey: input.idempotencyKey },
            },
            select: { balanceAfter: true },
          });
          if (row) return { balanceAfter: row.balanceAfter };
        }
        throw e;
      }

      return { balanceAfter };
    });
  },

  /**
   * 失败/取消/超时全额返还（详细设计 §3.4 + PRD §6.5 双保险）。
   *
   * 双保险：
   *   ① 条件更新 `UPDATE tasks SET settled_credits=0, refunded=true WHERE id=$taskId AND refunded=false`
   *      —— affected rows = 0 表示**已经返还过**（或被别的路径抢先），直接返回 refunded:false，不写流水；
   *   ② 幂等键 `refund:<taskId>` + (user_id, idempotency_key) 唯一索引兜底。
   *
   * 返回值语义：`refunded: false` = **本次未发生返还**（不是"没退钱"，钱在之前那次已退），
   * 因此 balanceAfter 返回的是**当前余额**。
   */
  async refundTask(input: RefundTaskInput): Promise<{ refunded: boolean; balanceAfter: number }> {
    return withTx(input, async (tx) => {
      await lockUser(tx, input.userId);

      const idempotencyKey = `refund:${input.taskId}`;

      // 条件更新：只有 refunded=false 的行会被改到，affected rows 就是"我是不是第一个"
      const updated = await tx.task.updateMany({
        where: { id: input.taskId, userId: input.userId, refunded: false },
        data: { settledCredits: 0, refunded: true },
      });

      if (updated.count === 0) {
        // 走到这里有两种可能，必须区分开——混为一谈会**漏退款**（真金白银的 P0）：
        //   (a) 已经退过款：refund:<taskId> 流水已存在 → 返回 refunded:false（本次未发生返还）
        //   (b) 调用方先把 tasks.refunded 置了 true（如 workers/settle.ts 在同一事务里
        //       先 update 再调本函数），但流水还没写 → 必须继续返还，否则用户永远拿不回钱
        const existing = await tx.creditLedger.findUnique({
          where: { userId_idempotencyKey: { userId: input.userId, idempotencyKey } },
          select: { balanceAfter: true },
        });
        if (existing) {
          log.info(
            { userId: input.userId, taskId: input.taskId, balanceAfter: existing.balanceAfter },
            'refund skipped: already refunded (ledger row exists)',
          );
          return { refunded: false, balanceAfter: existing.balanceAfter };
        }

        // 流水不存在：确认任务确实属于该用户后继续走返还（幂等键仍是最终防线）
        const task = await tx.task.findFirst({
          where: { id: input.taskId, userId: input.userId },
          select: { refunded: true },
        });
        if (!task) {
          const bal = await sumDelta(tx, input.userId);
          log.warn(
            { userId: input.userId, taskId: input.taskId },
            'refund skipped: task not found or not owned by user',
          );
          return { refunded: false, balanceAfter: bal };
        }

        log.info(
          { userId: input.userId, taskId: input.taskId },
          'refund proceeding: task flagged refunded but no refund ledger row yet',
        );
        // 落到下面共用同一段写流水逻辑
      }

      // 命中已存在的流水（并发/重试的最终兜底；唯一索引会再挡一次）
      const existing = await tx.creditLedger.findUnique({
        where: { userId_idempotencyKey: { userId: input.userId, idempotencyKey } },
        select: { balanceAfter: true },
      });
      if (existing) {
        return { refunded: false, balanceAfter: existing.balanceAfter };
      }

      const bal = await sumDelta(tx, input.userId);
      const balanceAfter = bal + input.credits;

      await tx.creditLedger.create({
        data: {
          id: crypto.randomUUID(),
          userId: input.userId,
          delta: input.credits,
          type: 'task_refund',
          taskId: input.taskId,
          balanceAfter,
          idempotencyKey,
          expiresAt: null,
          note: null,
        },
      });

      return { refunded: true, balanceAfter };
    });
  },

  /**
   * 发放积分（注册赠送 / 签到 / 购买 / 活动 / admin 调整）。
   *
   * 幂等：(user_id, idempotencyKey) 唯一，同一 key 只发一次。
   * `expiresAt` 只写在**正向批次**上，负向流水（扣减/过期/返还）一律 NULL——
   * 这是"批次可追踪"的前提：expire 冲销时按批次剩余额计算。
   */
  async grant(input: GrantInput): Promise<{ balanceAfter: number }> {
    if (!Number.isInteger(input.amount) || input.amount < 0) {
      throw err.invalidParams({ amount: input.amount, reason: 'amount must be a non-negative integer' });
    }

    return withTx(input, async (tx) => {
      await lockUser(tx, input.userId);

      const existing = await tx.creditLedger.findUnique({
        where: {
          userId_idempotencyKey: { userId: input.userId, idempotencyKey: input.idempotencyKey },
        },
        select: { balanceAfter: true },
      });
      if (existing) {
        log.info(
          { userId: input.userId, idempotencyKey: input.idempotencyKey },
          'grant replayed: return original result',
        );
        return { balanceAfter: existing.balanceAfter };
      }

      const bal = await sumDelta(tx, input.userId);
      const balanceAfter = bal + input.amount;

      try {
        await tx.creditLedger.create({
          data: {
            id: crypto.randomUUID(),
            userId: input.userId,
            delta: input.amount,
            type: input.type,
            taskId: null,
            orderId: null,
            balanceAfter,
            idempotencyKey: input.idempotencyKey,
            expiresAt: input.expiresAt ?? null,
            note: input.note ?? null,
          },
        });
      } catch (e) {
        if (isUniqueViolation(e)) {
          const row = await tx.creditLedger.findUnique({
            where: {
              userId_idempotencyKey: { userId: input.userId, idempotencyKey: input.idempotencyKey },
            },
            select: { balanceAfter: true },
          });
          if (row) return { balanceAfter: row.balanceAfter };
        }
        throw e;
      }

      return { balanceAfter };
    });
  },

  /**
   * 未来 N 小时内将过期的额度合计（**仅用于展示提醒，绝不参与余额计算**）。
   *
   * 只统计正向批次（delta > 0）且 expires_at 在 (now, now+withinHours] 的行。
   * 这不违反"不用 expires_at 过滤余额"的约束——它算的不是余额，是提醒数字。
   */
  async expiringSoon(userId: string, withinHours = DEFAULT_EXPIRING_WINDOW_HOURS): Promise<number> {
    const hours = Number.isFinite(withinHours) && withinHours > 0 ? withinHours : DEFAULT_EXPIRING_WINDOW_HOURS;

    const rows = await db().$queryRaw<Array<{ total: bigint | number | null }>>`
      SELECT COALESCE(SUM(delta), 0)::bigint AS total
      FROM credit_ledger
      WHERE user_id = ${userId}::uuid
        AND delta > 0
        AND expires_at IS NOT NULL
        AND expires_at > now()
        AND expires_at <= now() + make_interval(hours => ${hours}::int)
    `;
    const raw = rows[0]?.total ?? 0;
    return typeof raw === 'bigint' ? Number(raw) : Number(raw ?? 0);
  },

  /**
   * 冲销一个已过期的正向批次（00:05 定时任务调用，详细设计 §5）。
   *
   * 写 `type='expire', delta=-amount` 的负向流水把过期额度拉平，
   * 同时 upsert `daily_balance_reset` 记录本次重置（供运营/对账查看）。
   *
   * 幂等键固定派生为 `expire:<ledgerId>`：同一批次无论被扫多少次都只冲销一次。
   * 这样"余额 ⊆ 未过期额度"的语义由流水表达，而不是靠查询时过滤——
   * 因此已消费的扣减永远不会被过期规则复活成负余额。
   */
  async expireBatch(input: ExpireBatchInput): Promise<{ balanceAfter: number }> {
    const amount = Math.max(0, Math.trunc(input.amount));

    return withTx(input, async (tx) => {
      await lockUser(tx, input.userId);

      const idempotencyKey = `expire:${input.ledgerId}`;

      const existing = await tx.creditLedger.findUnique({
        where: { userId_idempotencyKey: { userId: input.userId, idempotencyKey } },
        select: { balanceAfter: true },
      });
      if (existing) {
        log.info(
          { userId: input.userId, ledgerId: input.ledgerId },
          'expireBatch replayed: batch already expired',
        );
        return { balanceAfter: existing.balanceAfter };
      }

      const bal = await sumDelta(tx, input.userId);
      // 冲销不能把余额拉成负数：理论上 amount 已经是"批次剩余"，但防御性封顶
      const effective = Math.min(amount, Math.max(0, bal));
      const balanceAfter = bal - effective;

      await tx.creditLedger.create({
        data: {
          id: crypto.randomUUID(),
          userId: input.userId,
          delta: -effective,
          type: 'expire',
          taskId: null,
          orderId: null,
          balanceAfter,
          idempotencyKey,
          expiresAt: null,
          note: `expire batch ${input.ledgerId}`,
        },
      });

      // 记录每日重置（user_id + date 唯一，重复执行取累加）
      await tx.dailyBalanceReset.upsert({
        where: { userId_date: { userId: input.userId, date: startOfUtcDay(input.date) } },
        create: {
          id: crypto.randomUUID(),
          userId: input.userId,
          date: startOfUtcDay(input.date),
          resetAmount: effective,
        },
        update: { resetAmount: { increment: effective } },
      });

      return { balanceAfter };
    });
  },
};

/** 取 UTC 当日 00:00（daily_balance_reset.date 是 @db.Date） */
export function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** 注册赠送幂等键（PRD §6.4.1） */
export function signupGrantKey(userId: string): string {
  return `signup:${userId}`;
}

/** 签到幂等键：同一用户同一天只发一次（与 daily_checkins 唯一键双保险） */
export function checkinGrantKey(userId: string, date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `checkin:${userId}:${y}-${m}-${d}`;
}

/** 任务扣减幂等键（由 taskId 派生，与 tasks 的 Idempotency-Key 分离） */
export function deductKey(taskPublicId: string): string {
  return `deduct:${taskPublicId}`;
}

/** admin 调整幂等键（每次操作一个新 uuid） */
export function adminAdjustKey(): string {
  return `admin:${newPublicId('order')}`;
}
