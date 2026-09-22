/**
 * useTaskRunner：提交生成 → SSE 实时进度 → 终态结果。
 * HeroComposer / ToolComposer / AppHomePage 三处共用，保证行为一致。
 *
 * 流程：quote（展示用，不阻塞）→ POST /v1/tasks（提交即扣）→ SSE 主通道 →
 * SSE 断线则回落 GET 轮询 → succeeded/failed 终态。
 */
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, streamTask } from "./client";
import { tasksApi, type SubmitTaskInput } from "./resources";
import type { TaskResultItem, TaskStatus } from "./types";

export interface RunState {
  running: boolean;
  status: TaskStatus | "idle";
  progress: number;
  taskId: string | null;
  results: TaskResultItem[];
  quotedCredits: number | null;
  error: { code: string; message: string } | null;
}

const IDLE: RunState = {
  running: false,
  status: "idle",
  progress: 0,
  taskId: null,
  results: [],
  quotedCredits: null,
  error: null,
};

function randomKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
}

export function useTaskRunner() {
  const [state, setState] = useState<RunState>(IDLE);
  const abortRef = useRef<AbortController | null>(null);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    if (pollTimer.current) {
      clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
  }, []);

  useEffect(() => stop, [stop]);

  const applyTerminal = useCallback((status: TaskStatus, results: TaskResultItem[]) => {
    stop();
    setState((s) => ({ ...s, running: false, status, progress: status === "succeeded" ? 100 : s.progress, results }));
  }, [stop]);

  /** 轮询回落（SSE 连不上/断线时用） */
  const startPolling = useCallback(
    (taskId: string) => {
      if (pollTimer.current) clearInterval(pollTimer.current);
      pollTimer.current = setInterval(async () => {
        try {
          const d = await tasksApi.get(taskId);
          // succeeded 但转存未完成（results 为空）时不终结，继续等转存，最多由 waitForResults 兜底。
          if (d.status === "succeeded" && (!d.results || d.results.length === 0)) {
            setState((s) => ({ ...s, status: d.status, progress: 99 }));
            return;
          }
          setState((s) => ({ ...s, status: d.status, progress: d.progress }));
          if (d.status === "succeeded" || d.status === "failed" || d.status === "cancelled" || d.status === "timeout") {
            applyTerminal(d.status, d.results ?? []);
          }
        } catch {
          /* 轮询失败忽略，等下一次 tick */
        }
      }, 2500);
    },
    [applyTerminal],
  );

  /** 转存等待：succeeded 后 results 为空时轮询详情直到非空（最多 30 秒） */
  const waitForResults = useCallback(
    async (taskId: string, first: TaskResultItem[]) => {
      if (first.length > 0) return first;
      setState((s) => ({ ...s, status: "succeeded", progress: 99 }));
      for (let i = 0; i < 15; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        try {
          const d = await tasksApi.get(taskId);
          if (d.results && d.results.length > 0) return d.results;
          // 终态失败则直接返回空，由调用方走失败分支
          if (d.status === "failed" || d.status === "cancelled" || d.status === "timeout") return [];
        } catch {
          /* 忽略单次失败，继续等 */
        }
      }
      return [];
    },
    [],
  );

  const run = useCallback(
    async (input: Omit<SubmitTaskInput, "idempotencyKey"> & { idempotencyKey?: string }) => {
      stop();
      setState({ ...IDLE, running: true, status: "queued", progress: 1, error: null });
      const idempotencyKey = input.idempotencyKey ?? randomKey();
      try {
        const res = await tasksApi.submit({ ...input, idempotencyKey });
        const taskId = res.task.id;
        setState((s) => ({
          ...s,
          taskId,
          status: res.task.status as TaskStatus,
          progress: Math.max(1, res.task.progress ?? 0),
          quotedCredits: res.task.quotedCredits,
        }));

        // SSE 主通道
        const ctrl = new AbortController();
        abortRef.current = ctrl;
        try {
          for await (const frame of streamTask(taskId, ctrl.signal)) {
            if (!frame.data) continue;
            let evt: { status?: TaskStatus; progress?: number; results?: TaskResultItem[]; error?: { code: string; message: string } };
            try {
              evt = JSON.parse(frame.data) as typeof evt;
            } catch {
              continue;
            }
            if (evt.status === "succeeded") {
              // 结果以详情接口为准（SSE 只带状态，防字段漂移）。
              // 后端先发 succeeded 再异步转存，首次详情可能 results 为空，需等待转存完成。
              try {
                const d = await tasksApi.get(taskId);
                const waited = await waitForResults(taskId, d.results ?? []);
                if (waited.length > 0) {
                  applyTerminal("succeeded", waited);
                } else if (evt.results && evt.results.length > 0) {
                  applyTerminal("succeeded", evt.results);
                } else {
                  setState((s) => ({
                    ...s,
                    error: { code: "TRANSFER_TIMEOUT", message: "转存超时，请到「我的作品」查看" },
                  }));
                  applyTerminal("succeeded", []);
                }
              } catch {
                const waited = await waitForResults(taskId, evt.results ?? []);
                applyTerminal("succeeded", waited);
              }
              return;
            }
            if (evt.status === "failed" || evt.status === "cancelled" || evt.status === "timeout") {
              setState((s) => ({ ...s, error: evt.error ?? { code: "FAILED", message: "" } }));
              applyTerminal(evt.status, []);
              return;
            }
            setState((s) => ({
              ...s,
              status: (evt.status as TaskStatus) ?? s.status,
              progress: typeof evt.progress === "number" ? evt.progress : s.progress,
            }));
          }
          // 流正常结束但没终态 → 回落轮询
          startPolling(taskId);
        } catch (e) {
          if (e instanceof DOMException && e.name === "AbortError") return;
          startPolling(taskId);
        }
      } catch (e) {
        stop();
        if (e instanceof ApiError) {
          setState((s) => ({ ...s, running: false, status: "idle", error: { code: e.code, message: e.message } }));
        } else {
          setState((s) => ({ ...s, running: false, status: "idle", error: { code: "NETWORK", message: "网络异常" } }));
        }
      }
    },
    [applyTerminal, startPolling, stop, waitForResults],
  );

  const reset = useCallback(() => {
    stop();
    setState(IDLE);
  }, [stop]);

  return { ...state, run, reset, stop };
}
