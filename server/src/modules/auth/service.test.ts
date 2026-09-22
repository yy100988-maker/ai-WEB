/**
 * 认证服务单元测试（不连 DB/Redis）。
 *
 * 覆盖可纯函数化的部分：标识归一化、access token 的 `plan` 声明必须是**计划 code**
 * 而不是 planId（UUID）——这是验收契约里的 payload 形状要求，回归防呆。
 */

import { describe, it, expect, beforeAll, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import { normalizeIdentifier } from './service.js';
import { signAccessToken, verifyAccessToken } from './tokens.js';
import { AppError } from '../../core/errors.js';
import type { PublicUser } from './service.js';

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
});

describe('normalizeIdentifier', () => {
  it('邮箱小写化并去空白', () => {
    expect(normalizeIdentifier({ email: '  User@Example.COM ' })).toEqual({
      kind: 'email',
      value: 'user@example.com',
    });
  });

  it('手机号去掉空格与连字符', () => {
    expect(normalizeIdentifier({ phone: '+886 912-345-678' })).toEqual({
      kind: 'phone',
      value: '+886912345678',
    });
  });

  it('同时给 email 与 phone 时优先 email', () => {
    expect(normalizeIdentifier({ email: 'a@b.com', phone: '13800138000' })).toEqual({
      kind: 'email',
      value: 'a@b.com',
    });
  });

  it('两者都缺 → 400 INVALID_PARAMS', () => {
    expect(() => normalizeIdentifier({})).toThrowError(AppError);
    try {
      normalizeIdentifier({});
    } catch (e) {
      expect((e as AppError).code).toBe('INVALID_PARAMS');
    }
  });

  it('空白字符串视同缺失', () => {
    expect(() => normalizeIdentifier({ email: '   ' })).toThrowError(AppError);
    expect(() => normalizeIdentifier({ phone: '' })).toThrowError(AppError);
  });
});

describe('access token 的 plan 声明（回归防呆）', () => {
  const user: PublicUser = {
    id: '11111111-1111-1111-1111-111111111111',
    publicId: 'usr_abcdefghijkl',
    email: 'a@b.com',
    phone: null,
    displayName: null,
    avatarAssetId: null,
    locale: 'zh-CN',
    timezone: 'Asia/Shanghai',
    planId: '2f1e4d3c-0000-4000-8000-000000000001',
    planCode: 'pro',
    status: 'active',
    createdAt: new Date('2025-01-01T00:00:00Z'),
  };

  it('payload.plan 取计划 code，绝不是 planId(UUID)', () => {
    const token = signAccessToken({
      id: user.id,
      publicId: user.publicId,
      planCode: user.planCode,
      locale: user.locale,
    });

    const decoded = jwt.decode(token) as Record<string, unknown>;
    expect(decoded.plan).toBe('pro');
    expect(decoded.plan).not.toBe(user.planId);
    // 不是 UUID 形状
    expect(String(decoded.plan)).not.toMatch(/^[0-9a-f-]{36}$/i);
  });

  it('verifyAccessToken 回传的 planCode 与签发一致', () => {
    const token = signAccessToken({
      id: user.id,
      publicId: user.publicId,
      planCode: user.planCode,
      locale: user.locale,
    });
    const result = verifyAccessToken(token);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.planCode).toBe('pro');
    expect(result.value.userId).toBe(user.id);
    expect(result.value.publicId).toBe(user.publicId);
    expect(result.value.locale).toBe('zh-CN');
  });
});
