/**
 * 限流分桶键回归测试（2026-09-30）。
 *
 * 背景：旧实现用 token 前 20 字符分桶，而 JWT 第一段是固定 header，
 * 所有用户相同 → 全体登录用户共用一个限流桶（任一用户刷满即让所有人 429）。
 * 修复后改为「IP 兜底 + userId 分桶」。
 */
import { describe, expect, it } from 'vitest';
import jwt from 'jsonwebtoken';
import { extractSub } from './http.js';

const SECRET = 'unit-test-secret-at-least-32-bytes-long-xxxxx';
const sign = (sub: string): string => jwt.sign({ sub, plan: 'free' }, SECRET, { algorithm: 'HS256' });

describe('限流分桶键 extractSub', () => {
  it('不同用户取出不同 sub（旧实现会得到完全相同的键）', () => {
    const a = sign('11111111-1111-4111-8111-111111111111');
    const b = sign('22222222-2222-4222-8222-222222222222');
    expect(extractSub(a)).not.toBe(extractSub(b));
    expect(extractSub(a)).toBe('11111111-1111-4111-8111-111111111111');
    expect(extractSub(b)).toBe('22222222-2222-4222-8222-222222222222');
  });

  it('回归：两个不同用户的 token 前 20 字符相同 —— 这正是旧 bug 的根因', () => {
    const a = sign('11111111-1111-4111-8111-111111111111');
    const b = sign('22222222-2222-4222-8222-222222222222');
    expect(a.slice(0, 20)).toBe(b.slice(0, 20));
  });

  it('非 UUID 的 sub 退回 null（交由 IP 维度兜底，避免无限造桶）', () => {
    expect(extractSub(jwt.sign({ sub: 'not-a-uuid' }, SECRET))).toBeNull();
    expect(extractSub(jwt.sign({ sub: 123 }, SECRET))).toBeNull();
    expect(extractSub(jwt.sign({ plan: 'free' }, SECRET))).toBeNull();
  });

  it('畸形 token 一律 null', () => {
    expect(extractSub('')).toBeNull();
    expect(extractSub('abc')).toBeNull();
    expect(extractSub('a.b')).toBeNull();
    expect(extractSub('a.!!!not-base64!!!.c')).toBeNull();
    expect(extractSub('a.eyJzdWIiOiJub3QtYS11dWlkIn0.c')).toBeNull();
  });
});
