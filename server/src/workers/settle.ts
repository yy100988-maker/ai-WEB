/**
 * 结算与退款（详细设计 §3.4 / PRD §6.5）。
 *
 * 成功：无余额操作（提交时已扣），只记 settled_credits 与 task_costs。
 * 失败/取消/超时：幂等全额返还。
 *
 * 返还幂等双保险：
 *   ① 状态机保证单次触发（条件更新 WHERE status IN (running,queued)）；
 *   ② credit_ledger 的 (user_id, 'refund:<taskId>') 唯一键兜底，重放不重复返还。
 */

import type { Prisma } from '@prisma/client';
import { transaction } from '../core/db.js';
import { childLogger } from '../core/logger.js';
import { ledger } from '../modules/billing/ledger.js';
import { transition } from '../modules/tasks/state-machine.js';
import { publishTaskEvent, cacheTaskState } from '../modules/tasks/events.js';
import { concurrency } from '../modules/billing/concurrency.js';
import { enqueueNotify } from '../modules/tasks/queue.js';
import type { TaskStatus } from '../core/types.js';

const log = childLogger({ mod: 'settle' });

export interface RefundResult {
  refunded: boolean;
  refundedCredits: number;
  balanceAfter: number;
}

/**
 * 把任务推进到失败类终态并全额返还积分。
 * 幂等：重复调用只返还一次，第二次返回 refundedCredits = 0。
 */
export async function refundTaskTerminal(input: {
  taskId: string;
  taskPublicId: string;
  toStatus: Extract<TaskStatus, 'failed' | 'cancelled' | 'timeout'>;
  error?: { code: string; message: string; retryable?: boolean };
  message?: string;
  keepTimeoutState?: boolean;
}): Promise<RefundResult> {
  const { taskId, taskPublicId, toStatus, error, message } = input;

  const outcome = await transaction(async (tx: Prisma.TransactionClient) => {
    const task = await tx.task.findUnique({
      where: { id: taskId },
      select: { status: true, userId: true, quotedCredits: true, refunded: true },
    });
    if (!task) {
      log.warn({ taskId }, 'refund: task not found');
      return { refunded: false, refundedCredits: 0, balanceAfter: 0, userId: null as string | null, skipped: true };
    }

    // 已是终态且已返还过 → 不重复处理
    // 注意：这里只是快速短路；真正的幂等裁决在 ledger.refundTask 的条件更新 +
    // `refund:<taskId>` 流水唯一键（两者都在同一事务内，任一道都能挡住重放）。
    if (task.refunded) {
      return { refunded: false, refundedCredits: 0, balanceAfter: 0, userId: task.userId, skipped: true };
    }

    const from = task.status as TaskStatus;
    const moved = await transition(tx, {
      taskId,
      from,
      to: toStatus,
      progress: 0,
      message: message ?? `task ${toStatus}`,
      payload: error ? { error } : {},
    });

    // 状态已被别的路径推进（如 cancel 与 timeout 竞争）：交给先到者处理返还
    if (!moved) {
      return { refunded: false, refundedCredits: 0, balanceAfter: 0, userId: task.userId, skipped: true };
    }

    // ⚠️ 这里**故意不**再更新 tasks.refunded / settled_credits。
    //
    // 原因：ledger.refundTask() 内部用条件更新
    //   UPDATE tasks SET settled_credits=0, refunded=true WHERE id=$1 AND refunded=false
    // 作为「我是不是第一个返还者」的唯一裁决点（详细设计 §3.4 双保险第①道）。
    // 若调用方先把 refunded 置成 true，那条 UPDATE 必然命中 0 行，
    // 会让"是否已返还"的判定失去依据 → 有静默漏返还的 P0 风险。
    // 因此把 refunded / settled_credits 的写入**完全交给账本**，语义单一、不可误读。
    const res = await ledger.refundTask({
      userId: task.userId,
      taskId,
      credits: task.quotedCredits,
      tx,
    });

    // 账本负责 refunded/settled_credits；这里只补错误详情（非幂等关键字段）
    if (error) {
      await tx.task.update({
        where: { id: taskId },
        data: { error: error as unknown as object },
      });
    }

    return {
      refunded: res.refunded,
      refundedCredits: res.refunded ? task.quotedCredits : 0,
      balanceAfter: res.balanceAfter,
      userId: task.userId,
      skipped: false,
    };
  });

  if (!outcome.skipped && outcome.userId) {
    await concurrency.release(outcome.userId).catch(() => undefined);

    await publishTaskEvent({
      taskPublicId,
      status: toStatus,
      progress: 0,
      ...(error ? { error: { code: error.code, message: error.message } } : {}),
      refundedCredits: outcome.refundedCredits,
    });
    await cacheTaskState({
      taskPublicId,
      status: toStatus,
      progress: 0,
      ...(error ? { error: { code: error.code, message: error.message } } : {}),
      refundedCredits: outcome.refundedCredits,
    });

    // 异步写通知，失败不阻塞
    if (outcome.userId) {
      const userId = outcome.userId;
      enqueueNotify({
        taskId,
        taskPublicId,
        userId,
        status: 'failed',
      }).catch((e: unknown) => log.warn({ err: e, taskId }, 'enqueue notify failed'));
    }
  }

  return {
    refunded: outcome.refunded,
    refundedCredits: outcome.refundedCredits,
    balanceAfter: outcome.balanceAfter,
  };
}

/**
 * 成功结算（详细设计 §3.4）：提交时已扣，无二次余额操作，只写 settled_credits。
 * 同时写 task_costs（上游实际成本，仅用于毛利分析，与用户账务完全隔离）。
 */
export async function settleSuccess(input: {
  taskId: string;
  taskPublicId: string;
  costUnits?: number;
  channelGroup?: string;
  billingMethod?: 'per_call' | 'per_token' | 'per_second';
  refundedByPlatform?: boolean;
  durationSeconds?: number;
  rawUsage?: Record<string, unknown>;
}): Promise<{ settledCredits: number; userId: string | null }> {
  const { taskId } = input;

  const res = await transaction(async (tx: Prisma.TransactionClient) => {
    const task = await tx.task.findUnique({
      where: { id: taskId },
      select: {
        status: true,
        userId: true,
        quotedCredits: true,
        modelId: true,
        channelId: true,
      },
    });
    if (!task) return { settledCredits: 0, userId: null as string | null };

    const moved = await transition(tx, {
      taskId,
      from: task.status as TaskStatus,
      to: 'succeeded',
      progress: 100,
      message: 'succeeded',
    });
    if (!moved) return { settledCredits: 0, userId: task.userId };

    await tx.task.update({
      where: { id: taskId },
      data: { settledCredits: task.quotedCredits, progress: 100 },
    });

    // task_costs：上游成本账本（算力），绝不与用户积分互相换算（PRD §0 双账本）
    await tx.taskCost.upsert({
      where: { taskId },
      create: {
        taskId,
        channelId: task.channelId,
        modelId: task.modelId,
        billingMethod: input.billingMethod ?? 'per_call',
        costUnits: input.costUnits ?? 0,
        channelGroup: input.channelGroup ?? null,
        platformRefunded: input.refundedByPlatform ?? false,
        refundedAmount: input.refundedByPlatform ? (input.costUnits ?? 0) : 0,
        durationSeconds: input.durationSeconds ?? null,
        rawUsage: (input.rawUsage ?? {}) as object,
      },
      update: {
        costUnits: input.costUnits ?? 0,
        channelGroup: input.channelGroup ?? null,
        platformRefunded: input.refundedByPlatform ?? false,
        refundedAmount: input.refundedByPlatform ? (input.costUnits ?? 0) : 0,
      },
    });

    return { settledCredits: task.quotedCredits, userId: task.userId };
  });

  if (res.settledCredits > 0 && res.userId) {
    await concurrency.release(res.userId).catch(() => undefined);
  }

  return res;
}
