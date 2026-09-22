/**
 * BullMQ 队列拓扑（详细设计 §3.1）。
 *
 * | 队列       | 生产者        | 消费者      | 并发              | 重试 |
 * | generation | API 提交      | worker      | 按渠道限流        | 仅 retryable ≤3 次，指数退避 30s→120s→480s |
 * | poll       | worker(delay) | worker      | 50                | 平台 15s 超时即重调度 |
 * | transfer   | worker(终态)  | worker      | 10                | 下载 3 次，失败只告警 |
 * | notify     | worker(终态)  | worker      | 20                | 写通知表失败重试 5 次 |
 *
 * 全部 Redis AOF 持久化；stalled 任务 BullMQ 自动重入队。
 */

import { Queue, Worker, type JobsOptions } from 'bullmq';
import type { Redis } from 'ioredis';
import { createRedis } from '../../core/redis.js';
import { getConfig } from '../../core/config.js';

export const QUEUE_NAMES = {
  generation: 'generation',
  poll: 'poll',
  transfer: 'transfer',
  notify: 'notify',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

/**
 * BullMQ 自定义 jobId **不允许包含 `:`**（会抛 "Custom Id cannot contain :"，
 * 因为 Redis key 以 `:` 分隔命名空间）。统一走这里拼接，避免各处手写漏掉。
 */
function makeJobId(...parts: string[]): string {
  return parts.map((p) => p.replace(/:/g, '-')).join('-');
}

export interface GenerationJobData {
  taskId: string;
  taskPublicId: string;
  userId: string;
}

export interface PollJobData {
  taskId: string;
  taskPublicId: string;
  externalJobId: string;
  attempt: number;
}

export interface TransferJobData {
  taskId: string;
  taskPublicId: string;
  userId: string;
  outputs: Array<{ mimeType: string; remoteUrl?: string; base64?: string; meta?: Record<string, unknown> }>;
}

export interface NotifyJobData {
  taskId: string;
  taskPublicId: string;
  userId: string;
  status: 'succeeded' | 'failed';
}

export type JobDataMap = {
  generation: GenerationJobData;
  poll: PollJobData;
  transfer: TransferJobData;
  notify: NotifyJobData;
};

// 队列连接必须独立于共享连接（BullMQ 需要 maxRetriesPerRequest=null 且会阻塞）
const connections: Redis[] = [];
const queues = new Map<QueueName, Queue>();

function queueConnection(): Redis {
  const c = createRedis();
  connections.push(c);
  return c;
}

export function getQueue<K extends QueueName>(name: K): Queue<JobDataMap[K]> {
  let q = queues.get(name);
  if (!q) {
    q = new Queue(name, { connection: queueConnection() });
    queues.set(name, q);
  }
  return q as Queue<JobDataMap[K]>;
}

/** 入队 generation（API 提交时调用），含幂等键 */
export async function enqueueGeneration(data: GenerationJobData, idempotencyKey: string): Promise<void> {
  const opts: JobsOptions = {
    jobId: makeJobId('gen', data.taskId),
    removeOnComplete: 1000,
    removeOnFail: 5000,
    attempts: 1, // 生成提交的重试由业务层控制（需重签交付 URL）
  };
  await getQueue(QUEUE_NAMES.generation).add('generate', data, { ...opts, jobId: makeJobId('gen', idempotencyKey) });
}

/** 轮询用 delayed job（首期纯轮询，不传 notify_url） */
export async function enqueuePoll(data: PollJobData, delayMs: number): Promise<void> {
  await getQueue(QUEUE_NAMES.poll).add('poll', data, {
    jobId: makeJobId('poll', data.taskId, String(data.attempt)),
    delay: delayMs,
    removeOnComplete: 5000,
    removeOnFail: 5000,
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
  });
}

export async function enqueueTransfer(data: TransferJobData): Promise<void> {
  const cfg = getConfig();
  await getQueue(QUEUE_NAMES.transfer).add('transfer', data, {
    jobId: makeJobId('transfer', data.taskId),
    removeOnComplete: 1000,
    removeOnFail: 1000,
    attempts: cfg.TASK_MAX_RETRY,
    backoff: { type: 'exponential', delay: 3000 },
  });
}

export async function enqueueNotify(data: NotifyJobData): Promise<void> {
  await getQueue(QUEUE_NAMES.notify).add('notify', data, {
    jobId: makeJobId('notify', data.taskId, data.status),
    removeOnComplete: 1000,
    removeOnFail: 1000,
    attempts: 5,
    backoff: { type: 'exponential', delay: 2000 },
  });
}

export function workerConnection(): Redis {
  return createRedis();
}

export type { Worker };

/** 测试/关闭用 */
export async function closeQueues(): Promise<void> {
  for (const q of queues.values()) {
    await q.close().catch(() => undefined);
  }
  queues.clear();
  for (const c of connections) {
    c.disconnect();
  }
  connections.length = 0;
}
