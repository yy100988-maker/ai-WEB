/**
 * 测试环境统一初始化（vite.config.ts test.setupFiles 指向此处）。
 *
 * 目标：让业务代码在 Node 里跑得跟浏览器一致，同时把「环境差异」
 * 集中收敛到这一个文件 —— 将来换 happy-dom / browser mode 只改这里。
 */
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// 每个用例后卸载已渲染组件，避免用例间 DOM 泄漏
afterEach(() => {
  cleanup();
});

/**
 * jsdom 缺失的浏览器 API 垫片。
 * 只补「业务确实用到」的，且给出明确失败原因而不是静默返回 undefined ——
 * 静默垫片会让测试通过、线上报错，这是最难查的一类假绿。
 */
if (typeof window !== 'undefined') {
  // 组件里用到 localStorage（会话存取）
  if (!window.localStorage) {
    throw new Error('[test-setup] jsdom 未提供 localStorage，请检查 environment 是否为 jsdom');
  }

  // matchMedia：响应式/主题类逻辑常用，jsdom 不实现
  if (!window.matchMedia) {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  }
}

/**
 * 断言用的辅助：等待若干 tick，让 promise 链（fetch / SSE 解析）落定。
 * 比裸 setTimeout 更贴近真实渲染时序，且用例失败信息更可读。
 */
export async function flushPromises(times = 1): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  }
}