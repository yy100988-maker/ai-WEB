/**
 * 联调测试 HTTP 小客户端（跑在本地，直连公网部署链路）。
 *
 * BASE 默认 https://ai.vutu.cc，可用 LINK_BASE_URL 覆盖。
 * API 统一走 /api/v1 前缀（验证 nginx rewrite 剥前缀链路）。
 */

const BASE = (process.env['LINK_BASE_URL'] ?? 'https://ai.vutu.cc').replace(/\/+$/, '');
const TOKEN = process.env['LINK_TOKEN'] ?? '';

export function base(): string {
  return BASE;
}

export function token(): string {
  if (!TOKEN) throw new Error('LINK_TOKEN 未设置：先执行 deploy/link-setup.ts 准备联调用户');
  return TOKEN;
}

export interface LinkResponse {
  statusCode: number;
  body: unknown;
  headers: Headers;
}

export async function req(
  method: string,
  path: string,
  opts: { payload?: unknown; token?: string; headers?: Record<string, string> } = {},
): Promise<LinkResponse> {
  const headers: Record<string, string> = {
    'accept-language': 'zh-CN,zh;q=0.9',
    ...(opts.payload !== undefined ? { 'content-type': 'application/json' } : {}),
    ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
    ...(opts.headers ?? {}),
  };
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    ...(opts.payload !== undefined ? { body: JSON.stringify(opts.payload) } : {}),
  });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { statusCode: res.status, body, headers: res.headers };
}

/** 轮询任务到终态（走 nginx + 真 worker，Mock 出片约 20s，窗口放宽到 100s） */
export async function waitTerminal(
  taskId: string,
  authToken: string,
  timeoutMs = 100000,
): Promise<{ status: string; raw: unknown }> {
  const deadline = Date.now() + timeoutMs;
  let last: { status: string } = { status: 'queued' };
  let raw: unknown = null;
  while (Date.now() < deadline) {
    const r = await req('GET', `/api/v1/tasks/${taskId}`, { token: authToken });
    if (r.statusCode !== 200) throw new Error(`poll task failed: ${r.statusCode} ${JSON.stringify(r.body)}`);
    raw = (r.body as { data: unknown }).data;
    last = raw as { status: string };
    if (['succeeded', 'failed', 'cancelled', 'timeout'].includes(last.status)) {
      return { status: last.status, raw };
    }
    await new Promise((r2) => setTimeout(r2, 2000));
  }
  throw new Error(`task ${taskId} 未在 ${timeoutMs}ms 内终态，最后状态=${last.status}`);
}
