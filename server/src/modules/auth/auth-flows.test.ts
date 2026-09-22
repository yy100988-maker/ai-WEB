/**
 * 新认证流程单测（全部内存实现，不连 DB/Redis/外网）。
 *
 * 覆盖：
 *  1. 密码策略矩阵（≥6 + 字母 + 数字，reason 精确到项）
 *  2. 验证码 purpose 隔离（注册码走找回 → wrong_purpose，且不消耗尝试次数）
 *  3. verified-token 一次性 + purpose 绑定
 *  4. Google JWKS 验签（本地生成 RSA 键对，自签 JWT；正/反样例全覆盖）
 *  5. mailer 无 Key 行为（dev 走日志联调；prod 抛 EMAIL_NOT_CONFIGURED）
 */

import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import {
  generateKeyPairSync,
  createSign,
  createPublicKey,
} from 'node:crypto';
import { validatePasswordPolicy } from './passwords.js';
import {
  setVerificationStore,
  resetVerificationStore,
  createVerification,
  consumeVerification,
  type VerificationRecord,
} from './verification.js';
import {
  setVerifiedTokenStore,
  resetVerifiedTokenStore,
  issueVerifiedToken,
  consumeVerifiedToken,
} from './verified-token.js';
import { verifyGoogleIdToken, setGoogleCertsForTest, setCertsFetcherForTest } from './google.js';
import { sendVerificationEmail } from './mailer.js';
import { resetConfig, loadConfig } from '../../core/config.js';

vi.mock('../../core/db.js', () => ({
  db: () => {
    throw new Error('unit test must not touch the database');
  },
  transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({}),
}));

beforeAll(() => {
  process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';
  process.env.REDIS_URL ??= 'redis://localhost:6379';
  process.env.JWT_SECRET = 'unit-test-secret-at-least-32-bytes-long';
  process.env.ADMIN_TOKEN ??= 'unit-test-admin-token';
  resetConfig();
  loadConfig();
});

// ---------------------------------------------------------------- 内存存储

function memoryVerificationStore() {
  const records = new Map<string, VerificationRecord & { ttlMs?: number }>();
  const locks = new Map<string, number>();
  return {
    records,
    store: {
      async get(id: string) {
        return records.get(id) ?? null;
      },
      async set(id: string, record: VerificationRecord) {
        records.set(id, record);
      },
      async del(id: string) {
        records.delete(id);
      },
      async lock(id: string, ttlSec: number) {
        locks.set(id, Date.now() + ttlSec * 1000);
      },
      async isLocked(id: string) {
        return (locks.get(id) ?? 0) > Date.now() ? 1 : 0;
      },
      async lockTtl(id: string) {
        const until = locks.get(id) ?? 0;
        return Math.max(0, Math.ceil((until - Date.now()) / 1000));
      },
    },
  };
}

function memoryVerifiedStore() {
  const map = new Map<string, string>();
  return {
    async set(k: string, v: string) {
      map.set(k, v);
    },
    async get(k: string) {
      return map.get(k) ?? null;
    },
    async del(k: string) {
      map.delete(k);
    },
  };
}

afterEach(() => {
  resetVerificationStore();
  resetVerifiedTokenStore();
  setGoogleCertsForTest(null);
});

// ---------------------------------------------------------------- 1. 密码策略

describe('密码策略（≥6 位 + 字母 + 数字）', () => {
  it.each([
    ['abc12', 'too_short'],
    ['abcdef', 'no_digit'],
    ['123456', 'no_letter'],
    ['', 'too_short'],
    ['ab12', 'too_short'],
  ])('%s → %s', (password, reason) => {
    const r = validatePasswordPolicy(password);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe(reason);
  });

  it.each(['abc123', 'a1b2c3d4', 'P@ssw0rd', '12345a', 'abcdef1'])('%s 通过', (password) => {
    expect(validatePasswordPolicy(password)).toEqual({ ok: true });
  });

  it('边界：恰好 6 位且满足组合即通过', () => {
    expect(validatePasswordPolicy('a12345')).toEqual({ ok: true });
    expect(validatePasswordPolicy('12345')).toEqual({ ok: false, reason: 'too_short' });
  });
});

// ---------------------------------------------------------------- 2. purpose 隔离

describe('验证码 purpose 隔离', () => {
  it('注册码默认 purpose=register；找回通道消费 → wrong_purpose', async () => {
    const mem = memoryVerificationStore();
    setVerificationStore(mem.store);

    const { verificationId, code } = await createVerification('user@example.com', 'en');
    const rec = await mem.store.get(verificationId);
    expect(rec?.purpose ?? 'register').toBe('register');

    const r = await consumeVerification(verificationId, code, 'recovery');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('wrong_purpose');

    // 记录还在（wrong_purpose 不消费），原通道仍可用
    const retry = await consumeVerification(verificationId, code, 'register');
    expect(retry.ok).toBe(true);
  });

  it('找回码走注册通道 → wrong_purpose', async () => {
    const mem = memoryVerificationStore();
    setVerificationStore(mem.store);

    const { verificationId, code } = await createVerification('user@example.com', 'en', 'recovery');
    const r = await consumeVerification(verificationId, code, 'register');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('wrong_purpose');
  });

  it('wrong_purpose 不消耗尝试次数（5 次输错才锁的计数不受影响）', async () => {
    const mem = memoryVerificationStore();
    setVerificationStore(mem.store);

    const { verificationId } = await createVerification('user@example.com', 'en');
    await consumeVerification(verificationId, '000001', 'recovery');
    const rec = await mem.store.get(verificationId);
    // attempts 仍为 0：用途传错不是"输错码"
    expect(rec?.attempts).toBe(0);
  });
});

// ---------------------------------------------------------------- 3. verified-token

describe('verified-token 一次性 + purpose 绑定', () => {
  it('消费一次后即失效（重放返回 null）', async () => {
    setVerifiedTokenStore(memoryVerifiedStore());
    const token = await issueVerifiedToken({ identifier: 'a@b.com', locale: 'en', purpose: 'register' });
    expect(token.length).toBeGreaterThan(16);

    const first = await consumeVerifiedToken(token, 'register');
    expect(first?.identifier).toBe('a@b.com');

    const replay = await consumeVerifiedToken(token, 'register');
    expect(replay).toBeNull();
  });

  it('purpose 不符 → null（注册 token 不能重置密码）', async () => {
    setVerifiedTokenStore(memoryVerifiedStore());
    const token = await issueVerifiedToken({ identifier: 'a@b.com', locale: 'en', purpose: 'register' });
    // 注意：先删后验的实现里，这次调用会消费掉 token（返回 null 且不再可用）
    // —— 这是故意的：purpose 传错的调用方不值得第二次机会，且避免了"试探 purpose" oracle
    expect(await consumeVerifiedToken(token, 'recovery')).toBeNull();
    expect(await consumeVerifiedToken(token, 'register')).toBeNull();
  });

  it('过短/空 token 直接拒绝（不查存储）', async () => {
    setVerifiedTokenStore(memoryVerifiedStore());
    expect(await consumeVerifiedToken('', 'register')).toBeNull();
    expect(await consumeVerifiedToken('short', 'register')).toBeNull();
  });
});

// ---------------------------------------------------------------- 4. Google JWKS

const TEST_CLIENT_ID = 'test-client-id.apps.googleusercontent.com';

function base64url(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

describe('Google ID Token 验签', () => {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  const exported = (() => {
    const jwk = createPublicKey(publicKey).export({ format: 'jwk' }) as { n?: string; e?: string; kty?: string };
    return { kid: 'test-kid-1', kty: 'RSA', n: jwk.n!, e: jwk.e! };
  })();

  function signJwt(payload: Record<string, unknown>, kid = 'test-kid-1'): string {
    const header = base64url(JSON.stringify({ alg: 'RS256', kid, typ: 'JWT' }));
    const body = base64url(JSON.stringify(payload));
    const sig = createSign('RSA-SHA256').update(`${header}.${body}`).sign(privateKey);
    return `${header}.${body}.${base64url(sig)}`;
  }

  function validPayload(): Record<string, unknown> {
    const now = Math.floor(Date.now() / 1000);
    return {
      iss: 'https://accounts.google.com',
      aud: TEST_CLIENT_ID,
      sub: 'google-user-123',
      exp: now + 3600,
      iat: now,
      email: 'user@gmail.com',
      email_verified: true,
    };
  }

  function withEnv(fn: () => Promise<void>): Promise<void> {
    const prevClientId = process.env.GOOGLE_CLIENT_ID;
    const prevNodeEnv = process.env.NODE_ENV;
    process.env.GOOGLE_CLIENT_ID = TEST_CLIENT_ID;
    process.env.NODE_ENV = 'test';
    resetConfig();
    loadConfig();
    // 拉取器与缓存都注入测试键：未知 kid 的强制刷新路径也不会碰外网
    const keys = [{ ...exported }];
    setCertsFetcherForTest(async () => keys);
    setGoogleCertsForTest(keys);
    return fn().finally(() => {
      if (prevClientId === undefined) delete process.env.GOOGLE_CLIENT_ID;
      else process.env.GOOGLE_CLIENT_ID = prevClientId;
      if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prevNodeEnv;
      resetConfig();
      loadConfig();
      setGoogleCertsForTest(null);
      setCertsFetcherForTest(null);
    });
  }

  it('合法 token 通过，email_verified 才信任 email', async () => {
    await withEnv(async () => {
      const claims = await verifyGoogleIdToken(signJwt(validPayload()));
      expect(claims.sub).toBe('google-user-123');
      expect(claims.email).toBe('user@gmail.com');
    });
  });

  it('email 未验证 → 只认 sub，不给 email', async () => {
    await withEnv(async () => {
      const claims = await verifyGoogleIdToken(signJwt({ ...validPayload(), email_verified: false }));
      expect(claims.sub).toBe('google-user-123');
      expect(claims.email).toBeUndefined();
    });
  });

  it('aud 不符 → 401（防 token 挪用）', async () => {
    await withEnv(async () => {
      await expect(verifyGoogleIdToken(signJwt({ ...validPayload(), aud: 'other-client' }))).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
      });
    });
  });

  it('过期 → 401', async () => {
    await withEnv(async () => {
      const now = Math.floor(Date.now() / 1000);
      await expect(
        verifyGoogleIdToken(signJwt({ ...validPayload(), exp: now - 3600 })),
      ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    });
  });

  it('篡改 payload → 签名失效 → 401', async () => {
    await withEnv(async () => {
      const good = signJwt(validPayload());
      const [h, , s] = good.split('.');
      const evilBody = base64url(JSON.stringify({ ...validPayload(), sub: 'attacker' }));
      await expect(verifyGoogleIdToken(`${h}.${evilBody}.${s}`)).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
      });
    });
  });

  it('未知 kid → 401（强制刷新后仍无）', async () => {
    await withEnv(async () => {
      await expect(verifyGoogleIdToken(signJwt(validPayload(), 'unknown-kid'))).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
      });
    });
  });
});

// ---------------------------------------------------------------- 5. mailer 无 Key 行为

describe('mailer 无 Key 行为', () => {
  // 这几个用例专门测"发信分支"，必须显式关掉测试环境的抑制开关
  // （MAIL_SUPPRESS 默认由 tests/setup.ts 置 true，用于保护 E2E 不发真实邮件）
  function withSuppressOff<T>(fn: () => Promise<T>): Promise<T> {
    const prev = process.env.MAIL_SUPPRESS;
    process.env.MAIL_SUPPRESS = 'false';
    resetConfig();
    loadConfig();
    return fn().finally(() => {
      if (prev === undefined) delete process.env.MAIL_SUPPRESS;
      else process.env.MAIL_SUPPRESS = prev;
      resetConfig();
      loadConfig();
    });
  }

  it('MAIL_SUPPRESS=true（测试默认）→ 直接抑制，不发信', async () => {
    const prev = process.env.MAIL_SUPPRESS;
    process.env.MAIL_SUPPRESS = 'true';
    resetConfig();
    loadConfig();
    try {
      const r = await sendVerificationEmail({ to: 'a@b.com', code: '123456', purpose: 'register' });
      expect(r.id).toBe('suppressed');
    } finally {
      if (prev === undefined) delete process.env.MAIL_SUPPRESS;
      else process.env.MAIL_SUPPRESS = prev;
      resetConfig();
      loadConfig();
    }
  });

  it('dev 环境无 Key → 日志联调，不抛错', async () => {
    const prevNodeEnv = process.env.NODE_ENV;
    const prevKey = process.env.RESEND_API_KEY;
    process.env.NODE_ENV = 'test';
    delete process.env.RESEND_API_KEY;
    await withSuppressOff(async () => {
      const r = await sendVerificationEmail({ to: 'a@b.com', code: '123456', purpose: 'register' });
      expect(r.id).toBe('dev-noop');
    });
    if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prevNodeEnv;
    if (prevKey !== undefined) process.env.RESEND_API_KEY = prevKey;
    resetConfig();
    loadConfig();
  });

  it('production 无 Key → EMAIL_NOT_CONFIGURED（不断头）', async () => {
    const prevNodeEnv = process.env.NODE_ENV;
    const prevKey = process.env.RESEND_API_KEY;
    process.env.NODE_ENV = 'production';
    delete process.env.RESEND_API_KEY;
    await withSuppressOff(async () => {
      await expect(
        sendVerificationEmail({ to: 'a@b.com', code: '123456', purpose: 'register' }),
      ).rejects.toMatchObject({ code: 'EMAIL_NOT_CONFIGURED' });
    });
    if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prevNodeEnv;
    if (prevKey !== undefined) process.env.RESEND_API_KEY = prevKey;
    resetConfig();
    loadConfig();
  });

  it('Resend 返回 4xx → MailError 携带状态码（供上层翻译成 AppError，避免冒泡成 500）', async () => {
    // 回归：MailError 不是 AppError，若不翻译会冒泡成 500 INTERNAL_ERROR。
    // 真实踩过：Resend 对 example.com 类测试域返回 422，前端只看到"服务器错误"。
    const prevKey = process.env.RESEND_API_KEY;
    const prevFetch = globalThis.fetch;
    const prevNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'test';
    process.env.RESEND_API_KEY = 're_test_key';
    // 本用例要走到真实 fetch 分支，必须关掉抑制
    process.env.MAIL_SUPPRESS = 'false';
    resetConfig();
    loadConfig();
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ statusCode: 422, message: 'Invalid `to` field' }), {
        status: 422,
      })) as typeof fetch;
    try {
      let caught: unknown = null;
      try {
        await sendVerificationEmail({ to: 'a@b.com', code: '123456', purpose: 'register' });
      } catch (err) {
        caught = err;
      }
      expect(caught).not.toBeNull();
      const mailErr = caught as { name?: string; status?: number };
      expect(mailErr.name).toBe('MailError');
      expect(mailErr.status).toBe(422);
    } finally {
      globalThis.fetch = prevFetch;
      if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prevNodeEnv;
      if (prevKey === undefined) delete process.env.RESEND_API_KEY;
      else process.env.RESEND_API_KEY = prevKey;
      process.env.MAIL_SUPPRESS = 'true'; // 恢复测试默认
      resetConfig();
      loadConfig();
    }
  });
});
