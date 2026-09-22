/**
 * 注册验证码（详细设计 §2.2）。
 *
 * - 6 位数字码，Redis 存 `REDIS_KEYS.verification(id)`，TTL 300s；
 * - 非生产环境：日志打印验证码 + 接受万能码 `000000`（CI/联调用）；
 *   生产环境：经邮件/短信通道真实发送（mailer.ts），通道缺失则调用方直接报错；
 * - 错误累加 attempts，满 5 次锁定 15min（独立 lock key）；
 * - 校验成功即删除（一次性）。
 * - 每条记录带 `purpose`（register | recovery）：注册码与找回码**不可串用**，
 *   否则找回码能拿去注册、注册码能拿去改别人密码。
 *
 * Redis 交互集中在本文件的 `verifyStore`，单元测试可整体注入内存实现。
 */

import { randomInt } from 'node:crypto';
import { redis, REDIS_KEYS } from '../../core/redis.js';
import { childLogger, maskEmail, maskPhone } from '../../core/logger.js';
import type { Locale } from '../../core/types.js';

const log = childLogger({ mod: 'auth-verification' });

/** 验证码有效期（秒） */
export const CODE_TTL_SEC = 300;
/** 最大尝试次数 */
export const MAX_ATTEMPTS = 5;
/** 超出尝试次数后的锁定时长（秒） */
export const LOCK_TTL_SEC = 15 * 60;
/** 非生产环境万能码 */
export const DEV_CODES = ['000000'];
/** 6 位数字码下界（含） */
export const CODE_MIN = 100000;
/** 6 位数字码上界（含） */
export const CODE_MAX = 999999;

/** 验证码用途：注册与找回各走各的码，防串用 */
export type VerificationPurpose = 'register' | 'recovery';

/** Redis 中存储的验证码记录 */
export interface VerificationRecord {
  identifier: string;
  code: string;
  attempts: number;
  /** 归属 locale，用于后续本地化短信/邮件模板 */
  locale?: string;
  /** 用途（缺省视为 register，兼容旧记录） */
  purpose?: VerificationPurpose;
}

/** 验证码记录存储口（默认 Redis；单元测试注入内存实现） */
export interface VerificationStore {
  get(id: string): Promise<VerificationRecord | null>;
  /** 覆盖写入并刷新 TTL */
  set(id: string, record: VerificationRecord, ttlSec: number): Promise<void>;
  del(id: string): Promise<void>;
  /** 剩余锁定秒数；0 表示未锁定 */
  lockTtl(id: string): Promise<number>;
  /** 加锁并返回锁定时长（秒） */
  lock(id: string, ttlSec: number): Promise<void>;
  /** 读取锁定标记（存在即返回其 TTL 秒数，不存在返回 0） */
  isLocked(id: string): Promise<number>;
}

// ---------------------------------------------------------------- Redis 实现

const redisStore: VerificationStore = {
  async get(id) {
    const raw = await redis().get(REDIS_KEYS.verification(id));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const rec = parsed as Partial<VerificationRecord>;
    if (typeof rec.identifier !== 'string' || typeof rec.code !== 'string') return null;
    return {
      identifier: rec.identifier,
      code: rec.code,
      attempts: typeof rec.attempts === 'number' ? rec.attempts : 0,
      ...(typeof rec.locale === 'string' ? { locale: rec.locale } : {}),
      ...(rec.purpose === 'recovery' || rec.purpose === 'register' ? { purpose: rec.purpose } : {}),
    };
  },
  async set(id, record, ttlSec) {
    await redis().set(REDIS_KEYS.verification(id), JSON.stringify(record), 'EX', ttlSec);
  },
  async del(id) {
    await redis().del(REDIS_KEYS.verification(id));
  },
  async lock(id, ttlSec) {
    await redis().set(lockKey(id), '1', 'EX', ttlSec);
  },
  async isLocked(id) {
    return lockTtlOf(id);
  },
  async lockTtl(id) {
    return lockTtlOf(id);
  },
};

async function lockTtlOf(id: string): Promise<number> {
  const ttl = await redis().ttl(lockKey(id));
  return ttl > 0 ? ttl : 0;
}

/** 锁定键：与验证码记录分离，删码不影响锁定 */
function lockKey(id: string): string {
  return `verify:lock:${id}`;
}

let store: VerificationStore = redisStore;

/** 注入存储实现（单元测试用） */
export function setVerificationStore(next: VerificationStore): void {
  store = next;
}

export function getVerificationStore(): VerificationStore {
  return store;
}

export function resetVerificationStore(): void {
  store = redisStore;
}

// ---------------------------------------------------------------- 业务接口

/** 是否开发/测试环境（决定是否允许万能码与日志打印验证码） */
export function isDevEnv(): boolean {
  return process.env.NODE_ENV !== 'production';
}

/** 生成 6 位数字验证码（crypto.randomInt 均匀分布） */
export function generateCode(): string {
  return String(randomInt(CODE_MIN, CODE_MAX));
}

/** 是否为万能码（仅非生产环境生效） */
export function isDevCode(code: string): boolean {
  return isDevEnv() && DEV_CODES.includes(code);
}

/**
 * 创建验证码。
 * @returns verificationId 与有效期（秒）。注意：**不负责发送**，
 * 发送由调用方按 identifier 类型走 mailer（邮箱）或短信通道；
 * 本函数只落 Redis 记录 + 打审计日志。
 */
export async function createVerification(
  identifier: string,
  locale: Locale = 'en',
  purpose: VerificationPurpose = 'register',
): Promise<{ verificationId: string; expiresInSec: number; code: string }> {
  const code = generateCode();
  const verificationId = `vrf_${randomInt(0, 0xffffffff).toString(36)}${Date.now().toString(36)}`;

  await store.set(
    verificationId,
    { identifier, code, attempts: 0, locale, purpose },
    CODE_TTL_SEC,
  );

  const masked = identifier.includes('@') ? maskEmail(identifier) : maskPhone(identifier);
  if (isDevEnv()) {
    // 非生产：验证码打印到日志，方便本地/CI 联调
    log.info({ verificationId, identifier: masked, code, purpose }, 'verification code (dev only)');
  } else {
    // 生产：只记审计（掩码），不明文
    log.info({ verificationId, identifier: masked, purpose }, 'verification code issued');
  }

  return { verificationId, expiresInSec: CODE_TTL_SEC, code };
}

/** 读取验证码记录（不消费） */
export async function readVerification(verificationId: string): Promise<VerificationRecord | null> {
  return store.get(verificationId);
}

/** 消费验证码的结果 */
export type ConsumeResult =
  | { ok: true; record: VerificationRecord }
  | { ok: false; reason: 'not_found' | 'locked' | 'mismatch' | 'wrong_purpose'; attemptsLeft?: number; retryAfterSec?: number };

/**
 * 校验并消费验证码。
 * - 验证码不存在/已过期 → not_found
 * - 处于锁定期 → locked（返回剩余秒数）
 * - 用途不符（拿注册码走找回或反之）→ wrong_purpose（**不累加 attempts**，
 *   这是调用方传错 purpose，不是用户输错码，不应消耗尝试次数）
 * - 校验失败 → 累加 attempts；达到 5 次锁定 15min
 * - 成功 → 删除记录（一次性）
 */
export async function consumeVerification(
  verificationId: string,
  code: string,
  expectedPurpose?: VerificationPurpose,
): Promise<ConsumeResult> {
  const lockRemain = await store.isLocked(verificationId);
  if (lockRemain > 0) {
    return { ok: false, reason: 'locked', retryAfterSec: lockRemain };
  }

  const record = await store.get(verificationId);
  if (!record) return { ok: false, reason: 'not_found' };

  // 用途隔离：旧记录无 purpose 字段时视为 register（兼容）
  const actual: VerificationPurpose = record.purpose ?? 'register';
  if (expectedPurpose && actual !== expectedPurpose) {
    return { ok: false, reason: 'wrong_purpose' };
  }

  const matched = record.code === code || isDevCode(code);
  if (!matched) {
    const attempts = record.attempts + 1;
    if (attempts >= MAX_ATTEMPTS) {
      await store.del(verificationId);
      await store.lock(verificationId, LOCK_TTL_SEC);
      return { ok: false, reason: 'locked', attemptsLeft: 0, retryAfterSec: LOCK_TTL_SEC };
    }
    await store.set(verificationId, { ...record, attempts }, CODE_TTL_SEC);
    return { ok: false, reason: 'mismatch', attemptsLeft: MAX_ATTEMPTS - attempts };
  }

  await store.del(verificationId);
  return { ok: true, record };
}
