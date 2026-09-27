/**
 * providers/chat 纯函数单测（R1，xiaoye-adoption F1/F2）。
 *
 * chatOnce 的网络分支走 tests/contract（undici MockAgent，nock 拦不住 undici——
 * 见 workers/transfer.ts:122）；MOCK_PROVIDER 分支保证 CI 零上游。
 * 这里只测零依赖纯函数：限频窗、key 解析、报文构造、响应解析。
 */

import { describe, expect, it } from 'vitest';
import { allowWindow, buildChatBody, extractChatText, firstApiKey } from './chat.js';

describe('allowWindow（分钟 + 日双窗限频，单实例内存实现）', () => {
  it('分钟窗口放行 perMin 次后拒绝，retryAfter 落在 (0,60]', () => {
    expect(allowWindow('w-min-a', 3, 100).allowed).toBe(true);
    expect(allowWindow('w-min-a', 3, 100).allowed).toBe(true);
    expect(allowWindow('w-min-a', 3, 100).allowed).toBe(true);
    const blocked = allowWindow('w-min-a', 3, 100);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSec).toBeGreaterThan(0);
    expect(blocked.retryAfterSec).toBeLessThanOrEqual(60);
  });

  it('不同 key 各算各的', () => {
    expect(allowWindow('w-key-b', 1, 100).allowed).toBe(true);
    expect(allowWindow('w-key-b', 1, 100).allowed).toBe(false);
    expect(allowWindow('w-key-c', 1, 100).allowed).toBe(true);
  });

  it('日额度用尽按 3600s 拒绝（明日再来语义）', () => {
    expect(allowWindow('w-day-d', 10, 2).allowed).toBe(true);
    expect(allowWindow('w-day-d', 10, 2).allowed).toBe(true);
    const blocked = allowWindow('w-day-d', 10, 2);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSec).toBe(3600);
  });

  it('被拒绝的调用不消耗额度（日计数只在放行时自增）', () => {
    expect(allowWindow('w-free-e', 1, 1).allowed).toBe(true);
    for (let i = 0; i < 5; i += 1) expect(allowWindow('w-free-e', 1, 1).allowed).toBe(false);
    // 若被拒调用也计数，dayCount 早已 >= 2；放宽到日额度 2 后应立即放行
    expect(allowWindow('w-free-e', 5, 2).allowed).toBe(true);
  });
});

describe('firstApiKey（LK_API_KEYS JSON 取首把）', () => {
  it('字符串数组取第一把', () => {
    expect(firstApiKey('["sk-a","sk-b"]')).toBe('sk-a');
  });
  it('对象数组兼容 key 字段', () => {
    expect(firstApiKey('[{"key":"sk-x"}]')).toBe('sk-x');
  });
  it('非法 JSON / 空数组 / 无可用字段 → null', () => {
    expect(firstApiKey('not-json')).toBeNull();
    expect(firstApiKey('[]')).toBeNull();
    expect(firstApiKey('[{"foo":1}]')).toBeNull();
    expect(firstApiKey('')).toBeNull();
  });
});

describe('buildChatBody（报文构造单点）', () => {
  it('纯文本：system + user 字符串 content', () => {
    const body = buildChatBody({ system: 'S', prompt: 'P' }, 'm1');
    expect(body['model']).toBe('m1');
    expect(body['messages']).toEqual([
      { role: 'system', content: 'S' },
      { role: 'user', content: 'P' },
    ]);
  });

  it('vision：user content = text + image_url 数组', () => {
    const body = buildChatBody({ prompt: 'P', imageUrl: 'data:image/png;base64,AAA' }, 'm1');
    expect(body['messages']).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'P' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,AAA' } },
        ],
      },
    ]);
  });

  it('无 system 只有 user 轮；maxTokens 才带 max_tokens', () => {
    const body = buildChatBody({ prompt: 'P' }, 'm1');
    expect(Array.isArray(body['messages']) && body['messages'].length).toBe(1);
    expect(body['max_tokens']).toBeUndefined();
    expect(buildChatBody({ prompt: 'P', maxTokens: 64 }, 'm1')['max_tokens']).toBe(64);
  });
});

describe('extractChatText（响应解析单点）', () => {
  it('主形状 choices[0].message.content', () => {
    expect(extractChatText({ choices: [{ message: { content: 'hi' } }] })).toBe('hi');
  });
  it('变体：顶层 content / message.content / 纯字符串', () => {
    expect(extractChatText({ content: 'a' })).toBe('a');
    expect(extractChatText({ message: { content: 'b' } })).toBe('b');
    expect(extractChatText('c')).toBe('c');
  });
  it('无法解析 → 抛错（形状异常属实现问题，500 而非静默空串）', () => {
    expect(() => extractChatText({ foo: 1 })).toThrow();
    expect(() => extractChatText(null)).toThrow();
    expect(() => extractChatText(42)).toThrow();
  });
});
