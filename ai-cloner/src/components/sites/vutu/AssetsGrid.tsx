"use client";

// F4 内容区：资产视图（真实资产列表 + 删除）。
// 数据源：assetsApi.list({ limit })；图片用详情 viewUrl 缩略图，视频/音频用图标。
// 删除用行内二次确认（不用 confirm()）。未登录时保留原 4 占位色块外观。

import { useEffect, useState } from "react";
import { Film, Image as ImageIcon, Music, Trash2 } from "lucide-react";
import { tokenStore } from "@/lib/api/client";
import { assetsApi } from "@/lib/api/resources";
import type { AssetItem } from "@/lib/api/types";

interface AssetsGridProps {
  // 占位/空态文案（取自 site-data：a.assets）
  label: string;
}

interface AssetView {
  asset: AssetItem;
  // 图片缩略图（GET /v1/assets/:id 下发的 15min 浏览 URL）；非图片为 null
  viewUrl: string | null;
}

function isImage(mimeType: string): boolean {
  return mimeType.startsWith("image/");
}

function isVideo(mimeType: string): boolean {
  return mimeType.startsWith("video/");
}

// 后端 AssetItem 无文件名字段，用 mime + id 短缀 + 日期作为展示标签
function assetLabel(a: AssetItem): string {
  return `${a.mimeType.split("/")[1] ?? a.mimeType} · ${a.id.slice(0, 8)}`;
}

export function AssetsGrid({ label }: AssetsGridProps) {
  const [authed, setAuthed] = useState(false);
  const [views, setViews] = useState<AssetView[]>([]);
  const [loaded, setLoaded] = useState(false);
  // 行内二次确认：存待确认的资产 id，第一次点击进入确认态，第二次真正删除
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    if (!tokenStore.getAccess()) {
      setAuthed(false);
      setLoaded(true);
      return;
    }
    setAuthed(true);
    let alive = true;
    assetsApi
      .list({ limit: 20 })
      .then(async (page) => {
        // 仅图片需要逐个取 viewUrl（15min 有效浏览 URL）；视频/音频只用图标
        const withUrls = await Promise.all(
          page.items.map(async (asset): Promise<AssetView> => {
            if (!isImage(asset.mimeType)) return { asset, viewUrl: null };
            try {
              const detail = await assetsApi.get(asset.id);
              return { asset, viewUrl: detail.viewUrl };
            } catch {
              return { asset, viewUrl: null };
            }
          }),
        );
        if (alive) setViews(withUrls);
      })
      .catch(() => {
        if (alive) setViews([]);
      })
      .finally(() => {
        if (alive) setLoaded(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  async function handleDelete(id: string): Promise<void> {
    // 第一次点击：进入行内确认态；第二次点击：真正删除
    if (confirmingId !== id) {
      setConfirmingId(id);
      return;
    }
    setDeletingId(id);
    try {
      await assetsApi.remove(id);
      setViews((prev) => prev.filter((v) => v.asset.id !== id));
    } catch {
      // 删除失败：退出确认态，保留该资产（不抛错、不白屏）
    } finally {
      setDeletingId(null);
      setConfirmingId(null);
    }
  }

  // 未登录：保留原 4 占位色块外观
  if (!authed) {
    return (
      <div className="mx-auto mt-8 grid max-w-4xl grid-cols-2 gap-4 sm:grid-cols-4">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="flex aspect-video items-center justify-center rounded-xl bg-gradient-to-br from-slate-700 to-slate-900 text-xs text-white/70"
          >
            {label} {i}
          </div>
        ))}
      </div>
    );
  }

  // 空态：保留占位样式（同款渐变色块）
  if (loaded && views.length === 0) {
    return (
      <div className="mx-auto mt-8 grid max-w-4xl grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="col-span-full flex aspect-video items-center justify-center rounded-xl bg-gradient-to-br from-slate-700 to-slate-900 text-xs text-white/70">
          暂无记录
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto mt-8 grid max-w-4xl grid-cols-2 gap-4 sm:grid-cols-4">
      {views.map(({ asset, viewUrl }) => {
        const confirming = confirmingId === asset.id;
        const deleting = deletingId === asset.id;
        const Icon = isVideo(asset.mimeType) ? Film : isImage(asset.mimeType) ? ImageIcon : Music;
        return (
          <div
            key={asset.id}
            className="group relative flex aspect-video flex-col items-center justify-center gap-1 overflow-hidden rounded-xl border border-black/10 bg-white"
          >
            {viewUrl ? (
              // 远端预签名 URL 不走 next/image（免改 remotePatterns），用原生 img
              <img
                src={viewUrl}
                alt={assetLabel(asset)}
                loading="lazy"
                className="absolute inset-0 size-full object-cover"
              />
            ) : (
              <span className="flex size-10 items-center justify-center rounded-full bg-black/5 text-black/50">
                <Icon className="size-5" />
              </span>
            )}
            <span
              className={`relative rounded-full px-2 py-0.5 text-[10px] font-medium ${
                viewUrl ? "bg-black/55 text-white" : "text-black/55"
              }`}
            >
              {assetLabel(asset)}
            </span>
            <span className="relative text-[10px] text-black/40">
              {new Date(asset.createdAt).toLocaleDateString()}
            </span>
            <button
              type="button"
              onClick={() => void handleDelete(asset.id)}
              disabled={deleting}
              className={`absolute top-1.5 right-1.5 inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-semibold transition-colors ${
                confirming
                  ? "bg-red-600 text-white hover:bg-red-700"
                  : "bg-black/55 text-white opacity-0 group-hover:opacity-100 hover:bg-black/75"
              }`}
            >
              <Trash2 className="size-3" />
              {deleting ? "删除中" : confirming ? "确认删除？" : "删除"}
            </button>
          </div>
        );
      })}
    </div>
  );
}
