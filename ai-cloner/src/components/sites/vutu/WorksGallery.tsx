"use client";

/**
 * 个人中心「我的作品」。
 *
 * 功能（对齐产品给的参考图）：
 *  1. 顶部分类筛选：全部 / 视频 / 图片 / 音频 / 灵感
 *  2. 日期筛选（起止两天，半开区间下推给后端）
 *  3. 批量操作：多选 → 批量下载 / 批量删除
 *  4. 点击缩略图看大图（图片；视频/音频走内联播放器）
 *  5. 图片与视频**视觉区分**（角标 + 时长/尺寸信息）
 *
 * 数据源：
 *  - `assetsApi.listWorks()`（服务端按 mediaType / 日期在 DB 层过滤，翻页不漏数据）
 *  - 图片缩略图需逐个取 `assetsApi.get(id).viewUrl`（15min 预签名，故并发受限）
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Download,
  Film,
  Image as ImageIcon,
  Music,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { tokenStore } from "@/lib/api/client";
import { assetsApi } from "@/lib/api/resources";
import type { AssetItem } from "@/lib/api/types";
import { DEFAULT_WORKS_I18N, type WorksI18n } from "./site-data";

/**
 * 「灵感」页签用的内置素材库。
 *
 * 与「我的作品」语义不同：这些是平台精选的公开示例（站点自带静态资源），
 * 不是用户资产，因此不走 assets 接口、也不参与批量删除。
 */
const INSPIRE_ASSETS: Array<{ src: string; title: string }> = [
  { src: "/sites/vutu/showcase/row-03.jpg", title: "Million-View AI cat dance video" },
  { src: "/sites/vutu/showcase/row-06.png", title: "Path camera control" },
  { src: "/sites/vutu/showcase/row-07.png", title: "Amazing depth-map reference" },
  { src: "/sites/vutu/showcase/row-09.png", title: "Game CG showcase" },
  { src: "/sites/vutu/templates/tpl-1.png", title: "Cold-brew coffee UGC ad" },
  { src: "/sites/vutu/templates/tpl-2.png", title: "Fashion-film MV" },
  { src: "/sites/vutu/templates/tpl-3.jpg", title: "Sci-fi wormhole escape" },
  { src: "/sites/vutu/templates/tpl-8.jpg", title: "Speeding-train action scene" },
  { src: "/sites/vutu/showcase/row-02.jpg", title: "Your Spider Hero Moment" },
  { src: "/sites/vutu/showcase/row-04.png", title: "Rap music video" },
  { src: "/sites/vutu/showcase/row-05.jpg", title: "POV: You can Climb Walls Now" },
  { src: "/sites/vutu/showcase/row-08.png", title: "Bullet Shot I" },
];

interface WorksGalleryProps {
  /** 字典文案；未提供时用内置中文兜底 */
  i18n?: WorksI18n;
}

type TabKey = "all" | "video" | "image" | "audio" | "inspire";

interface WorkView {
  asset: AssetItem;
  /** 预签名浏览 URL（图片/视频/音频均有；取不到则 null，退化为图标） */
  viewUrl: string | null;
}

/** 每页条数：网格 6 列 × 4 行 */
const PAGE_SIZE = 24;
/** 并发取 viewUrl 的上限，避免一次打爆后端 */
const VIEWURL_CONCURRENCY = 6;

function mediaOf(mime: string): "image" | "video" | "audio" | "other" {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  return "other";
}

function fmtBytes(n?: number): string {
  if (!n) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function fmtDuration(sec?: number | null): string {
  if (!sec || sec <= 0) return "";
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** 本地日期字符串 → ISO（下界取当天 00:00，上界取次日 00:00，半开区间） */
function dayToIso(day: string, nextDay = false): string | undefined {
  if (!day) return undefined;
  const d = new Date(`${day}T00:00:00`);
  if (Number.isNaN(d.getTime())) return undefined;
  if (nextDay) d.setDate(d.getDate() + 1);
  return d.toISOString();
}

/** 受限并发的 map（保持顺序） */
async function mapLimited<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = cursor++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]!, i);
    }
  });
  await Promise.all(workers);
  return out;
}

export function WorksGallery({ i18n }: WorksGalleryProps) {
  const t = i18n ?? DEFAULT_WORKS_I18N;

  const [authed] = useState(() => tokenStore.getAccess() !== null);
  const [tab, setTab] = useState<TabKey>("all");
  const [fromDay, setFromDay] = useState("");
  const [toDay, setToDay] = useState("");
  const [views, setViews] = useState<WorkView[]>([]);
  const [loading, setLoading] = useState(authed);
  /** 已访问页的游标栈（index 即页号），用于回退 */
  const [cursors, setCursors] = useState<Array<string | null>>([]);
  const [pageIdx, setPageIdx] = useState(0);
  /** 当前页返回的下一页游标（null = 没有下一页） */
  const [nextCursor, setNextCursor] = useState<string | null>(null);

  // 批量模式
  const [batchMode, setBatchMode] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [removing, setRemoving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  /** 批量操作后的行内反馈（删除成功数 / 被引用无法删除） */
  const [batchMsg, setBatchMsg] = useState("");

  // 大图预览
  const [preview, setPreview] = useState<WorkView | null>(null);

  const reqSeq = useRef(0);

  const mediaType = tab === "video" || tab === "image" || tab === "audio" ? tab : undefined;

  const load = useCallback(
    async (cursor: string | undefined, seq: number) => {
      setLoading(true);
      try {
        const page = await assetsApi.listWorks({
          ...(mediaType ? { mediaType } : {}),
          ...(dayToIso(fromDay) ? { createdFrom: dayToIso(fromDay)! } : {}),
          ...(dayToIso(toDay, true) ? { createdTo: dayToIso(toDay, true)! } : {}),
          limit: PAGE_SIZE,
          ...(cursor ? { cursor } : {}),
        });
        if (seq !== reqSeq.current) return;

        const withUrls = await mapLimited(page.items, VIEWURL_CONCURRENCY, async (asset) => {
          try {
            const d = await assetsApi.get(asset.id);
            return { asset, viewUrl: d.viewUrl } as WorkView;
          } catch {
            return { asset, viewUrl: null } as WorkView;
          }
        });
        if (seq !== reqSeq.current) return;
        setViews(withUrls);
        setNextCursor(page.nextCursor ?? null);
      } catch {
        if (seq === reqSeq.current) {
          setViews([]);
          setNextCursor(null);
        }
      } finally {
        if (seq === reqSeq.current) setLoading(false);
      }
    },
    [mediaType, fromDay, toDay],
  );

  // 筛选变化 → 重置到第一页
  useEffect(() => {
    if (!authed) return;
    const seq = ++reqSeq.current;
    setPageIdx(0);
    setCursors([]);
    setPicked(new Set());
    setConfirmDelete(false);
    // 「灵感」是内置静态素材，不消耗接口请求
    if (tab === "inspire") {
      setViews([]);
      setNextCursor(null);
      setLoading(false);
      return;
    }
    void load(undefined, seq);
  }, [authed, mediaType, fromDay, toDay, tab, load]);

  const goPage = useCallback(
    (dir: -1 | 1) => {
      if (dir === 1) {
        if (!nextCursor) return;
        const seq = ++reqSeq.current;
        setCursors((c) => [...c.slice(0, pageIdx + 1), nextCursor]);
        setPageIdx((p) => p + 1);
        setPicked(new Set());
        setConfirmDelete(false);
        void load(nextCursor, seq);
      } else {
        if (pageIdx === 0) return;
        const target = cursors[pageIdx - 1] ?? undefined;
        const seq = ++reqSeq.current;
        setPageIdx((p) => p - 1);
        setPicked(new Set());
        setConfirmDelete(false);
        void load(target, seq);
      }
    },
    [cursors, pageIdx, nextCursor, load],
  );

  function togglePick(id: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAll() {
    setPicked((prev) =>
      prev.size === views.length ? new Set() : new Set(views.map((v) => v.asset.id)),
    );
  }

  /** 批量下载：逐个拉预签名 URL 并触发浏览器下载 */
  async function downloadPicked() {
    for (const v of views) {
      if (!picked.has(v.asset.id)) continue;
      try {
        const d = await assetsApi.get(v.asset.id);
        const a = document.createElement("a");
        a.href = d.viewUrl;
        a.download = `${v.asset.id}.${v.asset.mimeType.split("/")[1] ?? "bin"}`;
        a.target = "_blank";
        a.rel = "noopener";
        document.body.appendChild(a);
        a.click();
        a.remove();
        // 间隔触发，避免浏览器把连续下载当作弹窗拦截
        await new Promise((r) => setTimeout(r, 400));
      } catch {
        /* 单个失败不打断其余 */
      }
    }
  }

  async function deletePicked() {
    if (picked.size === 0) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setRemoving(true);
    try {
      const ids = [...picked];
      const res = await assetsApi.batchRemove(ids);
      const gone = new Set(res.deleted);
      setViews((prev) => prev.filter((v) => !gone.has(v.asset.id)));
      setPicked(new Set());
      setConfirmDelete(false);

      // 明确反馈：被创作记录引用的作品删不掉（后端保护，避免历史结果变死链），
      // 不提示的话用户会以为"点了没反应"。
      if (res.skipped.length > 0) {
        setBatchMsg(
          `${t.delete}: ${res.deleted.length} · ${res.skipped[0]?.message ?? t.deleteFailed}`,
        );
      } else {
        setBatchMsg(`${t.delete}: ${res.deleted.length}`);
      }
    } catch {
      setBatchMsg(t.deleteFailed);
    } finally {
      setRemoving(false);
    }
  }

  const counts = useMemo(() => {
    const c = { image: 0, video: 0, audio: 0, other: 0 };
    for (const v of views) c[mediaOf(v.asset.mimeType)] += 1;
    return c;
  }, [views]);

  if (!authed) {
    return (
      <div className="mx-auto mt-10 max-w-md rounded-2xl border border-black/10 bg-white px-6 py-12 text-center text-sm text-black/50">
        {t.needLogin}
      </div>
    );
  }

  const TABS: Array<{ key: TabKey; label: string }> = [
    { key: "all", label: t.tabAll },
    { key: "video", label: t.tabVideo },
    { key: "image", label: t.tabImage },
    { key: "audio", label: t.tabAudio },
    { key: "inspire", label: t.tabInspire },
  ];

  return (
    <div className="mx-auto mt-6 max-w-6xl">
      {/* ---- 顶部：标题 + 分类筛选 ---- */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="inline-flex size-9 items-center justify-center rounded-xl bg-black/5 text-black/60 hover:bg-black/10"
          aria-label="back"
        >
          <ChevronLeft className="size-4" />
        </button>
        <h1 className="text-2xl font-extrabold">{t.title}</h1>

        <div className="ml-2 inline-flex flex-wrap items-center gap-1 rounded-full bg-white p-1 shadow-sm">
          {TABS.map((x) => (
            <button
              key={x.key}
              type="button"
              onClick={() => setTab(x.key)}
              className={`rounded-full px-4 py-1.5 text-xs font-semibold transition-colors ${
                tab === x.key ? "bg-black text-white" : "text-black/60 hover:bg-black/5"
              }`}
            >
              {x.label}
            </button>
          ))}
        </div>

        {/* 日期筛选 */}
        <div className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-xs shadow-sm">
          <input
            type="date"
            value={fromDay}
            onChange={(e) => setFromDay(e.target.value)}
            aria-label={t.pickDate}
            className="bg-transparent text-xs text-black/70 outline-none"
          />
          <span className="text-black/30">~</span>
          <input
            type="date"
            value={toDay}
            onChange={(e) => setToDay(e.target.value)}
            aria-label={t.pickDate}
            className="bg-transparent text-xs text-black/70 outline-none"
          />
          {(fromDay || toDay) && (
            <button
              type="button"
              onClick={() => {
                setFromDay("");
                setToDay("");
              }}
              className="ml-1 rounded-full px-2 py-0.5 text-[11px] text-black/45 hover:bg-black/5"
            >
              {t.clearDate}
            </button>
          )}
        </div>

        {/* 批量操作：仅对「我的作品」有意义，灵感页隐藏 */}
        {tab !== "inspire" && (
          <button
            type="button"
            onClick={() => {
              setBatchMode((v) => !v);
              setPicked(new Set());
              setConfirmDelete(false);
            }}
            className={`ml-auto inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-semibold transition-colors ${
              batchMode ? "bg-black text-white" : "bg-white text-black/70 shadow-sm hover:bg-black/5"
            }`}
          >
            <Check className="size-3.5" />
            {batchMode ? t.batchExit : t.batch}
          </button>
        )}
      </div>

      {/* ---- 保留期提示条（灵感页是静态素材，不涉及保留期） ---- */}
      {tab !== "inspire" && (
        <div className="mt-4 flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5">
          <Sparkles className="size-4 shrink-0 text-amber-500" />
          <p className="text-xs text-amber-800">{t.notice}</p>
        </div>
      )}

      {/* ---- 批量工具条 ---- */}
      {batchMode && tab !== "inspire" && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl bg-white px-4 py-2.5 shadow-sm">
          <button
            type="button"
            onClick={selectAll}
            className="rounded-full bg-black/5 px-3 py-1.5 text-xs font-semibold text-black/70 hover:bg-black/10"
          >
            {t.selectAll}
          </button>
          <span className="text-xs text-black/50">{t.selected.replace("{n}", String(picked.size))}</span>
          {batchMsg && <span className="text-xs font-medium text-amber-600">{batchMsg}</span>}
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              disabled={picked.size === 0}
              onClick={() => void downloadPicked()}
              className="inline-flex items-center gap-1.5 rounded-full bg-black/5 px-3.5 py-1.5 text-xs font-semibold text-black/70 hover:bg-black/10 disabled:opacity-40"
            >
              <Download className="size-3.5" />
              {t.download}
            </button>
            <button
              type="button"
              disabled={picked.size === 0 || removing}
              onClick={() => void deletePicked()}
              className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold disabled:opacity-40 ${
                confirmDelete ? "bg-red-600 text-white hover:bg-red-700" : "bg-red-50 text-red-600 hover:bg-red-100"
              }`}
            >
              <Trash2 className="size-3.5" />
              {removing ? "…" : confirmDelete ? t.deleteConfirm : t.delete}
            </button>
          </div>
        </div>
      )}

      {/* ---- 网格 ---- */}
      {tab === "inspire" ? (
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
          {INSPIRE_ASSETS.map((it) => (
            <div
              key={it.src}
              className="group relative aspect-square overflow-hidden rounded-xl border border-black/10 bg-black/[0.03]"
            >
              {/* 站点内置静态素材：用原生 img（尺寸固定，无需 next/image 优化） */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={it.src}
                alt={it.title}
                loading="lazy"
                className="absolute inset-0 size-full object-cover transition-transform group-hover:scale-105"
              />
              <span className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/70 to-transparent px-2 pt-4 pb-1.5 text-[10px] font-medium text-white">
                {it.title}
              </span>
            </div>
          ))}
        </div>
      ) : loading ? (
        <div className="mt-8 py-16 text-center text-sm text-black/45">{t.loading}</div>
      ) : views.length === 0 ? (
        <div className="mt-8 rounded-2xl border border-black/10 bg-white py-16 text-center text-sm text-black/45">
          {t.empty}
        </div>
      ) : (
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
          {views.map((v) => {
            const kind = mediaOf(v.asset.mimeType);
            const isPicked = picked.has(v.asset.id);
            return (
              <button
                key={v.asset.id}
                type="button"
                onClick={() => (batchMode ? togglePick(v.asset.id) : setPreview(v))}
                className={`group relative aspect-square overflow-hidden rounded-xl border bg-black/[0.03] ${
                  isPicked ? "border-[#1f11ed] ring-2 ring-[#1f11ed]" : "border-black/10"
                }`}
              >
                {v.viewUrl && kind === "image" ? (
                  // 预签名远端 URL：不走 next/image（免配 remotePatterns）
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={v.viewUrl}
                    alt=""
                    loading="lazy"
                    className="absolute inset-0 size-full object-cover transition-transform group-hover:scale-105"
                  />
                ) : v.viewUrl && kind === "video" ? (
                  // 视频：用 video 首帧做缩略（preload=metadata，不自动播放）
                  <video
                    src={v.viewUrl}
                    preload="metadata"
                    muted
                    playsInline
                    className="absolute inset-0 size-full bg-black object-cover"
                  />
                ) : (
                  <span className="absolute inset-0 flex items-center justify-center text-black/30">
                    {kind === "video" ? (
                      <Film className="size-7" />
                    ) : kind === "audio" ? (
                      <Music className="size-7" />
                    ) : (
                      <ImageIcon className="size-7" />
                    )}
                  </span>
                )}

                {/* 类型角标：图片 / 视频 / 音频一眼区分 */}
                <span className="absolute top-1.5 left-1.5 inline-flex items-center gap-1 rounded-full bg-black/60 px-1.5 py-0.5 text-[10px] font-semibold text-white backdrop-blur">
                  {kind === "video" ? (
                    <Film className="size-3" />
                  ) : kind === "audio" ? (
                    <Music className="size-3" />
                  ) : (
                    <ImageIcon className="size-3" />
                  )}
                </span>

                {/* 视频时长 / 图片尺寸 */}
                <span className="absolute right-1.5 bottom-1.5 rounded-md bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white backdrop-blur">
                  {kind === "video" && v.asset.durationSec
                    ? fmtDuration(v.asset.durationSec)
                    : kind === "image" && v.asset.width && v.asset.height
                      ? `${v.asset.width}×${v.asset.height}`
                      : fmtBytes(v.asset.sizeBytes)}
                </span>

                {/* 批量选中圈 */}
                {batchMode && (
                  <span
                    className={`absolute top-1.5 right-1.5 flex size-5 items-center justify-center rounded-full border-2 ${
                      isPicked ? "border-white bg-[#1f11ed] text-white" : "border-white/80 bg-black/30"
                    }`}
                  >
                    {isPicked && <Check className="size-3" />}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* ---- 分页 ---- */}
      {!loading && views.length > 0 && tab !== "inspire" && (
        <div className="mt-6 flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => goPage(-1)}
            disabled={pageIdx === 0}
            className="inline-flex size-9 items-center justify-center rounded-full bg-white text-black/60 shadow-sm hover:bg-black/5 disabled:opacity-40"
          >
            <ChevronLeft className="size-4" />
          </button>
          <span className="text-xs text-black/50">
            {counts.image} {t.tabImage} · {counts.video} {t.tabVideo} · {counts.audio} {t.tabAudio}
          </span>
          <button
            type="button"
            onClick={() => goPage(1)}
            disabled={!nextCursor}
            className="inline-flex size-9 items-center justify-center rounded-full bg-white text-black/60 shadow-sm hover:bg-black/5 disabled:opacity-40"
          >
            <ChevronRight className="size-4" />
          </button>
        </div>
      )}

      {/* ---- 大图/播放预览 ---- */}
      {preview && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setPreview(null)}
        >
          <button
            type="button"
            onClick={() => setPreview(null)}
            className="absolute top-4 right-4 inline-flex size-10 items-center justify-center rounded-full bg-white/15 text-white hover:bg-white/25"
            aria-label="close"
          >
            <X className="size-5" />
          </button>
          <div className="max-h-full max-w-5xl" onClick={(e) => e.stopPropagation()}>
            {mediaOf(preview.asset.mimeType) === "video" && preview.viewUrl ? (
              <video src={preview.viewUrl} controls autoPlay className="max-h-[80vh] rounded-lg" />
            ) : mediaOf(preview.asset.mimeType) === "audio" && preview.viewUrl ? (
              <audio src={preview.viewUrl} controls autoPlay className="w-full" />
            ) : preview.viewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview.viewUrl} alt="" className="max-h-[80vh] rounded-lg object-contain" />
            ) : null}
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-white/80">
              <span>{fmtDate(preview.asset.createdAt)}</span>
              <span>{preview.asset.mimeType}</span>
              {preview.asset.width && preview.asset.height && (
                <span>
                  {preview.asset.width}×{preview.asset.height}
                </span>
              )}
              <span>{fmtBytes(preview.asset.sizeBytes)}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
