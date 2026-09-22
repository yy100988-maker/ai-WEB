/**
 * 认证相关限流（Redis 计数 + 锁定）。
 *
 * 详细设计 §2.2：
 * - 注册：同一标识 1/min、同一 IP 10/min
 * - 失败 5 次锁定 15min（注册验证码错误 / 密码错误）
 *
 * ⚠️ 与 `@fastify/rate-limit` 的全局 IP 限流互补：这里做的是**业务维度**限流，
 * Redis 不可用时按 fail-open 处理（可用性优先），只记 warn 日志。
 */

import { redis, REDIS_KEYS } from '../../core/redis.js';
import { childLogger } from '../../core/logger.js';
import { sha256 } from '../../core/crypto.js';

const log = childLogger({ mod: 'auth-ratelimit' });

/** 计数器与锁定 TTL */
export const IDENTIFIER_WINDOW_SEC = 60; // 同一标识 1/min
export const IP_WINDOW_SEC = 60; // 同一 IP 10/min
export const IP_MAX = 10;
export const FAIL_MAX = 5; // 失败 5 次
export const FAIL_LOCK_SEC = 15 * 60; // 锁定 15min

export interface RateLimitDecision {
  allowed: boolean;
  retryAfter: number;
}

/** 限流存取口（默认 Redis；单元测试可注入） */
export interface RateLimitStore {
  incr(key: string, ttlSec: number): Promise<number>;
  ttl(key: string): Promise<number>;
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSec: number): Promise<void>;
  del(key: string): Promise<void>;
}

const redisStore: RateLimitStore = {
  async incr(key, ttlSec) {
    const n = await redis().incr(key);
    if (n === 1) await redis().expire(key, ttlSec);
    return n;
  },
  async ttl(key) {
    const t = await redis().ttl(key);
    return t > 0 ? t : 0;
  },
  async get(key) {
    return redis().get(key);
  },
  async set(key, value, ttlSec) {
    await redis().set(key, value, 'EX', ttlSec);
  },
  async del(key) {
    await redis().del(key);
  },
};

let store: RateLimitStore = redisStore;

export function setRateLimitStore(next: RateLimitStore): void {
  store = next;
}

export function resetRateLimitStore(): void {
  store = redisStore;
}

/** 标识不进 Redis key 明文（邮箱/手机属个人数据），统一哈希 */
export function identifierKey(identifier: string): string {
  return sha256(identifier).slice(0, 32);
}

/**
 * 滑动窗口近似计数：固定窗口 incr + 窗口 TTL。
 * Redis 故障时 fail-open（返回 allowed）。
 */
async function hit(key: string, max: number, windowSec: number): Promise<RateLimitDecision> {
  try {
    const n = await store.incr(key, windowSec);
    if (n > max) {
      const ttl = await store.ttl(key);
      return { allowed: false, retryAfter: ttl > 0 ? ttl : windowSec };
    }
    return { allowed: true, retryAfter: 0 };
  } catch (e) {
    log.warn({ err: e, key }, 'rate limit store unavailable, fail-open');
    return { allowed: true, retryAfter: 0 };
  }
}

/** 同一标识 1/min（注册发码） */
export function hitIdentifier(identifier: string): Promise<RateLimitDecision> {
  return hit(`auth:reg:id:${identifierKey(identifier)}`, 1, IDENTIFIER_WINDOW_SEC);
}

/** 同一 IP 10/min（注册发码） */
export function hitRegisterIp(ip: string): Promise<RateLimitDecision> {
  return hit(`auth:reg:ip:${ip}`, IP_MAX, IP_WINDOW_SEC);
}

/** 读取某标识的失败锁定剩余秒数（0 = 未锁定） */
export async function loginFailRemaining(identifier: string): Promise<number> {
  const key = REDIS_KEYS.loginFail(identifierKey(identifier));
  try {
    const ttl = await store.ttl(key);
    if (ttl <= 0) return 0;
    const raw = await store.get(key);
    const n = raw ? Number.parseInt(raw, 10) : 0;
    return n >= FAIL_MAX ? ttl : 0;
  } catch (e) {
    log.warn({ err: e }, 'login fail counter unavailable');
    return 0;
  }
}

/**
 * 记录一次登录/验证码失败。
 * @returns 是否已达锁定阈值与剩余秒数
 */
export async function recordFailure(
  identifier: string,
): Promise<{ locked: boolean; retryAfter: number; attemptsLeft: number }> {
  const key = REDIS_KEYS.loginFail(identifierKey(identifier));
  try {
    const n = await store.incr(key, FAIL_LOCK_SEC);
    if (n >= FAIL_MAX) {
      await store.set(key, String(n), FAIL_LOCK_SEC);
      return { locked: true, retryAfter: FAIL_LOCK_SEC, attemptsLeft: 0 };
    }
    return { locked: false, retryAfter: 0, attemptsLeft: FAIL_MAX - n };
  } catch (e) {
    log.warn({ err: e }, 'record failure counter unavailable');
    return { locked: false, retryAfter: 0, attemptsLeft: FAIL_MAX };
  }
}

/** 清除失败计数（登录成功后调用） */
export async function clearFailures(identifier: string): Promise<void> {
  try {
    await store.del(REDIS_KEYS.loginFail(identifierKey(identifier)));
  } catch (e) {
    log.warn({ err: e }, 'clear login fail counter failed');
  }
}
