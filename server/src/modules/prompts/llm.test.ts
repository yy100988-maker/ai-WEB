/**
 * F1/F2 服务层纯函数单测（R1，xiaoye-adoption §3/§4）。
 * runOptimize/runReverse 全链路（限频→预检→chat→spend）走 tests/integration（MOCK_PROVIDER）。
 */

import { describe, expect, it } from 'vitest';
import { OPTIMIZE_SYSTEM, REVERSE_SYSTEM, clipPrompt } from './llm.js';

describe('clipPrompt（统一截断 2000）', () => {
  it('去首尾空白', () => {
    expect(clipPrompt('  hi  ')).toBe('hi');
  });
  it('超过 2000 截断到 2000', () => {
    expect(clipPrompt('x'.repeat(2500))).toHaveLength(2000);
  });
  it('空/纯空白 → invalidParams（400）', () => {
    expect(() => clipPrompt('')).toThrow();
    expect(() => clipPrompt('   \n  ')).toThrow();
  });
});

describe('优化/反推 system 指令（自撰，AGPL 清洁室）', () => {
  it('两条指令均非空且互不相同（防回归误清/误共用）', () => {
    expect(OPTIMIZE_SYSTEM.length).toBeGreaterThan(50);
    expect(REVERSE_SYSTEM.length).toBeGreaterThan(50);
    expect(OPTIMIZE_SYSTEM).not.toBe(REVERSE_SYSTEM);
  });
  it('优化指令约束"只输出提示词本身"（不带解释）', () => {
    expect(OPTIMIZE_SYSTEM).toContain('只输出');
  });
});
