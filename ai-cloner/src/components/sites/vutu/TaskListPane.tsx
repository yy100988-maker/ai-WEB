"use client";

/**
 * 右侧任务列表（对齐 nova-image-studio 参考图 —— UI-DIFF 后续需求重评估产物）。
 *
 * 结构：头部（标题 + 共/完成/处理中/排队 统计 + 筛选 tab + 清空记录）
 *      + 双列小方图任务卡（72px 缩略图 · 提示词标题 · 模型/比例/×N meta · 5 个操作图标）
 *      + 生成中细进度条（顶部）+ 点缩略图进 lightbox（85vh contain 看原图）。
 *
 * 数据：GET /v1/tasks（R1 起列表已带 prompt/params/batchId），按行 hydrate
 * GET /v1/tasks/:id（taskService.get，R1 起含 prompt/batchId）补 params/results，
 * 按 assetId 签发 viewUrl。hydrate 合并必须防 undefined 覆盖（见 extra.prompt ?? item.prompt）。
 * 两级 ref 缓存（detail/url），15s 轮询只为刷新状态/统计，新行才产生额外请求。
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  Loader2,
  Music,
  Play,
  RotateCcw,
  SquarePen,
  X,
  Wand2,
  Share2,
} from "lucide-react";
import { tokenStore } from "@/lib/api/client";
import { assetsApi, promptsApi, tasksApi } from "@/lib/api/resources";
import type { Locale } from "./site-data";
import type { TaskDetail, TaskListItem, TaskStatus } from "@/lib/api/types";
import { pickFeature } from "./feature-ui";

/** 服务端 detail 会下发 prompt（service.serializeDetail 含 prompt），但冻结类型未声明 → 本地补齐 */
type HydratedDetail = TaskDetail & { prompt?: string };

interface Props {
  locale: Locale;
  view: "video" | "image" | "audio";
  busy: boolean;
  progress: number;
  /** useTaskRunner 的状态（转存中态判断用；translate 视图传 undefined） */
  taskStatus?: string;
  /** 生成完成时间戳 → 立即刷新列表 */
  refreshKey: string;
  /** 行操作：回填提示词 / 按原任务参数重跑 / 点示例回填 */
  onEdit: (prompt: string) => void;
  onRerun: (row: {
    capability: string;
    modelId: string;
    prompt: string;
    params: Record<string, string | number | boolean | string[]>;
  }) => void;
  onPickExample: (p: string) => void;
}

// ------------------------------------------------------------------ 文案（3 语，缺省回落 EN）

interface PaneStrings {
  tabAll: string;
  tabText: string;
  tabImg: string;
  clear: string;
  cleared: string;
  copied: string;
  removed: string;
  backfilled: string;
  noPrompt: string;
  needLogin: string;
  loading: string;
  transferring: string;
  generating: string;
  emptyTitle: string;
  emptyBody: string;
  tryExample: string;
  closeLb: string;
  prevLb: string;
  nextLb: string;
  dlOriginal: string;
  status: Record<TaskStatus, string>;
}

const STR: Record<"en" | "zh-TW" | "zh-CN", PaneStrings> = {
  en: {
    tabAll: "All",
    tabText: "Text-to",
    tabImg: "Image-to",
    clear: "Clear",
    cleared: "View cleared (records stay in My Works)",
    copied: "Prompt copied",
    removed: "Removed from workbench",
    backfilled: "Prompt loaded into composer",
    noPrompt: "This task has no stored prompt",
    needLogin: "Sign in to see your task history",
    loading: "Loading…",
    transferring: "Persisting…",
    generating: "Generating…",
    emptyTitle: "Describe what you want, then hit Create",
    emptyBody: "Your tasks will appear here as a list",
    tryExample: "Try an example",
    closeLb: "Close preview",
    prevLb: "Previous",
    nextLb: "Next",
    dlOriginal: "Download original",
    status: {
      queued: "Queued",
      running: "Running",
      succeeded: "Done",
      failed: "Failed",
      cancelled: "Cancelled",
      timeout: "Timeout",
    },
  },
  "zh-TW": {
    tabAll: "同時顯示",
    tabText: "文生",
    tabImg: "圖生",
    clear: "清空記錄",
    cleared: "已清空目前檢視（記錄仍保留在「我的作品」）",
    copied: "已複製提示詞",
    removed: "已從工作台移除",
    backfilled: "已回填提示詞",
    noPrompt: "該記錄沒有儲存提示詞",
    needLogin: "登入後查看你的任務歷史",
    loading: "載入中…",
    transferring: "轉存中…",
    generating: "正在生成…",
    emptyTitle: "描述你想要的內容，點擊生成",
    emptyBody: "任務會以列表形式出現在這裡",
    tryExample: "試試範例",
    closeLb: "關閉預覽",
    prevLb: "上一張",
    nextLb: "下一張",
    dlOriginal: "下載原圖",
    status: {
      queued: "排隊中",
      running: "進行中",
      succeeded: "已完成",
      failed: "失敗",
      cancelled: "已取消",
      timeout: "逾時",
    },
  },
  "zh-CN": {
    tabAll: "同时显示",
    tabText: "文生",
    tabImg: "图生",
    clear: "清空记录",
    cleared: "已清空当前视图（记录仍保留在「我的作品」）",
    copied: "已复制提示词",
    removed: "已从工作台移除",
    backfilled: "已回填提示词",
    noPrompt: "该记录没有存储提示词",
    needLogin: "登录后查看你的任务历史",
    loading: "加载中…",
    transferring: "转存中…",
    generating: "正在生成…",
    emptyTitle: "描述你想要的内容，点击生成",
    emptyBody: "任务会以列表形式出现在这里",
    tryExample: "试试示例",
    closeLb: "关闭预览",
    prevLb: "上一张",
    nextLb: "下一张",
    dlOriginal: "下载原图",
    status: {
      queued: "排队中",
      running: "进行中",
      succeeded: "已完成",
      failed: "失败",
      cancelled: "已取消",
      timeout: "超时",
    },
  },
};

// 标题按视图区分（生图/视频/音频），单独一张表避免 STR 里再嵌套
const TITLES: Partial<Record<Locale, Record<"video" | "image" | "audio", string>>> & {
  fallback: Record<"video" | "image" | "audio", string>;
} = {
  en: { video: "Video tasks", image: "Image tasks", audio: "Audio tasks" },
  "zh-TW": { video: "影片任務", image: "生圖任務", audio: "音訊任務" },
  "zh-CN": { video: "视频任务", image: "生图任务", audio: "音频任务" },
  fallback: { video: "Generation tasks", image: "Image tasks", audio: "Audio tasks" },
};

function pickStr(locale: Locale): PaneStrings {
  if (locale === "zh-TW") return STR["zh-TW"];
  if (locale === "zh-CN") return STR["zh-CN"];
  return STR.en;
}

/** 筛选 tab 文案（视图相关：文生图/文生视频…） */
function tabLabels(locale: Locale, view: "video" | "image" | "audio", s: PaneStrings): [string, string] {
  const zhTw = locale === "zh-TW";
  const zhCn = locale === "zh-CN";
  if (view === "image") return [zhTw ? "文生圖" : zhCn ? "文生图" : s.tabText + "image", zhTw ? "圖生圖" : zhCn ? "图生图" : s.tabImg + "image"];
  if (view === "video")
    return [
      zhTw ? "文生影片" : zhCn ? "文生视频" : s.tabText + "video",
      zhTw ? "圖生影片" : zhCn ? "图生视频" : s.tabImg + "video",
    ];
  return [zhTw ? "文生音訊" : zhCn ? "文生音频" : s.tabText + "audio", zhTw ? "圖生音訊" : zhCn ? "图生音频" : s.tabImg + "audio"];
}

// ------------------------------------------------------------------ 类型

/** 列表行 + detail hydrate 的补充字段（列表接口本身不带 prompt/params/results） */
interface PaneRow extends TaskListItem {
  prompt?: string;
  params?: Record<string, unknown>;
  results?: Array<{ assetId: string; mimeType: string }>;
  /** 首图预签名 viewUrl（15min 时效，按需签发并缓存） */
  thumbUrl?: string | null;
  /** F5 批量分组键（R1 后列表接口已下发；冻结类型未声明 → 本地补齐，同 hydrate 思路） */
  batchId?: string | null;
}

const EXAMPLES = [
  { img: "/sites/vutu/showcase/row-06.png", t: "Product Impact" },
  { img: "/sites/vutu/showcase/row-01.png", t: "Shoot from Every Angle" },
  { img: "/sites/vutu/showcase/row-05.jpg", t: "Turn Story into Video" },
];

const TERMINAL: TaskStatus[] = ["succeeded", "failed", "cancelled", "timeout"];

type Tab = "all" | "text" | "img";

export function TaskListPane({ locale, view, busy, progress, taskStatus, refreshKey, onEdit, onRerun, onPickExample }: Props) {
  const s = pickStr(locale);
  const f = pickFeature(locale);
  const title = (TITLES[locale] ?? TITLES.fallback)[view];
  const [tText, tImg] = tabLabels(locale, view, s);

  const [rows, setRows] = useState<PaneRow[] | null>(null); // null = 加载中
  const [tab, setTab] = useState<Tab>("all");
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [cleared, setCleared] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<{ urls: string[]; idx: number; caption: string } | null>(null);

  // 两级缓存：detail（prompt/params/results）与 viewUrl（15min 时效），轮询只为新行付费
  const detailCache = useRef(new Map<string, Omit<PaneRow, keyof TaskListItem>>());
  const urlCache = useRef(new Map<string, string>());
  const clearedRef = useRef(false);

  const flash = (text: string) => {
    setMsg(text);
    window.setTimeout(() => setMsg((m) => (m === text ? null : m)), 2400);
  };

  // 登录态挂载时判定一次（与 CreationRecords 同款：token 变化走重挂载，不订阅）
  const [authed] = useState(() => tokenStore.getAccess() !== null);

  // 列表加载 + detail/url hydrate；refreshKey（生成完成）触发立即刷新，15s 轮询保活状态。
  // ⚠️ 未登录分支不在 effect 里同步 setState（react-hooks/set-state-in-effect）：
  // 渲染期用 effRows 派生空态。
  useEffect(() => {
    if (!authed) return;
    let alive = true;

    async function load(): Promise<void> {
      if (clearedRef.current) {
        if (alive) setRows([]);
        return;
      }
      try {
        const page = await tasksApi.list({ type: view, limit: 20 });
        if (!alive) return;
        const base: PaneRow[] = [...page.items].sort((a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        );

        // hydrate：缓存未命中的行才发 detail（prompt/params/results 只在 detail 下发）
        const hydrated = await Promise.all(
          base.map(async (item) => {
            const hit = detailCache.current.get(item.id);
            // 缓存失效规则（Bug1 修复）：running 时缓存的 results:[] 在 succeeded 后
            // 必须重取 —— 状态走列表实时更新，唯独缓存字段会被冻住（紫色占位根因）。
            // 非终态行仍命中缓存（15s 轮询不为运行中行重复付费）；转存真失败的行
            // 每轮重取一次（1 req/15s，可接受），转存一完成缩略图自动出现。
            if (hit && !(TERMINAL.includes(item.status) && (hit.results ?? []).length === 0)) {
              return { ...item, ...hit };
            }
            try {
              const d = (await tasksApi.get(item.id)) as HydratedDetail;
              const extra = {
                // 防御合并：detail 若缺 prompt（旧版后端/字段变更），回落列表行自带值，
                // 绝不能让 undefined 经 {...item, ...extra} 把真实提示词覆盖掉。
                prompt: d.prompt ?? item.prompt,
                params: d.params ?? item.params,
                results: d.results?.map((r) => ({ assetId: r.assetId, mimeType: r.mimeType })) ?? [],
              };
              detailCache.current.set(item.id, extra);
              return { ...item, ...extra };
            } catch {
              return { ...item, results: [] };
            }
          }),
        );

        // 首图 viewUrl：缓存未命中的 asset 才签发
        const withUrls = await Promise.all(
          hydrated.map(async (r) => {
            // 只认 detail results 的 publicId：resultAssetIds 存的是内部 UUID，
            // GET /v1/assets/:id 只认 publicId —— 喂 UUID 必 404（Bug2，此前 fallback 从未成功）。
            // 无 results 即无缩略图（转存中/失败），占位而不发注定失败的请求。
            const first = r.results?.[0]?.assetId;
            if (!first) return { ...r, thumbUrl: null };
            const cached = urlCache.current.get(first);
            if (cached !== undefined) return { ...r, thumbUrl: cached };
            try {
              const d = await assetsApi.get(first);
              urlCache.current.set(first, d.viewUrl);
              return { ...r, thumbUrl: d.viewUrl };
            } catch {
              return { ...r, thumbUrl: null };
            }
          }),
        );

        if (alive) setRows(withUrls);
      } catch {
        // 未登录 / 网络失败 → 空态，不白屏、不重试风暴
        if (alive) setRows([]);
      }
    }

    void load();
    const timer = window.setInterval(() => void load(), 15_000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [view, refreshKey, authed]);

  // 清空后保持隐藏（轮询/刷新都由 clearedRef 拦截），直到切视图/刷新页面
  const doClear = () => {
    clearedRef.current = true;
    setCleared(true);
    setRows([]);
    flash(s.cleared);
  };

  const doRemove = (id: string) => {
    setRemoved((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
    flash(s.removed);
  };

  const doCopy = async (prompt: string) => {
    try {
      await navigator.clipboard.writeText(prompt);
      flash(s.copied);
    } catch {
      /* 剪贴板不可用静默 */
    }
  };

  const doEdit = (prompt: string) => {
    onEdit(prompt);
    flash(s.backfilled);
  };

  const tabsCacheRef = useRef<Array<{ id: string }> | null>(null);

  // F2 反推：结果图 → 提示词 → 复用 onEdit 回填（与「重新编辑」同一条回调链）
  const doReverse = async (r: PaneRow): Promise<void> => {
    const assetId = r.results?.[0]?.assetId ?? r.resultAssetIds?.[0];
    if (!assetId) return;
    flash(f.reversing);
    try {
      const out = await promptsApi.reverse(assetId);
      doEdit(out.prompt);
    } catch {
      flash(f.reverseFail);
    }
  };

  // F4 发布：取首个真实 tab（'all' 是虚拟页签不可发布），决议 D3 自动过审
  const doPublish = async (r: PaneRow): Promise<void> => {
    const assetId = r.results?.[0]?.assetId ?? r.resultAssetIds?.[0];
    const title = (r.prompt ?? "").trim();
    if (!assetId || !title) {
      flash(f.publishFail);
      return;
    }
    try {
      if (tabsCacheRef.current === null) {
        tabsCacheRef.current = (await promptsApi.library()).tabs.map((t) => ({ id: t.id }));
      }
      const tab = tabsCacheRef.current.find((t) => t.id !== "all");
      if (!tab) {
        flash(f.publishFail);
        return;
      }
      flash(f.publishing);
      await promptsApi.publish({ tabCode: tab.id, title: title.slice(0, 2000), assetId });
      flash(f.published);
    } catch {
      flash(f.publishFail);
    }
  };

  // 打开 lightbox：签发该行全部结果的 viewUrl（多张翻页）
  const openLightbox = async (row: PaneRow) => {
    // 同 Bug2：只用 results 的 publicId（resultAssetIds 是内部 UUID，逐个签发必 404）。
    const ids = (row.results ?? []).map((r) => r.assetId);
    if (ids.length === 0) return;
    const urls = await Promise.all(
      ids.map(async (id) => {
        const cached = urlCache.current.get(id);
        if (cached !== undefined) return cached;
        try {
          const d = await assetsApi.get(id);
          urlCache.current.set(id, d.viewUrl);
          return d.viewUrl;
        } catch {
          return "";
        }
      }),
    );
    const good = urls.filter((u) => u !== "");
    if (good.length === 0) return;
    setLightbox({ urls: good, idx: 0, caption: row.prompt ?? "" });
  };

  // lightbox：Esc 关闭 + ← → 翻页 + 锁滚动（自 ResultPane 迁移）
  useEffect(() => {
    if (lightbox === null) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setLightbox(null);
      if (e.key === "ArrowRight")
        setLightbox((l) => (l ? { ...l, idx: (l.idx + 1) % l.urls.length } : l));
      if (e.key === "ArrowLeft")
        setLightbox((l) => (l ? { ...l, idx: (l.idx - 1 + l.urls.length) % l.urls.length } : l));
    }
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [lightbox]);

  // 未登录时渲染期直接派生空态（effect 不做同步 setState，见上方注释）
  const effRows: PaneRow[] | null = authed ? rows : [];

  const visible = (effRows ?? []).filter(
    (r) =>
      !removed.has(r.id) &&
      (tab === "all" ||
        (tab === "text" ? r.capability.startsWith("text_to") : r.capability.startsWith("image_to"))),
  );

  // 统计基于「未删除的全量行」（与参考图 共N·完成N·处理中N·排队N 对齐）
  const aliveRows = (effRows ?? []).filter((r) => !removed.has(r.id));
  const statDone = aliveRows.filter((r) => TERMINAL.includes(r.status)).length;
  const statRunning = aliveRows.filter((r) => r.status === "running").length;
  const statQueued = aliveRows.filter((r) => r.status === "queued").length;

  // F5 批量聚合：batchId → {total, done}（组头进度条用；无 batchId 行为完全不变）
  const batchAgg = new Map<string, { total: number; done: number }>();
  for (const r of aliveRows) {
    if (!r.batchId) continue;
    const cur = batchAgg.get(r.batchId) ?? { total: 0, done: 0 };
    cur.total += 1;
    if (TERMINAL.includes(r.status)) cur.done += 1;
    batchAgg.set(r.batchId, cur);
  }

  // 渲染序列：批量组头 + 行拍平（组头只在该 batchId 首行前插一条）
  type RenderItem = { kind: "head"; key: string; batchId: string } | { kind: "row"; row: PaneRow };
  const renderItems: RenderItem[] = [];
  let lastBatch: string | null = null;
  for (const r of visible) {
    const b = r.batchId ?? null;
    if (b && b !== lastBatch && batchAgg.has(b)) {
      renderItems.push({ kind: "head", key: `h_${b}`, batchId: b });
    }
    lastBatch = b;
    renderItems.push({ kind: "row", row: r });
  }


  const current = lightbox;

  return (
    <div className="flex flex-col gap-3">
      {/* ---- 头部：标题 + 统计 + 筛选 + 清空（参考图右侧栏头） ---- */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h2 className="text-lg font-extrabold text-black">{title}</h2>
          <p className="mt-0.5 text-xs tabular-nums text-black/45">
            {aliveRows.length === 0 && effRows === null
              ? s.loading
              : `共 ${aliveRows.length} · 完成 ${statDone} · 处理中 ${statRunning} · 排队 ${statQueued}`}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <div className="inline-flex items-center gap-1 rounded-full bg-black/[0.06] p-1">
            {(
              [
                ["all", s.tabAll],
                ["text", tText],
                ["img", tImg],
              ] as Array<[Tab, string]>
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                aria-pressed={tab === id}
                onClick={() => setTab(id)}
                className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                  tab === id ? "bg-black text-white" : "text-black/60 hover:text-black"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={doClear}
            disabled={aliveRows.length === 0}
            className="rounded-full border border-black/10 bg-white px-3 py-1.5 text-xs font-semibold text-black/60 transition-colors hover:bg-black/5 hover:text-black disabled:opacity-40"
          >
            {s.clear}
          </button>
        </div>
      </div>

      {/* ---- 生成中细进度条（进行中的任务以进度条形式置顶，不等列表轮询） ---- */}
      {busy && (
        <div className="flex items-center gap-2.5 rounded-xl border border-black/10 bg-white px-4 py-2.5">
          <Loader2 className="size-4 animate-spin text-[#1f11ed]" />
          <p className="text-xs font-semibold text-black/75">
            {taskStatus === "succeeded" && progress >= 99 ? s.transferring : s.generating}
          </p>
          <div className="ml-2 h-1.5 flex-1 overflow-hidden rounded-full bg-black/10">
            <div
              className="h-full rounded-full bg-[#1f11ed] transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
          <span className="text-[11px] tabular-nums text-black/50">{progress}%</span>
        </div>
      )}

      {/* ---- 瞬时提示（复制/移除/回填/清空） ---- */}
      {msg && (
        <p className="rounded-lg bg-[#f0eefe] px-3 py-1.5 text-xs font-medium text-[#1f11ed]">
          {msg}
        </p>
      )}

      {/* ---- 空态 / 列表 ---- */}
      {cleared ? (
        <div className="rounded-2xl border border-dashed border-black/15 bg-black/[0.02] px-6 py-12 text-center text-sm text-black/45">
          {s.cleared}
        </div>
      ) : effRows === null ? (
        <div className="flex items-center justify-center gap-2 rounded-2xl border border-black/10 bg-white px-6 py-12 text-sm text-black/45">
          <Loader2 className="size-4 animate-spin" />
          {s.loading}
        </div>
      ) : visible.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-black/15 bg-black/[0.02] px-6 py-10 text-center">
          <p className="text-sm font-semibold text-black/55">{!authed ? s.needLogin : s.emptyTitle}</p>
          <p className="mt-1 text-xs text-black/40">{!authed ? "" : s.emptyBody}</p>
          {authed && (
            <div className="mt-5">
              <p className="mb-2 text-xs font-medium text-black/45">{s.tryExample}</p>
              <div className="flex flex-wrap justify-center gap-2">
                {EXAMPLES.map((ex) => (
                  <button
                    key={ex.t}
                    type="button"
                    onClick={() => onPickExample(ex.t)}
                    className="rounded-full border border-black/10 bg-white px-3 py-1.5 text-xs font-medium text-black/65 transition-colors hover:border-[#1f11ed]/40 hover:text-black"
                  >
                    {ex.t}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="grid max-h-[min(72vh,600px)] gap-3 overflow-y-auto pr-1 lg:grid-cols-2">
          {/* 列表窗体：固定约 5 行高（600px 上限；小屏回落 72vh），超出走内部上下滚动条 */}
          {renderItems.map((item) => {
            if (item.kind === "head") {
              const agg = batchAgg.get(item.batchId) ?? { total: 1, done: 0 };
              const pct = Math.round((agg.done / Math.max(1, agg.total)) * 100);
              return (
                <div
                  key={item.key}
                  className="flex items-center gap-2 rounded-xl border border-[#1f11ed]/20 bg-[#f0eefe] px-3 py-1.5 lg:col-span-2"
                >
                  <span className="text-[11px] font-bold text-[#1f11ed]">
                    {f.batch} {agg.done}/{agg.total}
                  </span>
                  <div className="h-1.5 w-24 overflow-hidden rounded-full bg-black/10">
                    <div
                      className="h-full rounded-full bg-[#1f11ed] transition-all"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="text-[10px] tabular-nums text-[#1f11ed]/60">{pct}%</span>
                </div>
              );
            }
            const r = item.row;
            const count = r.results?.length || r.resultAssetIds?.length || 0;
            const ratio =
              typeof r.params?.["aspectRatio"] === "string"
                ? (r.params["aspectRatio"] as string)
                : typeof r.params?.["resolution"] === "string"
                  ? (r.params["resolution"] as string)
                  : "";
            const running = r.status === "running" || r.status === "queued";
            const first = r.results?.[0]?.mimeType ?? "";
            return (
              <article
                key={r.id}
                className="flex items-center gap-3 rounded-xl border border-black/10 bg-white p-3 transition-shadow hover:shadow-md"
              >
                {/* 72px 方形缩略图（任何比例统一裁方；点击进 lightbox 看原图） */}
                <button
                  type="button"
                  onClick={() => void openLightbox(r)}
                  disabled={r.thumbUrl === null && running}
                  className="relative size-[72px] shrink-0 overflow-hidden rounded-lg border border-black/5 bg-black/[0.04]"
                  title={r.thumbUrl ? `${locale === "zh-TW" ? "查看原圖" : locale === "zh-CN" ? "查看原图" : "View original"}` : undefined}
                >
                  {r.thumbUrl ? (
                    first.startsWith("video/") ? (
                      <>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={r.thumbUrl} alt="" className="size-full object-cover" />
                        <span className="absolute inset-0 grid place-items-center bg-black/25">
                          <Play className="size-5 text-white" />
                        </span>
                      </>
                    ) : first.startsWith("audio/") ? (
                      <span className="grid size-full place-items-center bg-black/[0.06]">
                        <Music className="size-5 text-black/45" />
                      </span>
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={r.thumbUrl} alt="" loading="lazy" className="size-full object-cover" />
                    )
                  ) : running ? (
                    <span className="grid size-full place-items-center">
                      <Loader2 className="size-5 animate-spin text-[#1f11ed]" />
                    </span>
                  ) : (
                    <span className="grid size-full place-items-center bg-gradient-to-br from-violet-500 to-fuchsia-400 text-[10px] font-bold text-white">
                      {TERMINAL.includes(r.status) && r.status !== "succeeded" ? "✕" : "—"}
                    </span>
                  )}
                  {count > 1 && (
                    <span className="absolute right-1 bottom-1 rounded-full bg-black/70 px-1.5 py-0.5 text-[10px] font-bold text-white">
                      ×{count}
                    </span>
                  )}
                </button>

                {/* 文字区：标题（提示词） + meta + 操作 */}
                <div className="flex min-w-0 flex-1 flex-col">
                  <p className="truncate text-[13px] font-semibold text-black/85" title={r.prompt}>
                    {r.prompt ? `“${r.prompt}”` : s.noPrompt}
                  </p>
                  <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-black/50">
                    <span className="font-medium text-black/65">{r.model.displayName}</span>
                    {ratio && <span>· {ratio}</span>}
                    <span
                      className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                        r.status === "succeeded"
                          ? "bg-emerald-100 text-emerald-700"
                          : r.status === "failed" || r.status === "timeout"
                            ? "bg-red-100 text-red-600"
                            : running
                              ? "bg-[#f0eefe] text-[#1f11ed]"
                              : "bg-black/[0.06] text-black/55"
                      }`}
                    >
                      {s.status[r.status]}
                      {r.status === "running" ? ` ${Math.round(r.progress)}%` : ""}
                    </span>
                  </p>
                  <div className="mt-1.5 flex items-center gap-0.5">
                    <RowIconBtn
                      label={locale === "zh-TW" ? "重新編輯" : locale === "zh-CN" ? "重新编辑" : "Edit"}
                      onClick={() => doEdit(r.prompt ?? "")}
                      disabled={!r.prompt}
                    >
                      <SquarePen className="size-3.5" />
                    </RowIconBtn>
                    <RowIconBtn
                      label={s.dlOriginal}
                      onClick={() => undefined}
                      disabled={!r.thumbUrl}
                      render={
                        r.thumbUrl ? (
                          <a href={r.thumbUrl} download target="_blank" rel="noreferrer">
                            <Download className="size-3.5" />
                          </a>
                        ) : undefined
                      }
                    >
                      <Download className="size-3.5" />
                    </RowIconBtn>
                    <RowIconBtn
                      label={locale === "zh-TW" ? "複製" : locale === "zh-CN" ? "复制" : "Copy"}
                      onClick={() => void doCopy(r.prompt ?? "")}
                      disabled={!r.prompt}
                    >
                      <Copy className="size-3.5" />
                    </RowIconBtn>
                    <RowIconBtn
                      label={locale === "zh-TW" ? "再次生成" : locale === "zh-CN" ? "再次生成" : "Regenerate"}
                      onClick={() => {
                        if (!r.prompt) {
                          flash(s.noPrompt);
                          return;
                        }
                        onRerun({
                          capability: r.capability,
                          modelId: r.model.id,
                          prompt: r.prompt,
                          params: coerceParams(r.params),
                        });
                      }}
                      disabled={!r.prompt}
                    >
                      <RotateCcw className="size-3.5" />
                    </RowIconBtn>
                    <RowIconBtn
                      label={locale === "zh-TW" ? "移除" : locale === "zh-CN" ? "移除" : "Remove"}
                      onClick={() => doRemove(r.id)}
                    >
                      <X className="size-3.5" />
                    </RowIconBtn>
                    <RowIconBtn
                      label={
                        locale === "zh-TW" ? "反推提示詞" : locale === "zh-CN" ? "反推提示词" : "Reverse prompt"
                      }
                      onClick={() => void doReverse(r)}
                      disabled={!(r.results?.[0]?.assetId ?? r.resultAssetIds?.[0])}
                    >
                      <Wand2 className="size-3.5" />
                    </RowIconBtn>
                    <RowIconBtn
                      label={locale === "zh-TW" ? "發布到廣場" : locale === "zh-CN" ? "发布到广场" : "Publish"}
                      onClick={() => void doPublish(r)}
                      disabled={!(r.results?.[0]?.assetId ?? r.resultAssetIds?.[0]) || !r.prompt}
                    >
                      <Share2 className="size-3.5" />
                    </RowIconBtn>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* ---- 大图 lightbox（原 ResultPane 迁移；85vh contain 看原图，← → 翻页） ---- */}
      {current && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={s.closeLb}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
          onClick={() => setLightbox(null)}
        >
          <button
            type="button"
            aria-label={s.closeLb}
            onClick={() => setLightbox(null)}
            className="absolute top-4 right-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
          >
            <X className="size-5" />
          </button>
          {current.urls.length > 1 && (
            <>
              <button
                type="button"
                aria-label={s.prevLb}
                onClick={(e) => {
                  e.stopPropagation();
                  setLightbox((l) => (l ? { ...l, idx: (l.idx - 1 + l.urls.length) % l.urls.length } : l));
                }}
                className="absolute left-3 rounded-full bg-white/10 p-2.5 text-white hover:bg-white/20"
              >
                <ChevronLeft className="size-5" />
              </button>
              <button
                type="button"
                aria-label={s.nextLb}
                onClick={(e) => {
                  e.stopPropagation();
                  setLightbox((l) => (l ? { ...l, idx: (l.idx + 1) % l.urls.length } : l));
                }}
                className="absolute right-3 rounded-full bg-white/10 p-2.5 text-white hover:bg-white/20"
              >
                <ChevronRight className="size-5" />
              </button>
            </>
          )}
          <div className="max-h-full max-w-5xl" onClick={(e) => e.stopPropagation()}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={current.urls[current.idx]}
              alt={current.caption}
              className="max-h-[85vh] w-auto rounded-xl object-contain"
            />
            <div className="mt-3 flex items-center justify-center gap-3 text-xs text-white/70">
              {current.urls.length > 1 && (
                <span className="tabular-nums">
                  {current.idx + 1} / {current.urls.length}
                </span>
              )}
              <a
                href={current.urls[current.idx]}
                download
                target="_blank"
                rel="noreferrer"
                className="rounded-full bg-white/10 px-3 py-1 hover:bg-white/20"
              >
                {s.dlOriginal}
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** 详情 params（Record<string, unknown>）→ 提交可接受的窄类型 */
function coerceParams(
  p: Record<string, unknown> | undefined,
): Record<string, string | number | boolean | string[]> {
  const out: Record<string, string | number | boolean | string[]> = {};
  for (const [k, v] of Object.entries(p ?? {})) {
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") out[k] = v;
    else if (Array.isArray(v) && v.every((x) => typeof x === "string")) out[k] = v as string[];
  }
  return out;
}

/** 行内图标按钮（参考图样式：小号、悬停变主色、支持包 a 标签） */
function RowIconBtn({
  label,
  onClick,
  disabled,
  children,
  render,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
  /** 传入时渲染自定义节点（下载 a 标签），否则包一层 button */
  render?: ReactNode;
}) {
  if (render) {
    return (
      <span
        title={label}
        className={`inline-flex ${disabled ? "pointer-events-none opacity-30" : "opacity-70 hover:opacity-100"} items-center justify-center rounded-md p-1.5 text-black/70 transition-opacity`}
      >
        {render}
      </span>
    );
  }
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center justify-center rounded-md p-1.5 text-black/70 opacity-70 transition-all hover:bg-black/5 hover:text-[#1f11ed] hover:opacity-100 disabled:pointer-events-none disabled:opacity-30"
    >
      {children}
    </button>
  );
}
