/**
 * 任务进度广播（Redis pub/sub → SSE）。
 *
 * API 进程与 Worker 进程分离，用 Redis channel `task:{publicId}` 解耦：
 * Worker publish → API 的 SSE handler subscribe → 推给浏览器。
 */

import { redis, REDIS_KEYS } from '../../core/redis.js';
import type { TaskStatus } from '../../core/types.js';
import { childLogger } from '../../core/logger.js';

const log = childLogger({ mod: 'task-events' });

export interface TaskResultItem {
  assetId: string;
  url: string;
  mimeType: string;
  width?: number;
  height?: number;
  durationSec?: number;
}

export interface TaskEventPayload {
  taskPublicId: string;
  status: TaskStatus;
  progress: number;
  results?: TaskResultItem[];
  error?: { code: string; message: string };
  settledCredits?: number;
  refundedCredits?: number;
}

/** 广播任务事件。失败只记日志 —— 进度推送绝不能阻塞任务主流程。 */
export async function publishTaskEvent(evt: TaskEventPayload): Promise<void> {
  try {
    await redis().publish(REDIS_KEYS.taskChannel(evt.taskPublicId), JSON.stringify(evt));
  } catch (e) {
    log.warn({ err: e, taskId: evt.taskPublicId }, 'publish task event failed');
  }
}

/**
 * 任务进度缓存（SSE 断线重连恢复当前态用，详细设计 §3.5）。
 * TTL 1h：足够前端重连，过期后前端回落 GET /v1/tasks/:id。
 */
export async function cacheTaskState(evt: TaskEventPayload): Promise<void> {
  try {
    await redis().set(
      `task:state:${evt.taskPublicId}`,
      JSON.stringify(evt),
      'EX',
      3600,
    );
  } catch (e) {
    log.warn({ err: e, taskId: evt.taskPublicId }, 'cache task state failed');
  }
}

export async function readCachedTaskState(taskPublicId: string): Promise<TaskEventPayload | null> {
  try {
    const raw = await redis().get(`task:state:${taskPublicId}`);
    return raw ? (JSON.parse(raw) as TaskEventPayload) : null;
  } catch {
    return null;
  }
}
