"use client";

// F4 内容区：创作记录（Filter + 真实任务列表）。
// 数据源：tasksApi.list({ type, limit })；未登录或请求失败时只展示空态，不白屏。

import { useEffect, useState } from "react";
import { tokenStore } from "@/lib/api/client";
import { tasksApi } from "@/lib/api/resources";
import type { TaskListItem, TaskStatus } from "@/lib/api/types";

interface CreationRecordsProps {
  // 区块标题（取自 site-data：dict.recordTitle）
  title: string;
  // 四个 Filter 文案（取自 site-data：[filterAll, filterVideo, filterImage, filterAudio]）
  filters: string[];
}

// Filter 下标 → 后端 type 参数；下标 0（全部）不传 type
const TYPE_BY_FILTER: (string | undefined)[] = [undefined, "video", "image", "audio"];

// 任务状态中文映射
const STATUS_TEXT: Record<TaskStatus, string> = {
  queued: "排队中",
  running: "进行中",
  succeeded: "已完成",
  failed: "失败",
  cancelled: "已取消",
  timeout: "超时",
};

// capability → Filter 文案下标（用于行内类型标签）
function capabilityFilterIndex(capability: string): number {
  if (capability.includes("video")) return 1;
  if (capability.includes("image")) return 2;
  if (capability.includes("audio")) return 3;
  return 0;
}

export function CreationRecords({ title, filters }: CreationRecordsProps) {
  const [filter, setFilter] = useState(0);
  // 登录态只在挂载时判定一次（token 变化走整页刷新/重挂载，不订阅）。
  const [authed] = useState(() => tokenStore.getAccess() !== null);
  // undefined = 加载中；数组 = 已就绪（含空态）。派生 loaded，不在 effect 里同步置位。
  const [items, setItems] = useState<TaskListItem[] | undefined>(() =>
    tokenStore.getAccess() !== null ? undefined : [],
  );

  // Filter 切换重新拉取；只取第一页（limit 20），不做无限滚动。
  // setState 只出现在 promise 回调里（stale-while-revalidate），effect 体内无同步置位。
  useEffect(() => {
    if (!authed) return;
    let alive = true;
    const type = TYPE_BY_FILTER[filter];
    tasksApi
      .list({ ...(type ? { type } : {}), limit: 20 })
      .then((page) => {
        if (alive) setItems(page.items);
      })
      .catch(() => {
        // 拉取失败同样落到空态，不抛错、不死循环重试
        if (alive) setItems([]);
      });
    return () => {
      alive = false;
    };
  }, [filter, authed]);

  // loaded 由 items 是否就绪派生（undefined=加载中），渲染期计算，不走 effect
  const loaded = items !== undefined;
  const rows = items ?? [];

  return (
    <>
      {/* Creation History header（类名/布局与原来 1:1） */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-extrabold">{title}</h2>
        <div className="inline-flex items-center gap-1 rounded-full bg-white p-1 shadow-sm">
          {filters.map((f, i) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(i)}
              className={`rounded-full px-4 py-1.5 text-xs font-semibold transition-colors ${
                filter === i ? "bg-black text-white" : "text-black/60 hover:bg-black/5"
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* 真实任务列表 */}
      {loaded && rows.length > 0 && (
        <div className="mt-4 space-y-2">
          {rows.map((t) => (
            <div
              key={t.id}
              className="flex items-center gap-3 rounded-xl border border-black/10 bg-white px-4 py-3"
            >
              <span
                className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold ${
                  t.status === "succeeded"
                    ? "bg-emerald-100 text-emerald-700"
                    : t.status === "failed" || t.status === "timeout"
                      ? "bg-red-100 text-red-600"
                      : "bg-[#f0eefe] text-[#1f11ed]"
                }`}
              >
                {STATUS_TEXT[t.status]}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-semibold text-black/80">
                  {t.model.displayName}
                  <span className="ml-2 font-normal text-black/45">
                    {filters[capabilityFilterIndex(t.capability)] ?? t.capability}
                  </span>
                </p>
                <p className="mt-0.5 text-[11px] text-black/45">
                  {new Date(t.createdAt).toLocaleString()}
                </p>
              </div>
              {t.status === "running" || t.status === "queued" ? (
                <div className="w-24 shrink-0">
                  <div className="h-1.5 overflow-hidden rounded-full bg-black/10">
                    <div
                      className="h-full rounded-full bg-[#1f11ed] transition-all"
                      style={{ width: `${t.progress}%` }}
                    />
                  </div>
                  <p className="mt-1 text-right text-[11px] text-black/50">{t.progress}%</p>
                </div>
              ) : (
                <span className="shrink-0 text-[11px] text-black/45">{t.progress}%</span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* 空态：保留占位样式，只换文案为"暂无记录" */}
      {loaded && rows.length === 0 && (
        <div className="mt-4 rounded-2xl border border-black/10 bg-white px-4 py-10 text-center text-sm text-black/45">
          暂无记录
        </div>
      )}
    </>
  );
}
