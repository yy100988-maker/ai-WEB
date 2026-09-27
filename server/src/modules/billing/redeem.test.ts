/**
 * 积分兑换码纯函数单测（R1，xiaoye-adoption F3）。
 * redeem()/createBatch() 需要 PG —— 走 tests/integration（双花 409 / 条件更新裁决）。
 */

import { describe, expect, it } from 'vitest';
import { codeHash, generateCode, newBatchId, redeemCodeSchema } from './redeem.js';

/** 与 generateCode 同形状：VUTU + 3×4，Crockford 安全字母表（无 I/L/O/U） */
const CODE_RE = /^VUTU(-[0-9A-HJKMNP-TV-Z]{4}){3}$/;

describe('codeHash（DB 唯一入库存储形态）', () => {
  it('大小写与首尾空白归一后同哈希', () => {
    expect(codeHash('vutu-abcd-efgh-jkmn')).toBe(codeHash('  VUTU-ABCD-EFGH-JKMN  '));
  });
  it('输出 64 位小写 hex', () => {
    expect(codeHash('VUTU-0000-0000-0000')).toMatch(/^[0-9a-f]{64}$/);
  });
  it('不同码不同哈希', () => {
    expect(codeHash('VUTU-0000-0000-0000')).not.toBe(codeHash('VUTU-0000-0000-0001'));
  });
});

describe('generateCode（明文只在生成时出现一次）', () => {
  it('形状恒为 VUTU-4-4-4', () => {
    for (let i = 0; i < 200; i += 1) expect(generateCode()).toMatch(CODE_RE);
  });
  it('随机段不含易混字符 I/L/O/U（Crockford 安全字母表；VUTU 前缀是字面量）', () => {
    for (let i = 0; i < 200; i += 1) {
      const randomPart = generateCode().split('-').slice(1).join('');
      expect(randomPart).not.toMatch(/[ILOU]/);
    }
  });
  it('2000 次生成零碰撞（≈60bit 熵抽查）', () => {
    const set = new Set(Array.from({ length: 2000 }, () => generateCode()));
    expect(set.size).toBe(2000);
  });
});

describe('redeemCodeSchema（路由层先验，防任意串喂进 hash 查找）', () => {
  it('接受小写并归一大写', () => {
    expect(redeemCodeSchema.parse('vutu-abcd-efgh-jkmn')).toBe('VUTU-ABCD-EFGH-JKMN');
  });
  it('拒绝空串 / 前缀错 / 含易混字符', () => {
    expect(() => redeemCodeSchema.parse('')).toThrow();
    expect(() => redeemCodeSchema.parse('XXXX-ABCD-EFGH-JKMN')).toThrow();
    expect(() => redeemCodeSchema.parse('VUTU-ABC-ILOU-0000')).toThrow();
    expect(() => redeemCodeSchema.parse('not a code')).toThrow();
  });
});

describe('newBatchId（日志可读的批次 id，非凭据）', () => {
  it('rk_ 前缀且互不相同', () => {
    const a = newBatchId();
    const b = newBatchId();
    expect(a.startsWith('rk_')).toBe(true);
    expect(a).not.toBe(b);
  });
});
