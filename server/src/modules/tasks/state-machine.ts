/**
 * 任务状态机（详细设计 §3.2）。
 *
 *   queued --(worker取到)--> running --(is_final=true,success)--> succeeded
 *                                |--(is_final=true,failed)-------> failed    → refund
 *                                |--(cancel请求)-----------------> cancelled → refund
 *                                └--(30min超时扫描)--------------> timeout   → refund
 *
 * 每次变迁写 task_events + publish 进度（Redis pub/sub → SSE）。
 */

import type { Prisma, TaskStatus } from '@prisma/client';
import { canTransition, isTerminal } from '../../core/types.js';
import type { TaskStatus as TaskStatusType } from '../../core/types.js';
import { childLogger } from '../../core/logger.js';

const log = childLogger({ mod: 'task-state' });

export interface TransitionInput {
  taskId: string;
  from: TaskStatus;
  to: TaskStatusType;
  progress?: number;
  message?: string;
  payload?: Record<string, unknown>;
}

export class InvalidTransitionError extends Error {
  constructor(
    readonly taskId: string,
    readonly from: TaskStatus,
    readonly to: TaskStatusType,
  ) {
    super(`invalid task transition ${from} -> ${to} (task ${taskId})`);
    this.name = 'InvalidTransitionError';
  }
}

/**
 * 在事务内做状态迁移 + 写事件。
 * 使用条件更新（WHERE status = from）保证并发下只有一个写入者成功，
 * 避免 Worker 与超时扫描同时把任务推进终态。
 */
export async function transition(
  tx: Prisma.TransactionClient,
  input: TransitionInput,
): Promise<boolean> {
  const { taskId, from, to, progress, message, payload } = input;

  if (!canTransition(from, to)) {
    throw new InvalidTransitionError(taskId, from, to);
  }

  const data: Prisma.TaskUpdateManyMutationInput = {
    status: to,
    ...(progress !== undefined ? { progress } : {}),
  };
  if (to === 'running') data.startedAt = new Date();
  if (isTerminal(to)) {
    data.finishedAt = new Date();
    if (to === 'succeeded') data.progress = 100;
  }

  const res = await tx.task.updateMany({
    where: { id: taskId, status: from },
    data,
  });

  if (res.count === 0) {
    // 另一个写入者已经推进过这个任务：不是错误，但要记日志（用于排查重复终态处理）
    log.warn({ taskId, from, to }, 'transition skipped: status already changed');
    return false;
  }

  await tx.taskEvent.create({
    data: {
      taskId,
      fromStatus: from,
      toStatus: to,
      progress: progress ?? 0,
      message: message ?? null,
      payload: (payload ?? {}) as Prisma.InputJsonValue,
    },
  });

  return true;
}

/** 纯函数：给定当前状态判断是否可取消（供 API 层快速判断，返回 409 TASK_FINAL） */
export function cancellable(status: TaskStatus): boolean {
  return status === 'queued' || status === 'running';
}

export { isTerminal };
