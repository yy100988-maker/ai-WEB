/**
 * 令牌单元测试（不连真实 DB/Redis）。
 *
 * 覆盖：access token 签发/校验/过期/篡改/载荷形状；refresh token 摘要与轮换语义
 * （DB 交互走注入的 `RefreshTokenStore` 内存实现）。
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import {
  signAccessToken,
  verifyAccessToken,
  extractBearerToken,
  generateRefreshToken,
  hashRefreshToken,
  issueRefreshToken,
  rotateRefreshToken,
  revokeRefreshToken,
  revokeAllForUser,
  setRefreshTokenStore,
  resetRefreshTokenStore,
  type RefreshTokenRow,
  type RefreshTokenStore,
} from './tokens.js';
import { AppError } from '../../core/errors.js';
import { sha256 } from '../../core/crypto.js';

const JWT_SECRET = 'unit-test-secret-at-least-32-bytes-long';

beforeAll(() => {
  process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';
  process.env.REDIS_URL ??= 'redis://localhost:6379';
  process.env.JWT_SECRET = JWT_SECRET;
  process.env.ADMIN_TOKEN ??= 'unit-test-admin-token';
  process.env.NODE_ENV = 'test';
});

// db() 是惰性单例，refresh 轮换会查用户状态：这里 mock 掉，避免真实连接
const userState = { id: '11111111-1111-1111-1111-111111111111', status: 'active', deletedAt: null as Date | null };

vi.mock('../../core/db.js', () => ({
  db: () => ({
    user: {
      findUnique: async () => ({ id: userState.id, status: userState.status, deletedAt: userState.deletedAt }),
    },
    refreshToken: { findUnique: async () => null },
  }),
  transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({}),
}));

const user = {
  id: '11111111-1111-1111-1111-111111111111',
  publicId: 'usr_abcdefghijkl',
  plan: { code: 'pro' },
  locale: 'zh-CN',
};

describe('access token', () => {
  it('签发的 payload 符合契约（sub/uid/plan/locale/typ）', () => {
    const token = signAccessToken(user);
    const decoded = jwt.decode(token) as Record<string, unknown> | null;
    expect(decoded).not.toBeNull();
    expect(decoded!.sub).toBe('usr_abcdefghijkl');
    expect(decoded!.uid).toBe(user.id);
    expect(decoded!.plan).toBe('pro');
    expect(decoded!.locale).toBe('zh-CN');
    expect(decoded!.typ).toBe('access');
    // HS256 + 15min
    const header = JSON.parse(Buffer.from(token.split('.')[0]!, 'base64url').toString('utf8')) as {
      alg: string;
    };
    expect(header.alg).toBe('HS256');
    const ttl = (decoded!.exp as number) - (decoded!.iat as number);
    expect(ttl).toBe(900);
  });

  it('校验通过并返回上下文', () => {
    const result = verifyAccessToken(signAccessToken(user));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({
      userId: user.id,
      publicId: 'usr_abcdefghijkl',
      planCode: 'pro',
      locale: 'zh-CN',
    });
  });

  it('篡改 payload 后签名校验失败', () => {
    const token = signAccessToken(user);
    const [h, p, s] = token.split('.');
    const payload = JSON.parse(Buffer.from(p!, 'base64url').toString('utf8')) as Record<string, unknown>;
    payload.uid = '99999999-9999-9999-9999-999999999999';
    const forged = `${h}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.${s}`;
    const result = verifyAccessToken(forged);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('invalid');
  });

  it('用错误密钥签发 → 校验失败', () => {
    const foreign = jwt.sign(
      { sub: user.publicId, uid: user.id, plan: 'pro', locale: 'zh-CN', typ: 'access' },
      'another-secret-at-least-32-bytes-long!!',
      { algorithm: 'HS256', expiresIn: 900 },
    );
    const result = verifyAccessToken(foreign);
    expect(result.ok).toBe(false);
  });

  it('typ 不是 access 的令牌被拒绝（refresh/其他 JWT 不可当 access 用）', () => {
    const wrongTyp = jwt.sign(
      { sub: user.publicId, uid: user.id, plan: 'pro', locale: 'zh-CN', typ: 'reset' },
      JWT_SECRET,
      { algorithm: 'HS256', expiresIn: 900 },
    );
    expect(verifyAccessToken(wrongTyp).ok).toBe(false);
  });

  it('过期令牌返回 expired', () => {
    const expired = jwt.sign(
      { sub: user.publicId, uid: user.id, plan: 'pro', locale: 'zh-CN', typ: 'access' },
      JWT_SECRET,
      { algorithm: 'HS256', expiresIn: -10 },
    );
    const result = verifyAccessToken(expired);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('expired');
  });

  it('空串/乱串返回 malformed|invalid', () => {
    expect(verifyAccessToken('')).toEqual({ ok: false, reason: 'malformed' });
    expect(verifyAccessToken('not-a-jwt').ok).toBe(false);
  });

  it('计划缺失时回落 free', () => {
    const token = signAccessToken({ id: user.id, publicId: user.publicId });
    const result = verifyAccessToken(token);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.planCode).toBe('free');
  });
});

describe('extractBearerToken', () => {
  it('大小写不敏感地解析 Bearer', () => {
    expect(extractBearerToken('Bearer abc.def.ghi')).toBe('abc.def.ghi');
    expect(extractBearerToken('bearer   abc')).toBe('abc');
  });
  it('非 Bearer / 空值返回 null', () => {
    expect(extractBearerToken(undefined)).toBeNull();
    expect(extractBearerToken('Basic abc')).toBeNull();
    expect(extractBearerToken('Bearer ')).toBeNull();
  });
});

describe('refresh token（不透明随机串 + 摘要）', () => {
  it('生成的是高熵随机串，DB 只存 sha256 摘要', () => {
    const { rawToken, tokenHash, expiresAt } = generateRefreshToken(new Date('2025-01-01T00:00:00Z'));
    expect(rawToken.length).toBeGreaterThanOrEqual(40);
    expect(tokenHash).toBe(sha256(rawToken));
    expect(tokenHash).toHaveLength(64);
    expect(tokenHash).not.toContain(rawToken);
    // 30 天
    expect(expiresAt.toISOString()).toBe('2025-01-31T00:00:00.000Z');
  });

  it('两次生成互不相同', () => {
    expect(generateRefreshToken().rawToken).not.toBe(generateRefreshToken().rawToken);
  });

  it('hashRefreshToken 与 sha256 一致', () => {
    expect(hashRefreshToken('raw-token-value')).toBe(sha256('raw-token-value'));
  });
});

// ---------------------------------------------------------------- 注入式 store

interface StoredRow {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
}

function memoryStore(): RefreshTokenStore & { rows: StoredRow[] } {
  const rows: StoredRow[] = [];
  let seq = 0;
  return {
    rows,
    async create(data) {
      seq += 1;
      rows.push({
        id: `row-${seq}`,
        userId: data.userId,
        tokenHash: data.tokenHash,
        expiresAt: data.expiresAt,
        revokedAt: null,
      });
      return rows[rows.length - 1];
    },
    async revokeIfActive(tokenHash, revokedAt, where): Promise<RefreshTokenRow | null> {
      const row = rows.find(
        (r) =>
          r.tokenHash === tokenHash &&
          r.revokedAt === null &&
          r.expiresAt.getTime() > revokedAt.getTime() &&
          (!where?.userId || r.userId === where.userId),
      );
      if (!row) return null;
      row.revokedAt = revokedAt;
      return { id: row.id, userId: row.userId };
    },
    async findByHash(tokenHash) {
      const row = rows.find((r) => r.tokenHash === tokenHash);
      return row ? { id: row.id, userId: row.userId } : null;
    },
    async findUserStatus(userId) {
      if (userId !== userState.id) return null;
      return { id: userState.id, status: userState.status, deletedAt: userState.deletedAt };
    },
    async revoke(tokenHash, revokedAt) {
      for (const r of rows) {
        if (r.tokenHash === tokenHash && r.revokedAt === null) r.revokedAt = revokedAt;
      }
    },
    async revokeAllForUser(userId, revokedAt) {
      let n = 0;
      for (const r of rows) {
        if (r.userId === userId && r.revokedAt === null) {
          r.revokedAt = revokedAt;
          n += 1;
        }
      }
      return n;
    },
  };
}

describe('refresh token 轮换语义', () => {
  let store: ReturnType<typeof memoryStore>;

  beforeEach(() => {
    store = memoryStore();
    setRefreshTokenStore(store);
    userState.status = 'active';
    userState.deletedAt = null;
  });

  afterEach(() => {
    resetRefreshTokenStore();
  });

  it('签发后 DB 里只有摘要，没有明文', async () => {
    const raw = await issueRefreshToken(user.id);
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0]!.tokenHash).toBe(sha256(raw));
    expect(JSON.stringify(store.rows)).not.toContain(raw);
  });

  it('轮换：旧记录置 revokedAt，返回新 token，且新 token 与旧的不同', async () => {
    const oldToken = await issueRefreshToken(user.id);
    const rotated = await rotateRefreshToken(oldToken);

    expect(rotated.userId).toBe(user.id);
    expect(rotated.rawToken).not.toBe(oldToken);
    expect(store.rows).toHaveLength(2);
    expect(store.rows[0]!.revokedAt).not.toBeNull(); // 旧 token 已撤销
    expect(store.rows[1]!.revokedAt).toBeNull(); // 新 token 有效
  });

  it('旧 token 再次使用 → 401（已撤销）', async () => {
    const oldToken = await issueRefreshToken(user.id);
    await rotateRefreshToken(oldToken);

    await expect(rotateRefreshToken(oldToken)).rejects.toBeInstanceOf(AppError);
    try {
      await rotateRefreshToken(oldToken);
    } catch (e) {
      expect((e as AppError).code).toBe('UNAUTHORIZED');
    }
  });

  it('不存在的 token → 401', async () => {
    await expect(rotateRefreshToken('never-issued-token')).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
  });

  it('过期 token → 401', async () => {
    const raw = 'expired-token-value';
    await store.create({
      userId: user.id,
      tokenHash: sha256(raw),
      expiresAt: new Date(Date.now() - 1000),
    });
    await expect(rotateRefreshToken(raw)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('用户已注销 → 409 ACCOUNT_DELETION_PENDING', async () => {
    const raw = await issueRefreshToken(user.id);
    userState.status = 'deleted';
    userState.deletedAt = new Date();
    await expect(rotateRefreshToken(raw)).rejects.toMatchObject({
      code: 'ACCOUNT_DELETION_PENDING',
    });
  });

  it('logout 幂等：不存在的 token 也成功；已撤销的 token 再撤销不报错', async () => {
    await expect(revokeRefreshToken('nope')).resolves.toBeUndefined();
    const raw = await issueRefreshToken(user.id);
    await revokeRefreshToken(raw);
    expect(store.rows[0]!.revokedAt).not.toBeNull();
    await expect(revokeRefreshToken(raw)).resolves.toBeUndefined();
  });

  it('revokeAllForUser 撤销该用户全部有效 token', async () => {
    await issueRefreshToken(user.id);
    await issueRefreshToken(user.id);
    await issueRefreshToken('22222222-2222-2222-2222-222222222222');
    const n = await revokeAllForUser(user.id);
    expect(n).toBe(2);
    expect(store.rows.filter((r) => r.userId === user.id && r.revokedAt === null)).toHaveLength(0);
  });
});
