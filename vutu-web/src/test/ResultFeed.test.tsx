/**
 * 组件测试冒烟：验证 React 18 + Testing Library 在本项目的 jsdom 环境下可用。
 * 覆盖 ResultFeed 的图片渲染分支 —— 该组件直接暴露了「results 存在但没有 url」
 * 的契约陷阱（历史缺陷：<img src={undefined}> 破图）。
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { TaskSummary } from '../lib/api';
import { ResultFeed } from '../components/ResultFeed';

function task(over: Partial<TaskSummary> = {}): TaskSummary {
  return {
    id: 'tsk_x',
    status: 'succeeded',
    progress: 100,
    capability: 'text_to_image',
    prompt: '一只猫',
    model: { id: 'm1', displayName: '模型A' },
    createdAt: new Date('2026-01-01T00:00:00Z').toISOString(),
    ...over,
  };
}

/** 必填回调统一用 noop，避免每条用例重复写 */
const noop = () => {};

describe('ResultFeed —— 结果图渲染契约', () => {
  it('有 url 时渲染图片，alt 取提示词', () => {
    render(
      <ResultFeed
        tasks={[task({ results: [{ assetId: 'ast_1', url: 'https://cdn/x.png', mimeType: 'image/png' }] })]}
        onRegenerate={noop}
        onDelete={noop}
        onCancel={noop}
      />,
    );
    const img = screen.getByAltText('一只猫') as HTMLImageElement;
    expect(img.getAttribute('src')).toBe('https://cdn/x.png');
  });

  it('results 存在但缺 url 时不得渲染破图 —— 回归用例', () => {
    // 后端详情的 results 不含 url（只有 SSE 终态事件带），
    // 若不守卫就会渲染 <img src="undefined">
    const { container } = render(
      <ResultFeed
        tasks={[task({ results: [{ assetId: 'ast_2', mimeType: 'image/png' }] })]}
        onRegenerate={noop}
        onDelete={noop}
        onCancel={noop}
      />,
    );
    expect(container.querySelector('img')).toBeNull();
  });
});