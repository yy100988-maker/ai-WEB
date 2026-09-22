/**
 * 后端 fetch 封装（同域 `/api/v1`，nginx 转发到 Fastify）。
 *
 * - 成功返回 `data`；失败抛 `ApiError`（带 code/status/details，组件按 code 分支）。
 * - 401 且持有 refreshToken 时自动轮换一次并重试（并发只换一次，防惊群）。
 * - 无 body 的请求不发 content-type（后端 Fastify 空 JSON 体会 400）。
 */

import type { ApiEnvelope } from "./types";

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: Record<string, unknown>;
  readonly requestId?: string;

  constructor(
    code: string,
    message: string,
    status: number,
    details?: Record<string, unknown>,
    requestId?: string,
  ) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.details = details;
    this.requestId = requestId;
  }
}

const ACCESS_KEY = "vutu.access_token";
const REFRESH_KEY = "vutu.refresh_token";

function storage(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

export const tokenStore = {
  getAccess(): string | null {
    return storage()?.getItem(ACCESS_KEY) ?? null;
  },
  getRefresh(): string | null {
    return storage()?.getItem(REFRESH_KEY) ?? null;
  },
  set(access: string, refresh: string): void {
    storage()?.setItem(ACCESS_KEY, access);
    storage()?.setItem(REFRESH_KEY, refresh);
  },
  setAccess(access: string): void {
    storage()?.setItem(ACCESS_KEY, access);
  },
  clear(): void {
    storage()?.removeItem(ACCESS_KEY);
    storage()?.removeItem(REFRESH_KEY);
  },
};

/** 并发 401 只换一次 token（防 N 个请求同时刷出 N 对新 token） */
let refreshPromise: Promise<boolean> | null = null;

async function tryRefresh(): Promise<boolean> {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    try {
      const refreshToken = tokenStore.getRefresh();
      if (!refreshToken) return false;
      const res = await fetch("/api/v1/auth/refresh", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshToken }),
      });
      if (!res.ok) return false;
      const body = (await res.json()) as ApiEnvelope<{ accessToken: string; refreshToken: string }>;
      if (!body.ok) return false;
      tokenStore.set(body.data.accessToken, body.data.refreshToken);
      return true;
    } catch {
      return false;
    } finally {
      refreshPromise = null;
    }
  })();
  return refreshPromise;
}

export interface RequestOptions {
  method?: string;
  body?: unknown;
  auth?: boolean;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

export async function api<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, auth = false, headers, signal } = opts;

  async function once(withAuth: boolean): Promise<T> {
    const h: Record<string, string> = { ...(headers ?? {}) };
    if (body !== undefined) h["content-type"] = "application/json";
    if (withAuth) {
      const t = tokenStore.getAccess();
      if (t) h.authorization = `Bearer ${t}`;
    }
    const res = await fetch(`/api/v1${path}`, {
      method,
      headers: h,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal,
    });
    const text = await res.text();
    let parsed: ApiEnvelope<T> | null = null;
    try {
      parsed = text ? (JSON.parse(text) as ApiEnvelope<T>) : null;
    } catch {
      throw new ApiError("BAD_RESPONSE", `Invalid JSON (${res.status})`, res.status);
    }
    if (parsed && parsed.ok) return parsed.data;
    const code = parsed && !parsed.ok ? parsed.error.code : "UNKNOWN";
    const message = parsed && !parsed.ok ? parsed.error.message : `HTTP ${res.status}`;
    const details = parsed && !parsed.ok ? parsed.error.details : undefined;
    const requestId = parsed?.requestId;
    throw new ApiError(code, message, res.status, details, requestId);
  }

  try {
    return await once(auth);
  } catch (e) {
    // 401 → 轮换一次后重试；还 401 说明 refresh 也废了，清掉本地 token
    if (auth && e instanceof ApiError && e.status === 401) {
      const ok = await tryRefresh();
      if (ok) {
        try {
          return await once(true);
        } catch (retryErr) {
          if (retryErr instanceof ApiError && retryErr.status === 401) tokenStore.clear();
          throw retryErr;
        }
      }
      tokenStore.clear();
    }
    throw e;
  }
}

/** SSE 事件帧 */
export interface SseFrame {
  event: string;
  data: string;
}

/**
 * 订阅任务 SSE（`fetch` 流式读，不能用 EventSource —— 后者塞不进 Authorization 头）。
 * 首帧即当前态（后端连接后先推一次），断线由调用方重连。
 */
export async function* streamTask(
  taskId: string,
  signal?: AbortSignal,
): AsyncGenerator<SseFrame, void, void> {
  const t = tokenStore.getAccess();
  const res = await fetch(`/api/v1/tasks/${taskId}/stream`, {
    headers: {
      accept: "text/event-stream",
      ...(t ? { authorization: `Bearer ${t}` } : {}),
    },
    signal,
  });
  if (!res.ok || !res.body) {
    throw new ApiError("STREAM_FAILED", `SSE connect failed (${res.status})`, res.status);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf("\n\n")) >= 0) {
        const raw = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        if (!raw.trim() || raw.startsWith(":")) continue;
        let event = "message";
        const lines: string[] = [];
        for (const line of raw.split("\n")) {
          if (line.startsWith("event:")) event = line.slice(6).trim();
          else if (line.startsWith("data:")) lines.push(line.slice(5).trim());
        }
        yield { event, data: lines.join("\n") };
      }
    }
  } finally {
    reader.cancel().catch(() => undefined);
  }
}
