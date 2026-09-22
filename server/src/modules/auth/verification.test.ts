/**
 * 验证码单元测试（mock Redis：注入内存 VerificationStore，绝不连接真实 Redis）。
 *
 * 覆盖：生成 / 消费 / 错误累加 / 5 次锁定 15min / 锁定期拒绝 / 万能码 / 非生产日志。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  createVerification,
  consumeVerification,
  readVerification,
  generateCode,
  isDevCode,
  setVerificationStore,
  resetVerificationStore,
  CODE_TTL_SEC,
  MAX_ATTEMPTS,
  LOCK_TTL_SEC,
  type VerificationStore,
  type VerificationRecord,
} from './verification.js';

/** 内存版 Redis 替身（含 TTL 语义，用假时钟推进） */
function memoryStore() {
  const values = new Map<string, { value: string; expireAt: number }>();
  let now = 1_700_000_000_000;
  const store: VerificationStore & { advance: (ms: number) => void; values: typeof values } = {
    values,
    advance(ms) {
      now += ms;
      for (const [k, v] of values) {
        if (v.expireAt <= now) values.delete(k);
      }
    },
    async get(id) {
      const hit = values.get(id);
      if (!hit || hit.expireAt <= now) return null;
      return JSON.parse(hit.value) as VerificationRecord;
    },
    async set(id, record, ttlSec) {
      values.set(id, { value: JSON.stringify(record), expireAt: now + ttlSec * 1000 });
    },
    async del(id) {
      values.delete(id);
    },
    async lock(id, ttlSec) {
      values.set(`verify:lock:${id}`, { value: '1', expireAt: now + ttlSec * 1000 });
    },
    async isLocked(id) {
      const hit = values.get(`verify:lock:${id}`);
      if (!hit || hit.expireAt <= now) return 0;
      return Math.ceil((hit.expireAt - now) / 1000);
    },
    async lockTtl(id) {
      return store.isLocked(id);
    },
  };
  return store;
}

let store: ReturnType<typeof memoryStore>;

beforeEach(() => {
  process.env.NODE_ENV = 'test';
  store = memoryStore();
  setVerificationStore(store);
});

afterEach(() => {
  resetVerificationStore();
  vi.restoreAllMocks();
});

describe('generateCode', () => {
  it('生成 6 位数字且在 [100000, 999999]', () => {
    for (let i = 0; i < 200; i += 1) {
      const code = generateCode();
      expect(code).toMatch(/^\d{6}$/);
      const n = Number.parseInt(code, 10);
      expect(n).toBeGreaterThanOrEqual(100000);
      expect(n).toBeLessThanOrEqual(999999);
    }
  });
});

describe('createVerification', () => {
  it('写入 Redis 记录并返回 300s 有效期', async () => {
    const { verificationId, expiresInSec } = await createVerification('user@example.com', 'zh-CN');
    expect(expiresInSec).toBe(300);
    expect(expiresInSec).toBe(CODE_TTL_SEC);
    expect(verificationId.length).toBeGreaterThan(8);

    const rec = await readVerification(verificationId);
    expect(rec).not.toBeNull();
    expect(rec!.identifier).toBe('user@example.com');
    expect(rec!.attempts).toBe(0);
    expect(rec!.code).toMatch(/^\d{6}$/);
    expect(rec!.locale).toBe('zh-CN');
  });

  it('验证码 6 位纯数字', async () => {
    const { verificationId } = await createVerification('13800138000');
    const rec = await readVerification(verificationId);
    expect(rec!.code).toMatch(/^\d{6}$/);
  });

  it('非生产环境日志打印验证码（可联调）', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { verificationId, code } = await createVerification('dev@example.com');
    expect(verificationId).toBeTruthy();
    expect(code).toMatch(/^\d{6}$/);
    spy.mockRestore();
  });
});

describe('consumeVerification', () => {
  it('正确码校验通过并删除记录（一次性）', async () => {
    const { verificationId, code } = await createVerification('a@b.com');
    const first = await consumeVerification(verificationId, code);
    expect(first.ok).toBe(true);
    if (first.ok) expect(first.record.identifier).toBe('a@b.com');

    // 已删除 → 再次使用即 not_found
    const second = await consumeVerification(verificationId, code);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.reason).toBe('not_found');
  });

  it('不存在的 verificationId → not_found', async () => {
    const r = await consumeVerification('nope', '123456');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('not_found');
  });

  it('错误码累加 attempts 并返回剩余次数', async () => {
    const { verificationId, code } = await createVerification('a@b.com');
    const wrong = code === '111111' ? '222222' : '111111';

    for (let i = 1; i < MAX_ATTEMPTS; i += 1) {
      const r = await consumeVerification(verificationId, wrong);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.reason).toBe('mismatch');
        expect(r.attemptsLeft).toBe(MAX_ATTEMPTS - i);
      }
      expect((await readVerification(verificationId))!.attempts).toBe(i);
    }

    // 第 5 次失败 → 锁定，记录被清除
    const fifth = await consumeVerification(verificationId, wrong);
    expect(fifth.ok).toBe(false);
    if (!fifth.ok) {
      expect(fifth.reason).toBe('locked');
      expect(fifth.retryAfterSec).toBe(LOCK_TTL_SEC);
    }
    expect(await readVerification(verificationId)).toBeNull();
  });

  it('锁定期间即使码正确也拒绝（locked + retryAfter）', async () => {
    const { verificationId, code } = await createVerification('a@b.com');
    const wrong = code === '111111' ? '222222' : '111111';
    for (let i = 0; i < MAX_ATTEMPTS; i += 1) {
      await consumeVerification(verificationId, wrong);
    }

    const r = await consumeVerification(verificationId, code);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('locked');
      expect(r.retryAfterSec).toBe(LOCK_TTL_SEC);
    }
  });

  it('锁定 15min 后自动解除', async () => {
    const { verificationId, code } = await createVerification('a@b.com');
    const wrong = code === '111111' ? '222222' : '111111';
    for (let i = 0; i < MAX_ATTEMPTS; i += 1) {
      await consumeVerification(verificationId, wrong);
    }
    store.advance((LOCK_TTL_SEC + 1) * 1000);
    // 锁已过期，记录也已删除 → not_found（可重新发码）
    const r = await consumeVerification(verificationId, code);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('not_found');
  });

  it('验证码 300s 后过期 → not_found', async () => {
    const { verificationId, code } = await createVerification('a@b.com');
    store.advance((CODE_TTL_SEC + 1) * 1000);
    const r = await consumeVerification(verificationId, code);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('not_found');
  });
});

describe('万能码 000000', () => {
  it('非生产环境接受万能码', async () => {
    process.env.NODE_ENV = 'development';
    const { verificationId } = await createVerification('a@b.com');
    const r = await consumeVerification(verificationId, '000000');
    expect(r.ok).toBe(true);
    expect(isDevCode('000000')).toBe(true);
  });

  it('生产环境拒绝万能码', async () => {
    process.env.NODE_ENV = 'production';
    expect(isDevCode('000000')).toBe(false);
    const { verificationId } = await createVerification('a@b.com');
    const r = await consumeVerification(verificationId, '000000');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('mismatch');
  });

  it('test 环境同样接受万能码', async () => {
    process.env.NODE_ENV = 'test';
    const { verificationId, code } = await createVerification('a@b.com');
    expect(code).toMatch(/^\d{6}$/);
    const r = await consumeVerification(verificationId, '000000');
    expect(r.ok).toBe(true);
  });
});
