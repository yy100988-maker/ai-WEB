/**
 * LINK-1 前端可达性：nginx → 前端进程链路。
 *
 * 前端目前是纯 mock UI（无真实 API 调用），这里验证"页面能打开"这一半；
 * "调接口"的一半由 LINK-2/LINK-3 覆盖。等 M5 把前端接到后端后，
 * 这里应扩展为浏览器驱动（Playwright）点击创作出片。
 */
import { describe, it, expect } from 'vitest';
import { base, req } from './client.js';

describe('LINK-1 前端可达', () => {
  it('首页 200 且为 HTML', async () => {
    const r = await fetch(`${base()}/`);
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toContain('text/html');
  });

  it('中文站 200', async () => {
    const r = await fetch(`${base()}/zh-CN`);
    expect(r.status).toBe(200);
  });

  it('后端健康经反代 200 且为 Mock 模式', async () => {
    const r = await req('GET', '/api/health');
    expect(r.statusCode).toBe(200);
    const data = (r.body as { data: { status: string; mockProvider: boolean } }).data;
    expect(data.status).toBe('ok');
    expect(data.mockProvider).toBe(true);
  });
});
