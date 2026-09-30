/**
 * SSE 帧解析冒烟测试（2026-09-30 引入测试框架时的第一条用例）。
 *
 * 为什么先测它：streamTask 刚从 EventSource 改成 fetch + ReadableStream 手写解析，
 * 帧边界、注释帧（心跳）、多行 data 拼接三处逻辑最容易出错，
 * 且历史上 EventSource 版本因无法带 Authorization 头导致 SSE 恒 401。
 *
 * 用可读流喂入真实 SSE 报文，验证解析结果 —— 不 mock fetch 内部实现，
 * 因为要测的正是「字节 → 帧」这段我们自己写的代码。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setAccessToken, clearSession, streamTask } from '../lib/api';

/** 把若干 SSE 文本帧编码成一个可读流 */
function sseStream(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });
}

/** 断言请求带了 Authorization 头（EventSource 做不到这件事） */
function stubFetch(body: ReadableStream<Uint8Array>, init?: { status?: number }) {
  // 只声明形参不消费时用 _ 前缀会被 noUnusedParameters 放行；
  // 但这里连形参都不需要，故直接不声明（调用方仍可传两个参数）
  const spy = vi.fn(
    async (..._args: Parameters<typeof fetch>) =>
      new Response(body, {
        status: init?.status ?? 200,
        headers: { 'content-type': 'text/event-stream' },
      }),
  );
  vi.stubGlobal('fetch', spy);
  return spy;
}

afterEach(() => {
  clearSession();
  vi.unstubAllGlobals();
});

describe('streamTask —— fetch 流式 SSE 解析', () => {
  it('解析 progress 事件并回传结构化数据', async () => {
    stubFetch(
      sseStream(['event: progress\ndata: {"status":"running","progress":42}\n\n']),
    );
    setAccessToken('tok-abc');

    const seen: Array<[string, unknown]> = [];
    streamTask('tsk_1', (event, data) => seen.push([event, data]));
    await vi.waitFor(() => expect(seen.length).toBeGreaterThan(0));

    expect(seen[0]?.[0]).toBe('progress');
    expect(seen[0]?.[1]).toEqual({ status: 'running', progress: 42 });
  });

  it('携带 Authorization 头 —— EventSource 无法做到，是本次改动的核心', async () => {
    const spy = stubFetch(sseStream(['event: progress\ndata: {}\n\n']));
    setAccessToken('tok-xyz');

    streamTask('tsk_2', () => {});
    await vi.waitFor(() => expect(spy).toHaveBeenCalled());

    const init = spy.mock.calls[0]?.[1] as RequestInit | undefined;
    expect((init?.headers as Record<string, string>)?.authorization).toBe('Bearer tok-xyz');
  });

  it('跳过注释帧（心跳），不误当作事件', async () => {
    stubFetch(
      sseStream(['\n\n: ping\n\nevent: progress\ndata: {"progress":1}\n\n']),
    );
    const seen: string[] = [];
    streamTask('tsk_3', (event) => seen.push(event));
    await vi.waitFor(() => expect(seen.length).toBeGreaterThan(0));
    // 服务端正常收流也会回调 error（api.ts:763「按断线处理，由调用方决定是否重连」），
    // 因此这里断言的是「心跳帧没被当成事件」，而非事件序列的精确值。
    expect(seen).toContain('progress');
    expect(seen.filter((e) => e === 'message')).toHaveLength(0);
  });

  it('取消后不再回调（含流收尾的 error）', async () => {
    stubFetch(
      sseStream(['event: progress\ndata: {}\n\n']),
    );
    const seen: string[] = [];
    const stop = streamTask('tsk_stop', (event) => seen.push(event));
    await vi.waitFor(() => expect(seen).toContain('progress'));
    const countBeforeStop = seen.length;
    stop();
    await new Promise((r) => setTimeout(r, 20));
    expect(seen).toHaveLength(countBeforeStop);
  });

  it('跨 chunk 边界仍能正确切帧', async () => {
    // 一帧被硬切成两段 —— 真实网络下必然发生
    stubFetch(
      sseStream(['event: suc', 'ceeded\ndata: {"status":"succeeded"}\n\n']),
    );
    const seen: Array<[string, unknown]> = [];
    streamTask('tsk_4', (event, data) => seen.push([event, data]));
    await vi.waitFor(() => expect(seen.length).toBeGreaterThan(0));

    expect(seen[0]?.[0]).toBe('succeeded');
    expect(seen[0]?.[1]).toEqual({ status: 'succeeded' });
  });

  it('连接失败（401）时回调 error，交由调用方降级', async () => {
    stubFetch(sseStream([]), { status: 401 });
    const seen: string[] = [];
    streamTask('tsk_5', (event) => seen.push(event));
    await vi.waitFor(() => expect(seen).toContain('error'));
  });
});