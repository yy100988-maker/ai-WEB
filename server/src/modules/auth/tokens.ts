/**
 * 令牌签发 / 校验（详细设计 §2.2 认证）。
 *
 * - access token：JWT HS256，15min（ACCESS_TOKEN_TTL_SEC），无状态，仅承载身份与计划标识。
 * - refresh token：**不用 JWT**，用 `randomToken()` 生成不透明随机串；
 *   DB 只存 sha256 摘要（`refresh_tokens.token_hash`，唯一索引），明文仅返回给客户端一次。
 *   **轮换语义**：refresh 时旧记录置 `revokedAt`，同时签发新记录（旧 token 立即失效）。
 *
 * ⚠️ access token 不落库：鉴权时以 DB 的 `users.status` 为准（注销/封禁立即失效）。
 */

import jwt from 'jsonwebtoken';
import type { Prisma } from '@prisma/client';
import { db } from '../../core/db.js';
import { getConfig } from '../../core/config.js';
import { err } from '../../core/errors.js';
import { sha256, randomToken } from '../../core/crypto.js';
import type { Locale } from '../../core/types.js';

/** JWT 载荷（access token 专用） */
export interface AccessTokenPayload {
  /** users.public_id（usr_xxx），对外暴露 */
  sub: string;
  /** users.id（UUID），内部主键，用于 DB 查询 */
  uid: string;
  plan: string;
  locale: string;
  typ: 'access';
}

/** 签发 access token 所需的最小用户视图 */
export interface TokenUser {
  id: string;
  publicId: string;
  plan?: { code: string } | null;
  planCode?: string | null;
  locale?: string | null;
}

/** 校验通过的 access token 上下文 */
export interface AccessTokenContext {
  userId: string;
  publicId: string;
  planCode: string;
  locale: Locale;
}

/** 校验失败原因（调用方据此决定 401 还是 409 ACCOUNT_DELETION_PENDING） */
export type VerifyFailure = 'malformed' | 'expired' | 'invalid';

export type VerifyAccessTokenResult =
  | { ok: true; value: AccessTokenContext }
  | { ok: false; reason: VerifyFailure };

/** 事务客户端或普通客户端皆可（测试可注入替身） */
export type DbLike = Prisma.TransactionClient | ReturnType<typeof db>;

export interface RefreshTokenRow {
  id: string;
  userId: string;
}

/** 账号状态视图（轮换时核对） */
export interface RefreshUserStatus {
  id: string;
  status: string;
  deletedAt: Date | null;
}

/** refresh token 存取口（默认走 Prisma，单元测试可注入内存实现） */
export interface RefreshTokenStore {
  create(data: { userId: string; tokenHash: string; expiresAt: Date }, tx?: DbLike): Promise<unknown>;
  /** 原子占用：仅当记录存在、未被撤销且未过期时置 revokedAt，返回被占用的记录 */
  revokeIfActive(
    tokenHash: string,
    revokedAt: Date,
    where?: { userId?: string },
  ): Promise<RefreshTokenRow | null>;
  /** 按摘要读记录（轮换时取 userId） */
  findByHash(tokenHash: string): Promise<RefreshTokenRow | null>;
  /** 按 userId 读账号状态 */
  findUserStatus(userId: string): Promise<RefreshUserStatus | null>;
  revoke(tokenHash: string, revokedAt: Date): Promise<void>;
  revokeAllForUser(userId: string, revokedAt: Date): Promise<number>;
}

/** 刷新令牌有效期（秒）→ 绝对过期时间 */
export function refreshTokenExpiresAt(now: Date = new Date()): Date {
  return new Date(now.getTime() + getConfig().REFRESH_TOKEN_TTL_SEC * 1000);
}

/** refresh token 明文 → DB 摘要 */
export function hashRefreshToken(rawToken: string): string {
  return sha256(rawToken);
}

// ---------------------------------------------------------------- access token

/** 签发 access token（JWT HS256，payload 见 AccessTokenPayload） */
export function signAccessToken(user: TokenUser): string {
  const cfg = getConfig();
  const payload: AccessTokenPayload = {
    sub: user.publicId,
    uid: user.id,
    plan: user.planCode ?? user.plan?.code ?? 'free',
    locale: user.locale ?? 'en',
    typ: 'access',
  };
  return jwt.sign(payload, cfg.JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: cfg.ACCESS_TOKEN_TTL_SEC,
  });
}

/**
 * 校验 access token：签名 / 过期 / 载荷形状。
 * 不查库（调用方按需确认用户状态）。
 */
export function verifyAccessToken(token: string): VerifyAccessTokenResult {
  if (!token) return { ok: false, reason: 'malformed' };
  const cfg = getConfig();
  try {
    const decoded = jwt.verify(token, cfg.JWT_SECRET, { algorithms: ['HS256'] });
    if (typeof decoded !== 'object' || decoded === null) return { ok: false, reason: 'invalid' };
    const raw = decoded as Record<string, unknown>;
    if (raw.typ !== 'access') return { ok: false, reason: 'invalid' };
    if (typeof raw.uid !== 'string' || raw.uid.length === 0) return { ok: false, reason: 'invalid' };
    if (typeof raw.sub !== 'string' || raw.sub.length === 0) return { ok: false, reason: 'invalid' };
    return {
      ok: true,
      value: {
        userId: raw.uid,
        publicId: raw.sub,
        planCode: typeof raw.plan === 'string' ? raw.plan : 'free',
        locale: (typeof raw.locale === 'string' ? raw.locale : 'en') as Locale,
      },
    };
  } catch (e) {
    if (e instanceof jwt.TokenExpiredError) return { ok: false, reason: 'expired' };
    return { ok: false, reason: 'invalid' };
  }
}

/** 从 `Authorization` 头提取 Bearer token（大小写不敏感） */
export function extractBearerToken(authorization: string | undefined | null): string | null {
  if (!authorization) return null;
  const m = /^Bearer\s+(.+)$/i.exec(authorization.trim());
  const token = m?.[1]?.trim();
  return token && token.length > 0 ? token : null;
}

// ---------------------------------------------------------------- refresh token

/**
 * 签发 refresh token：返回明文 + 摘要 + 过期时间。
 * DB 写入由调用方（issueRefreshToken / rotateRefreshToken）负责。
 */
export function generateRefreshToken(now: Date = new Date()): {
  rawToken: string;
  tokenHash: string;
  expiresAt: Date;
} {
  const rawToken = randomToken(32);
  return { rawToken, tokenHash: sha256(rawToken), expiresAt: refreshTokenExpiresAt(now) };
}

/** 默认存取实现（Prisma） */
export const prismaRefreshTokenStore: RefreshTokenStore = {
  async create(data, tx) {
    const client: DbLike = tx ?? db();
    return client.refreshToken.create({ data });
  },

  async revokeIfActive(tokenHash, revokedAt, where) {
    const updated = await db().refreshToken.updateMany({
      where: {
        tokenHash,
        revokedAt: null,
        expiresAt: { gt: revokedAt },
        ...(where?.userId ? { userId: where.userId } : {}),
      },
      data: { revokedAt },
    });
    if (updated.count === 0) return null;
    return prismaRefreshTokenStore.findByHash(tokenHash);
  },

  async findByHash(tokenHash) {
    const row = await db().refreshToken.findUnique({
      where: { tokenHash },
      select: { id: true, userId: true },
    });
    return row ?? null;
  },

  async findUserStatus(userId) {
    const user = await db().user.findUnique({
      where: { id: userId },
      select: { id: true, status: true, deletedAt: true },
    });
    return user ?? null;
  },

  async revoke(tokenHash, revokedAt) {
    await db().refreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt },
    });
  },

  async revokeAllForUser(userId, revokedAt) {
    const r = await db().refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt },
    });
    return r.count;
  },
};

let store: RefreshTokenStore = prismaRefreshTokenStore;

/** 注入 refresh token 存取实现（单元测试用） */
export function setRefreshTokenStore(next: RefreshTokenStore): void {
  store = next;
}

export function getRefreshTokenStore(): RefreshTokenStore {
  return store;
}

/** 重置为默认 Prisma 实现（测试收尾） */
export function resetRefreshTokenStore(): void {
  store = prismaRefreshTokenStore;
}

/** 签发 refresh token 并落库；返回明文（仅此一次可见） */
export async function issueRefreshToken(userId: string, tx?: DbLike): Promise<string> {
  const { rawToken, tokenHash, expiresAt } = generateRefreshToken();
  await store.create({ userId, tokenHash, expiresAt }, tx);
  return rawToken;
}

/**
 * 轮换 refresh token：旧记录置 revokedAt，签发新记录。
 * 旧 token 已撤销 / 已过期 / 不存在 / 对应用户不存在或非 active → 401。
 *
 * 实现说明（可注入 store 与 prisma 方法一一对应，便于单元测试替换）：
 *   1. `revokeIfActive` 原子占用旧 token（读到多少条就撤多少条）
 *   2. `findByHash` 读回记录拿 userId
 *   3. `findUserStatus` 核对账号状态
 *   4. `create` 签发新记录
 */
export async function rotateRefreshToken(
  rawToken: string,
): Promise<{ userId: string; rawToken: string }> {
  const tokenHash = sha256(rawToken);
  const now = new Date();

  const claimed = await store.revokeIfActive(tokenHash, now);
  if (!claimed) throw err.unauthorized();

  // 第二轮：若占用前后用户已注销，则本次签发的令牌立即作废（避免注销后仍拿到新令牌）
  const row = await store.findByHash(tokenHash);
  if (!row) throw err.unauthorized();

  const user = await store.findUserStatus(row.userId);
  if (!user) {
    await store.revokeAllForUser(row.userId, now);
    throw err.unauthorized();
  }
  if (user.deletedAt !== null || user.status === 'deleted') {
    await store.revokeAllForUser(row.userId, now);
    throw err.accountDeletionPending();
  }
  if (user.status !== 'active') {
    await store.revokeAllForUser(row.userId, now);
    throw err.unauthorized();
  }

  const next = await issueRefreshToken(user.id);
  return { userId: user.id, rawToken: next };
}

/** 撤销指定 refresh token（幂等：不存在也视为成功） */
export async function revokeRefreshToken(rawToken: string): Promise<void> {
  await store.revoke(sha256(rawToken), new Date());
}

/** 撤销用户全部 refresh token（改密码 / 注销 / 强制下线） */
export async function revokeAllForUser(userId: string): Promise<number> {
  return store.revokeAllForUser(userId, new Date());
}
