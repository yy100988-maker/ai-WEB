/**
 * Verified-token：验证码通过后、设密码前的一次性过桥凭证。
 *
 * 为什么需要它：新流程把"验码"和"设密码"拆成两次请求（前端中间要用户输两次密码），
 * 不能把 verificationId 直接当下一阶段的钥匙 —— verification 记录在消费时已被删除，
 * 且其 5 分钟 TTL 是按"输码"设计的。verified-token 自带 purpose + 5min TTL + 一次性，
 * 设密码/找回确认时只认它，不认 verificationId。
 */

import { randomBytes } from 'node:crypto';
import { redis } from '../../core/redis.js';
import { childLogger } from '../../core/logger.js';
import type { Locale } from '../../core/types.js';
import type { VerificationPurpose } from './verification.js';

const log = childLogger({ mod: 'auth-verified-token' });

/** 过桥凭证有效期（秒）：够用户输两次密码，不够攻击者慢慢玩 */
export const VERIFIED_TOKEN_TTL_SEC = 5 * 60;

export interface VerifiedPayload {
  identifier: string;
  locale: Locale;
  purpose: VerificationPurpose;
}

function key(token: string): string {
  return `verified:${token}`;
}

/** 存储口（默认 Redis；单元测试注入内存实现，与 verification.ts 同模式） */
export interface VerifiedTokenStore {
  set(key: string, value: string, ttlSec: number): Promise<void>;
  get(key: string): Promise<string | null>;
  del(key: string): Promise<void>;
}

const redisStore: VerifiedTokenStore = {
  async set(k, v, ttlSec) {
    await redis().set(k, v, 'EX', ttlSec);
  },
  async get(k) {
    return redis().get(k);
  },
  async del(k) {
    await redis().del(k);
  },
};

let store: VerifiedTokenStore = redisStore;

/** 注入存储实现（单元测试用） */
export function setVerifiedTokenStore(next: VerifiedTokenStore): void {
  store = next;
}

export function resetVerifiedTokenStore(): void {
  store = redisStore;
}

/** 签发（32 字节随机，不可猜） */
export async function issueVerifiedToken(payload: VerifiedPayload): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await store.set(key(token), JSON.stringify(payload), VERIFIED_TOKEN_TTL_SEC);
  return token;
}

/**
 * 消费（一次性：读到即删）。
 * - 不存在/过期 → null（前端引导回"重新发码"）
 * - purpose 不符 → null（注册 token 不能拿去重置密码，反之亦然）
 */
export async function consumeVerifiedToken(
  token: string,
  expectedPurpose: VerificationPurpose,
): Promise<VerifiedPayload | null> {
  if (!token || token.length < 16) return null;
  const k = key(token);
  const raw = await store.get(k);
  if (!raw) return null;
  // 先删后验：并发重放同一 token 只有第一次能拿到 payload
  await store.del(k);

  let payload: VerifiedPayload;
  try {
    payload = JSON.parse(raw) as VerifiedPayload;
  } catch {
    log.warn('verified token payload corrupted');
    return null;
  }
  if (!payload || typeof payload.identifier !== 'string' || payload.purpose !== expectedPurpose) {
    return null;
  }
  return payload;
}
