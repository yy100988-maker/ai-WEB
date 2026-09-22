/**
 * LINK-3 用户旅程（经公网 nginx → api → 真 worker，全程 Mock 上游）：
 * me → balance → checkin → quote → submit → SSE 首帧 → 终态 → 创作记录 → 通知。
 *
 * 前置：LINK_TOKEN（deploy/link-setup.ts 产出）。
 * 关键断言之一是 **SSE 第一帧经 nginx 实时到达**（proxy_buffering off 的验证）；
 * 若 nginx 开了缓冲，首帧会被吞到超时。
 */
import { describe, it, expect } from 'vitest';
import { req, token, waitTerminal } from './client.js';
import { base } from './client.js';

describe('LINK-3 用户旅程', () => {
  it('me → balance → checkin', async () => {
    const t = token();

    const me = await req('GET', '/api/v1/auth/me', { token: t });
    expect(me.statusCode).toBe(200);
    const meData = (me.body as { data: { user: { plan: { code: string } } } }).data;
    expect(meData.user.plan.code).toBe('free');

    const bal = await req('GET', '/api/v1/billing/balance', { token: t });
    expect(bal.statusCode).toBe(200);
    expect((bal.body as { data: { credits: number } }).data.credits).toBe(500);

    const checkin = await req('POST', '/api/v1/checkin', { token: t });
    expect(checkin.statusCode).toBe(200);
    expect((checkin.body as { data: { credits: number } }).data.credits).toBe(5);
  });

  it('submit → SSE 首帧经 nginx 实时到达 → succeeded → 记录/通知可见', async () => {
    const t = token();

    const submit = await req('POST', '/api/v1/tasks', {
      token: t,
      payload: {
        capability: 'text_to_video',
        modelId: 'gk-video-3',
        prompt: 'link test: a dog riding a bicycle in Tokyo at sunset',
        params: { durationSec: 6 },
        idempotencyKey: `link-${Date.now()}`,
      },
    });
    if (submit.statusCode !== 201) {
      throw new Error(`submit failed: ${submit.statusCode} ${JSON.stringify(submit.body)}`);
    }
    const task = (submit.body as { data: { task: { id: string; quotedCredits: number } } }).data.task;
    expect(task.quotedCredits).toBeGreaterThan(0);

    // ---- SSE 首帧：连接后 20s 内必须收到 event: 帧 ----
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000);
    let firstFrame = '';
    try {
      const res = await fetch(`${base()}/api/v1/tasks/${task.id}/stream`, {
        headers: { authorization: `Bearer ${t}`, accept: 'text/event-stream' },
        signal: ctrl.signal,
      });
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/event-stream');
      const reader = res.body!.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const idx = buf.indexOf('\n\n');
        if (idx >= 0) {
          firstFrame = buf.slice(0, idx);
          break;
        }
      }
      await reader.cancel();
    } catch (e) {
      if ((e as Error).name !== 'AbortError') throw e;
    } finally {
      clearTimeout(timer);
    }
    expect(firstFrame).toContain('event:');
    expect(firstFrame).toContain('data:');

    // ---- 等终态（真 worker，约 20s）----
    const final = await waitTerminal(task.id, t);
    expect(final.status).toBe('succeeded');

    // ---- 创作记录可见 ----
    const list = await req('GET', '/api/v1/tasks?type=video', { token: t });
    expect(list.statusCode).toBe(200);
    const items = (list.body as { data: { items: Array<{ id: string; status: string }> } }).data.items;
    expect(items.some((x) => x.id === task.id && x.status === 'succeeded')).toBe(true);

    // ---- 通知到达 ----
    const unread = await req('GET', '/api/v1/notifications/unread-count', { token: t });
    expect(unread.statusCode).toBe(200);
    expect((unread.body as { data: { count: number } }).data.count).toBeGreaterThanOrEqual(1);
  }, 150000);
});
