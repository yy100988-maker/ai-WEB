/**
 * Redis 客户端（BullMQ 队列 / 限流 / 幂等缓存 / 进度 pub-sub / 熔断计数）。
 * 需要独立连接时用 createRedis()（BullMQ 要求 maxRetriesPerRequest=null）。
 */

import Redis from 'ioredis';
import type { Redis as RedisClient } from 'ioredis';
import { getConfig } from './config.js';

let shared: RedisClient | null = null;

function baseOptions(url: string) {
  return {
    lazyConnect: false,
    maxRetriesPerRequest: null as number | null,
    enableReadyCheck: true,
    retryStrategy: (times: number) => Math.min(times * 200, 5000),
    ...(url.startsWith('rediss://') ? { tls: {} } : {}),
  };
}

/** 共享连接：缓存、限流、pub/sub 之外的一般用途 */
export function redis(): RedisClient {
  if (!shared) {
    shared = new Redis(getConfig().REDIS_URL, baseOptions(getConfig().REDIS_URL));
  }
  return shared;
}

/** 独立连接：BullMQ Queue/Worker、阻塞式订阅必须各用一条 */
export function createRedis(): RedisClient {
  const url = getConfig().REDIS_URL;
  return new Redis(url, baseOptions(url));
}

export async function disconnectRedis(): Promise<void> {
  if (shared) {
    await shared.quit().catch(() => shared?.disconnect());
    shared = null;
  }
}

// ---------------------------------------------------------------- 键命名

export const REDIS_KEYS = {
  /** 任务进度 pub/sub 频道（SSE 订阅） */
  taskChannel: (taskPublicId: string) => `task:${taskPublicId}`,
  /** 用户并发任务计数 */
  userConcurrency: (userId: string) => `conc:user:${userId}`,
  /** 熔断器状态 */
  breaker: (modelCode: string) => `breaker:${modelCode}`,
  /** 审核结论缓存（prompt sha256） */
  moderation: (hash: string) => `mod:${hash}`,
  /** 限流（由 @fastify/rate-limit 使用） */
  rateLimit: (key: string) => `rl:${key}`,
  /** 匿名提示词库事件限频 */
  promptAnon: (ip: string, event: string) => `pl:anon:${event}:${ip}`,
  /** 平台余额缓存 */
  platformBalance: 'platform:balance',
  /** 定时任务 leader 锁 */
  cronLock: (job: string) => `cron:lock:${job}`,
  /** 登录失败计数 */
  loginFail: (identifier: string) => `loginfail:${identifier}`,
  /** 验证码 */
  verification: (id: string) => `verify:${id}`,
} as const;

/**
 * 定时任务 leader 锁（详细设计 §5：单实例执行）。
 * 返回 true 表示抢到锁，可以执行。
 */
export async function acquireCronLock(job: string, ttlSec = 300): Promise<boolean> {
  const key = REDIS_KEYS.cronLock(job);
  const res = await redis().set(key, String(Date.now()), 'EX', ttlSec, 'NX');
  return res === 'OK';
}
