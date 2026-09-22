/**
 * 密码哈希单元测试（bcryptjs）。
 * 为控制耗时，测试里把 BCRYPT_ROUNDS 降到 4（下限）。
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { hashPassword, verifyPassword, MIN_PASSWORD_LENGTH } from './passwords.js';

beforeAll(() => {
  process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';
  process.env.REDIS_URL ??= 'redis://localhost:6379';
  process.env.JWT_SECRET ??= 'unit-test-secret-at-least-32-bytes-long';
  process.env.ADMIN_TOKEN ??= 'unit-test-admin-token';
  process.env.BCRYPT_ROUNDS = '4';
});

describe('hashPassword / verifyPassword', () => {
  it('哈希结果可校验，且不等于明文', async () => {
    const hash = await hashPassword('correct horse battery');
    expect(hash).not.toBe('correct horse battery');
    expect(hash.startsWith('$2')).toBe(true); // bcrypt 格式
    await expect(verifyPassword('correct horse battery', hash)).resolves.toBe(true);
  });

  it('错误密码校验失败', async () => {
    const hash = await hashPassword('correct horse battery');
    await expect(verifyPassword('wrong password', hash)).resolves.toBe(false);
    await expect(verifyPassword('correct horse batter', hash)).resolves.toBe(false);
    await expect(verifyPassword('', hash)).resolves.toBe(false);
  });

  it('同一明文两次哈希不同（随机 salt）', async () => {
    const a = await hashPassword('same-secret');
    const b = await hashPassword('same-secret');
    expect(a).not.toBe(b);
    await expect(verifyPassword('same-secret', a)).resolves.toBe(true);
    await expect(verifyPassword('same-secret', b)).resolves.toBe(true);
  });

  it('hash 为空（OAuth 用户无密码）一律 false，不抛错', async () => {
    await expect(verifyPassword('anything', null)).resolves.toBe(false);
    await expect(verifyPassword('anything', undefined)).resolves.toBe(false);
    await expect(verifyPassword('anything', '')).resolves.toBe(false);
  });

  it('非法哈希串返回 false 而非抛错', async () => {
    await expect(verifyPassword('anything', 'not-a-bcrypt-hash')).resolves.toBe(false);
  });

  it('支持中文/emoji 等 unicode 明文', async () => {
    const hash = await hashPassword('密码🔒пароль');
    await expect(verifyPassword('密码🔒пароль', hash)).resolves.toBe(true);
    await expect(verifyPassword('密码', hash)).resolves.toBe(false);
  });

  it('最短密码长度常量为 8（契约要求）', () => {
    expect(MIN_PASSWORD_LENGTH).toBe(8);
  });
});
