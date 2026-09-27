"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import {
  AtSign,
  ChevronDown,
  Check,
  Clapperboard,
  Compass,
  Folder,
  Gem,
  Globe,
  Headphones,
  Image as ImageIcon,
  Languages,
  Loader2,
  Music,
  Plus,
  Scissors,
  Shapes,
  Sparkles,
  Undo2,
  User,
  X,
  Zap,
} from "lucide-react";
import type { Locale } from "./site-data";
import { DEFAULT_WORKS_I18N, LOCALES, siteContent } from "./site-data";
// F5 个人中心「我的作品」：作品网格 + 分类/日期筛选 + 批量操作 + 大图预览
import { WorksGallery } from "./WorksGallery";
// F4 内容区（?prompt=&img= 解析逻辑不动；资产视图已下线，见 2026-09-24(9)）
// 创作记录已迁至「我的作品」（WorksGallery），工作台不再引用 CreationRecords
// 右侧任务列表（对齐 nova 参考图），取代旧 ResultPane 单大图预览
import { TaskListPane } from "./TaskListPane";
// F3 计费展示：侧栏订阅名/积分/签到 + 通知未读数（共享层直接复用，不另起炉灶）
import { AuthProvider, useAuth } from "@/lib/api/auth-context";
// F2 生成链路：任务提交/SSE 进度 + 模型/报价（与 Hero/Tool 共用 useTaskRunner，不另写一套）
import { useTaskRunner } from "@/lib/api/use-task-runner";
import { assetsApi, billingApi, catalogApi, promptsApi } from "@/lib/api/resources";
import type { CatalogModel, ModelDetail, ModelParamOption, SubscriptionData } from "@/lib/api/types";
import { AuthDialog } from "./AuthDialog";
import { errCode, pickFeature } from "./feature-ui";

interface Props {
  locale: Locale;
  base: string;
}

type View =
  | "video"
  | "image"
  | "audio"
  | "canvas"
  | "editor"
  | "viral"
  | "avatar"
  | "translate"
  | "works"
  | "explore"
  | "support"
  | "language";

const INSP = [
  "/sites/vutu/showcase/row-03.jpg",
  "/sites/vutu/showcase/row-04.png",
  "/sites/vutu/showcase/row-08.png",
  "/sites/vutu/showcase/row-09.png",
  "/sites/vutu/showcase/row-10.png",
];

const TPL = [
  "/sites/vutu/templates/tpl-1.png",
  "/sites/vutu/templates/tpl-2.png",
  "/sites/vutu/templates/tpl-3.jpg",
  "/sites/vutu/templates/tpl-4.png",
];

function useCountdown() {
  const [left, setLeft] = useState("--:--:--");
  useEffect(() => {
    function tick() {
      const now = new Date();
      const end = new Date(now);
      end.setHours(23, 59, 59, 999);
      const ms = Math.max(0, end.getTime() - now.getTime());
      const h = Math.floor(ms / 3600000);
      const m = Math.floor((ms % 3600000) / 60000);
      const s = Math.floor((ms % 60000) / 1000);
      setLeft(
        `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`,
      );
    }
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  return left;
}

// ---- F2：模型 params 定义取候选项（兼容 resolution/duration/durationSec/aspectRatio/aspect_ratio 等键名） ----
function optionStrings(opt: ModelParamOption | undefined): string[] {
  if (!opt) return [];
  if (opt.options && opt.options.length > 0) return opt.options.map((o) => String(o));
  if (opt.type === "int" && typeof opt.min === "number" && typeof opt.max === "number") {
    const out: string[] = [];
    for (let v = opt.min; v <= opt.max; v += 1) out.push(String(v));
    return out;
  }
  if (opt.default !== undefined) return [String(opt.default)];
  return [];
}

function pickParam(params: ModelDetail["params"], keys: string[]): ModelParamOption | undefined {
  for (const k of keys) {
    const v = params[k];
    if (v) return v;
  }
  return undefined;
}

// 默认选中：价格维度（resolution/size/durationSec）优先首个非 auto 具体值
// ——价格表里没有 auto 行，默认 auto 会直接 409；非价格维度沿用目录 default。
function pickDefault(opts: string[], optDef: ModelParamOption | undefined, pricingDim: boolean): string {
  if (opts.length === 0) return "";
  const d = optDef?.default !== undefined ? String(optDef.default) : undefined;
  if (!pricingDim && d !== undefined && opts.includes(d)) return d;
  const concrete = opts.find((o) => o !== "auto");
  if (concrete !== undefined) return concrete;
  if (d !== undefined && opts.includes(d)) return d;
  return opts[0] ?? "";
}

/**
 * 工作台内嵌控件文案（结果卡/灯箱/工具栏等原本写死中文 —— UI-DIFF P1-6：
 * `/en/app` 混入简中、zh-TW 页混入简体）。en 为缺省，ja/de/… 回落 en。
 */
interface WorkbenchUi {
  viewLarge: string;
  zoomTitle: string;
  done: string;
  previewOff: string;
  previewOffShort: string;
  transferring: string;
  generating: string;
  count: string; // {n} 张
  reedit: string;
  regen: string;
  del: string;
  emptyTitle: string;
  emptyBody: string;
  tryExample: string;
  closePreview: string;
  prev: string;
  next: string;
  resultPreview: string;
  download: string;
  newChat: string;
  canvas: string;
  editor: string;
  refImportFail: string;
  uploadRef: string;
  refImg: string;
  checkin: string;
}

const WORKBENCH_UI: Record<"en" | "zh-TW" | "zh-CN", WorkbenchUi> = {
  en: {
    viewLarge: "View large",
    zoomTitle: "Click to view large",
    done: "Creation finished",
    previewOff: "Preview unavailable (check My Works)",
    previewOffShort: "Preview unavailable",
    transferring: "Persisting…",
    generating: "Generating…",
    count: "{n} images",
    reedit: "Re-edit",
    regen: "Regenerate",
    del: "Delete",
    emptyTitle: "Describe what you want, then hit create",
    emptyBody: "Your result will appear here",
    tryExample: "Try an example",
    closePreview: "Close preview",
    prev: "Previous",
    next: "Next",
    resultPreview: "Result preview",
    download: "Download original",
    newChat: "New chat",
    canvas: "Canvas",
    editor: "Editor",
    refImportFail: "Failed to import the reference image",
    uploadRef: "Upload a reference image",
    refImg: "Reference image",
    checkin: "Check in",
  },
  "zh-TW": {
    viewLarge: "查看大圖",
    zoomTitle: "點擊查看大圖",
    done: "創作完成",
    previewOff: "結果預覽暫時不可用（可到「我的作品」查看）",
    previewOffShort: "結果預覽暫時不可用",
    transferring: "轉存中…",
    generating: "正在生成…",
    count: "{n} 張",
    reedit: "重新編輯",
    regen: "再次生成",
    del: "刪除",
    emptyTitle: "描述你想要的內容，點擊生成",
    emptyBody: "結果會顯示在這裡",
    tryExample: "試試範例",
    closePreview: "關閉預覽",
    prev: "上一張",
    next: "下一張",
    resultPreview: "結果預覽",
    download: "下載原圖",
    newChat: "新聊天",
    canvas: "畫布",
    editor: "編輯器",
    refImportFail: "參考圖匯入失敗",
    uploadRef: "上傳參考圖",
    refImg: "參考圖",
    checkin: "簽到",
  },
  "zh-CN": {
    viewLarge: "查看大图",
    zoomTitle: "点击查看大图",
    done: "创作完成",
    previewOff: "结果预览暂时不可用（可到「我的作品」查看）",
    previewOffShort: "结果预览暂时不可用",
    transferring: "转存中…",
    generating: "正在生成…",
    count: "{n} 张",
    reedit: "重新编辑",
    regen: "再次生成",
    del: "删除",
    emptyTitle: "描述你想要的内容，点击生成",
    emptyBody: "结果会显示在这里",
    tryExample: "试试示例",
    closePreview: "关闭预览",
    prev: "上一张",
    next: "下一张",
    resultPreview: "结果预览",
    download: "下载原图",
    newChat: "新聊天",
    canvas: "画布",
    editor: "编辑器",
    refImportFail: "参考图导入失败",
    uploadRef: "上传参考图",
    refImg: "参考图",
    checkin: "签到",
  },
};

function pickWorkbenchUi(locale: string): WorkbenchUi {
  if (locale === "zh-TW") return WORKBENCH_UI["zh-TW"];
  if (locale === "zh-CN") return WORKBENCH_UI["zh-CN"];
  return WORKBENCH_UI.en;
}

// chip 标签（如 "10s" / "10秒"）解析出秒数，按契约映射为 durationSec。
function parseSeconds(label: string): number {
  const m = label.match(/(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
}

/**
 * 参数下拉（把原本平铺多行的 chip 行收进一个浮层，节省垂直空间）。
 *
 * - 收起态只显示「参数名 + 当前值」，一行即可容纳多个维度；
 * - 展开后是选项网格，点选即收起（与 chip 行为一致，少一次点击）；
 * - 点击外部 / Esc 关闭。
 */
function ParamDropdown({
  label,
  value,
  options,
  onPick,
  icon: Icon,
  disabled,
}: {
  label: string;
  value: string;
  options: string[];
  onPick: (v: string) => void;
  icon?: typeof Clapperboard;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  // 点击外部 / Esc 关闭
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (options.length === 0) return null;

  return (
    <div ref={boxRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-40 ${
          open ? "bg-black/10 text-black/80" : "bg-black/5 text-black/70 hover:bg-black/10"
        }`}
      >
        {Icon && <Icon className="size-3" />}
        <span className="text-black/45">{label}</span>
        <span className="max-w-[9rem] truncate font-semibold text-black/85">{value || "—"}</span>
        <ChevronDown className={`size-3 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        // 下拉菜单：向下弹出（符合直觉，不再盖住上方参数行）。
        // right-0 让它向按钮左侧展开，避免贴近左栏右缘时被裁切；
        // 纵向单列 + 滚动，选项多时也不会撑出容器。
        <div className="absolute top-full right-0 z-50 mt-2 max-h-64 w-44 overflow-y-auto rounded-xl border border-black/10 bg-white py-1.5 shadow-[0_12px_32px_rgba(0,0,0,0.18)]">
          <p className="px-3 pt-1 pb-1.5 text-[11px] font-semibold text-black/40">{label}</p>
          {options.map((o) => (
            <button
              key={o}
              type="button"
              onClick={() => {
                onPick(o);
                setOpen(false);
              }}
              className={`flex w-full items-center justify-between px-3 py-1.5 text-left text-xs transition-colors ${
                value === o
                  ? "bg-[#f0eefe] font-semibold text-[#1f11ed]"
                  : "text-black/75 hover:bg-black/5"
              }`}
            >
              <span>{o}</span>
              {value === o && <Check className="size-3.5 shrink-0" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// F3：顶层改名 Inner，外层包 AuthProvider（契约第 3 条；SiteHeader 的包裹覆盖不到此处，不嵌套）
function AppHomePageInner({ locale, base }: Props) {
  const dict = siteContent[locale];
  const a = dict.app;
  // 内嵌控件文案（结果卡/灯箱/工具栏），按 locale 取 —— 修 UI-DIFF P1-6 语言串台
  const ui = pickWorkbenchUi(locale);
  const f = pickFeature(locale);

  // F1 优化 / F3 兑换（决议 D1：charge-after 扣积分，成功才扣、成败独立反馈）
  const [optimizing, setOptimizing] = useState(false);
  const [optimizeErr, setOptimizeErr] = useState<string | null>(null);
  const [redeemInput, setRedeemInput] = useState("");
  const [redeemBusy, setRedeemBusy] = useState(false);
  const [redeemMsg, setRedeemMsg] = useState<string | null>(null);
  // 「我的作品」文案：字典缺省时回落内置中文（其余语言不必同步维护）
  const worksI18n = a.works ?? DEFAULT_WORKS_I18N;  const countdown = useCountdown();
  const [prompt, setPrompt] = useState("");
  const [refImg, setRefImg] = useState<string | null>(null);
  const [view, setView] = useState<View>("video");

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ---- F2 生成链路：video/image/audio 走 run（SSE 主通道），translate 沿用本地进度 ----
  const {
    running: taskRunning,
    status: taskStatus,
    progress: taskProgress,
    results: taskResults,
    error: taskError,
    run,
    reset: resetTask,
  } = useTaskRunner();
  // 模型 / 参数 / 报价（catalog 驱动，与 ToolComposer 同模式）
  const [models, setModels] = useState<CatalogModel[]>([]);
  const [modelId, setModelId] = useState<string | null>(null);
  const [modelDetail, setModelDetail] = useState<ModelDetail | null>(null);
  const [resolution, setResolution] = useState("");
  const [duration, setDuration] = useState("");
  const [ratio, setRatio] = useState("");
  // 图片模型专有维度：size（如 1024x1024）与 quality（auto/high/…）。
  // GPT Image 2 用 size 选尺寸、GPT Image 2.5 用 resolution+size，两者都必须可选可报价。
  const [size, setSize] = useState("");
  const [quality, setQuality] = useState("");
  // 2.5 专有：version（必填，如 flare/sunburst）与 background（透明背景有独立价格行）。
  const [version, setVersion] = useState("");
  const [background, setBackground] = useState("");

  const [quoted, setQuoted] = useState<number | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const [importingRef, setImportingRef] = useState(false);
  const [refErr, setRefErr] = useState<string | null>(null);
  // translate 视图：非生成链路，保留旧本地进度（不走 run、不扣费）
  const [trBusy, setTrBusy] = useState(false);
  const [trProgress, setTrProgress] = useState(0);

  /**
   * 任务列表行「再次生成」：按该任务存的能力/模型/参数原样重跑。
   * （prompt/params 由 TaskListPane 从 detail hydrate 后带过来）
   */
  function rerunFromRow(row: {
    capability: string;
    modelId: string;
    prompt: string;
    params: Record<string, string | number | boolean | string[]>;
  }) {
    if (user === null) {
      setLoginOpen(true);
      return;
    }
    setPrompt(row.prompt);
    void run({
      capability: row.capability,
      modelId: row.modelId,
      prompt: row.prompt,
      params: row.params,
    });
  }

  const isTranslate = view === "translate";
  const baseCapability =
    view === "video" ? "text_to_video" : view === "image" ? "text_to_image" : "text_to_audio";
  // image 视图有参考图 → image_to_image（与契约 capability 映射一致）
  const effectiveCapability = view === "image" && refImg ? "image_to_image" : baseCapability;
  const busy = isTranslate ? trBusy : taskRunning || importingRef;
  const progress = isTranslate ? trProgress : taskProgress;

  /** 生成完成时间戳（→ TaskListPane 的 refreshKey，任务完成即刷新列表） */
  const [resultStamp, setResultStamp] = useState("");

  // viewUrl 签发已移交 TaskListPane（按行缓存、15min 时效、仅新行付费）；
  // 这里只负责在任务出结果时打时间戳触发刷新。
  useEffect(() => {
    if (taskResults.length > 0) {
      setResultStamp(new Date().toLocaleString());
    }
  }, [taskResults]);

  /**
   * 参数标签文案。
   *
   * 目录接口下发的 params 只有 `labelKey`（如 `model.param.resolution`），
   * 而站点字典里没有对应文案，所以这里给一份内置标签（中英按 locale 取）。
   * 注：version / background 无 UI 入口（用目录默认值 flare / opaque），故不在此列出。
   */
  const paramLabels = (() => {
    const zh = locale.startsWith("zh");
    return {
      resolution: zh ? "分辨率" : "Resolution",
      duration: zh ? "时长" : "Duration",
      aspectRatio: zh ? "比例" : "Aspect",
      size: zh ? "尺寸" : "Size",
      quality: zh ? "画质" : "Quality",
    };
  })();

  // ---- F3 计费展示：订阅/积分/签到/未读数（未登录时全部回落 mock 外观） ----
  const { user, plan, credits, checkedInToday, checkin, refresh } = useAuth();
  const [sub, setSub] = useState<SubscriptionData | null>(null);
  const [checkinBusy, setCheckinBusy] = useState(false);
  const [checkinErr, setCheckinErr] = useState<string | null>(null);
  // 字典 AppSection 无 checkin 字段，按任务要求回落双语文案
  const checkinLabel = ui.checkin;
  const pricingHref = base === "/" ? "/pricing" : `${base}/pricing`;
  const planName = sub?.planName ?? a.planName;
  const isPro = sub?.plan === "pro" || plan?.code === "pro";

  // 登录后拉一次订阅（驱动 planName + upgrade 显隐），失败保持字典回落
  useEffect(() => {
    if (!user) {
      setSub(null);
      return;
    }
    let stop = false;
    void billingApi
      .subscription()
      .then((s) => {
        if (!stop) setSub(s);
      })
      .catch(() => {
        if (!stop) setSub(null);
      });
    return () => {
      stop = true;
    };
  }, [user]);


  // 侧栏视图切换（资产视图及未读红点已下线，见 2026-09-24(9)）
  function selectView(id: View) {
    setView(id);
  }

  function doCheckin() {
    if (checkinBusy) return;
    setCheckinBusy(true);
    setCheckinErr(null);
    // checkin() 成功后 auth-context 内已刷新 credits + checkedInToday，侧栏数字自动更新
    void checkin()
      .then(() => setCheckinBusy(false))
      .catch((e: unknown) => {
        setCheckinBusy(false);
        setCheckinErr(
          e instanceof Error
            ? e.message
            : locale === "en"
              ? "Check-in failed"
              : locale === "zh-TW"
                ? "簽到失敗"
                : "签到失败",
        );
      });
  }

  const VALID: View[] = [
    "video", "image", "audio", "canvas", "editor",
    "viral", "avatar", "translate", "works", "explore", "support", "language",
  ];

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const q = params.get("tool");
    if (q) {
      const direct = VALID.find((v) => v === q);
      if (direct) {
        setView(direct);
      } else {
        const alias: Record<string, View> = {
          "ai-video": "video", "ai-image": "image", "ai-audio": "audio",
          "canvas": "canvas", "editor": "editor", "viral": "viral",
          "avatar": "avatar", "translate": "translate",
          "works": "works", "my-works": "works",
          "explore": "explore", "support": "support", "language": "language",
        };
        if (alias[q]) setView(alias[q]);
      }
    }
    // Read prompt and img from URL (from prompt library)
    const p = params.get("prompt");
    const img = params.get("img");
    if (p) setPrompt(decodeURIComponent(p));
    if (img) setRefImg(decodeURIComponent(img));
  }, []);

  // ---- F2：模型列表（按能力拉取，默认选中第一项；仅生成视图） ----
  useEffect(() => {
    if (view !== "video" && view !== "image" && view !== "audio") return;
    let alive = true;
    setModels([]);
    setModelId(null);
    setModelDetail(null);
    catalogApi
      .models(baseCapability)
      .then((list) => {
        if (!alive) return;
        setModels(list);
        if (list.length > 0) setModelId(list[0].id);
      })
      .catch(() => {
        if (alive) setModels([]);
      });
    return () => {
      alive = false;
    };
  }, [baseCapability, view]);

  // ---- F2：选中模型 → 拉 params 定义，默认选中第一项 ----
  useEffect(() => {
    if (!modelId) {
      setModelDetail(null);
      return;
    }
    let alive = true;
    setModelDetail(null);
    catalogApi
      .model(modelId)
      .then((d) => {
        if (!alive) return;
        setModelDetail(d);
        const fallback = models.find((m) => m.id === modelId);
        const resDef = pickParam(d.params, ["resolution"]);
        const durDef = pickParam(d.params, ["duration", "durationSec"]);
        const ratioDef = pickParam(d.params, ["aspectRatio", "aspect_ratio"]);
        const sizeDef = pickParam(d.params, ["size"]);
        const qualityDef = pickParam(d.params, ["quality"]);
        const versionDef = pickParam(d.params, ["version"]);
        const backgroundDef = pickParam(d.params, ["background"]);
        const resFromDetail = optionStrings(resDef);
        const durFromDetail = optionStrings(durDef);
        const ratioFromDetail = optionStrings(ratioDef);
        const sizeFromDetail = optionStrings(sizeDef);
        const qualityFromDetail = optionStrings(qualityDef);
        // 价格维度默认取首个非 auto 具体值（价格表无 auto 行）；其余沿用目录 default。
        setResolution(pickDefault(resFromDetail.length > 0 ? resFromDetail : (fallback?.resolutions ?? []), resDef, true));
        setDuration(pickDefault(durFromDetail.length > 0 ? durFromDetail : (fallback?.durations ?? []), durDef, true));
        setRatio(pickDefault(ratioFromDetail.length > 0 ? ratioFromDetail : (fallback?.aspectRatios ?? []), ratioDef, false));
        setSize(pickDefault(sizeFromDetail, sizeDef, true));
        setQuality(pickDefault(qualityFromDetail, qualityDef, false));
        setVersion(pickDefault(optionStrings(versionDef), versionDef, false));
        setBackground(pickDefault(optionStrings(backgroundDef), backgroundDef, false));
      })
      .catch(() => {
        if (!alive) return;
        // 详情拉不到时退回列表约束，保证 chip 仍可用。
        const fallback = models.find((m) => m.id === modelId);
        setResolution(pickDefault(fallback?.resolutions ?? [], undefined, true));
        setDuration(pickDefault(fallback?.durations ?? [], undefined, true));
        setRatio(pickDefault(fallback?.aspectRatios ?? [], undefined, false));
        setSize("");
        setQuality("");
        setVersion("");
        setBackground("");
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelId]);

  // ---- F2：每次选择变化 → quote 实时价 ----
  useEffect(() => {
    if (view !== "video" && view !== "image" && view !== "audio") return;
    let alive = true;
    setQuoted(null);

    /**
     * 详情未就绪时**不要报价**。
     *
     * 价格表里没有 `auto` 行（只有 1K/2K/4K 这类具体规格），而列表接口的
     * `resolutions` 首项是 `auto`。详情到达前若用列表默认值发 quote，必然拿到
     * 409 MODEL_UNAVAILABLE —— 表现为页面刚打开时控制台连报几次 409、价格闪一下「–」。
     * 这里等 modelDetail 就绪（届时 pickDefault 已选出具体规格）再报价。
     */
    if (modelId && modelDetail === null) return;

    /**
     * 兜底：分辨率恰好是 `auto` 时不报价。
     *
     * 覆盖两类瞬态 —— (a) 切换 view（如 ?tool=image 生效前先渲染了 video）时
     * 旧参数与新模型短暂不匹配；(b) 模型确实提供 `auto` 档（仅 GPT Image 2.5）。
     * 这些组合在价格表里无对应行，发出去只会拿到 409，不如本地直接跳过。
     *
     * 注意用「恰好等于 auto」而非「为空」：不少模型（GPT Image 2 / Omni Flash 等）
     * 根本没有 resolution 维度，那种情况下不该拦，否则价格永远显示不出来。
     */
    if (resolution === "auto") return;

    const durationSec = parseSeconds(duration);
    const params: Record<string, string | number> = {};
    if (resolution) params.resolution = resolution;
    if (durationSec > 0) params.durationSec = durationSec;
    if (ratio) params.aspectRatio = ratio;
    if (size) params.size = size;
    if (quality) params.quality = quality;
    if (version) params.version = version;
    if (background) params.background = background;
    if (!modelId && models.length > 0) return;
    setQuoting(true);
    billingApi
      .quote({ capability: effectiveCapability, modelId: modelId ?? undefined, params })
      .then((q) => {
        if (alive) setQuoted(q.credits);
      })
      .catch(() => {
        if (alive) setQuoted(null);
      })
      .finally(() => {
        if (alive) setQuoting(false);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, effectiveCapability, modelId, modelDetail, resolution, duration, ratio, size, quality, version, background]);

  // ---- F2：后端报未登录 → 弹登录 ----
  useEffect(() => {
    if (taskError && taskError.code === "UNAUTHORIZED") setLoginOpen(true);
  }, [taskError]);

  // ---- F1 提示词优化（charge-after 扣积分 → refresh 刷余额；失败保留原文） ----
  async function doOptimize(): Promise<void> {
    if (optimizing) return;
    if (user === null) {
      setLoginOpen(true);
      return;
    }
    const src = prompt.trim();
    if (!src) {
      setOptimizeErr(f.needPrompt);
      return;
    }
    setOptimizing(true);
    setOptimizeErr(null);
    try {
      const out = await promptsApi.optimize(src, crypto.randomUUID());
      setPrompt(out.optimized.slice(0, 2000));
      void refresh();
    } catch (e) {
      const code = errCode(e);
      if (code === "UNAUTHORIZED") setLoginOpen(true);
      else setOptimizeErr(f.optimizeFail);
    } finally {
      setOptimizing(false);
    }
  }

  // ---- F3 兑换码（条件更新防双花 → grant promo；NOT_FOUND 单独提示防枚举顾虑由后端承担） ----
  async function doRedeem(): Promise<void> {
    const code = redeemInput.trim();
    if (!code || redeemBusy) return;
    if (user === null) {
      setLoginOpen(true);
      return;
    }
    setRedeemBusy(true);
    setRedeemMsg(null);
    try {
      const out = await promptsApi.redeem(code);
      setRedeemInput("");
      setRedeemMsg(`${f.redeemOk} +${out.credits}`);
      void refresh();
    } catch (e) {
      setRedeemMsg(errCode(e) === "NOT_FOUND" ? f.redeemInvalid : f.redeemFail);
    } finally {
      setRedeemBusy(false);
      window.setTimeout(() => setRedeemMsg(null), 4000);
    }
  }

  // ---- F2：Create 真提交（假进度改为 run） ----
  async function handleCreate() {
    if (busy) return;
    if (!prompt.trim()) return;
    if (user === null) {
      setLoginOpen(true);
      return;
    }
    const durationSec = parseSeconds(duration);
    const params: Record<string, string | number> = {};
    if (resolution) params.resolution = resolution;
    if (durationSec > 0) params.durationSec = durationSec;
    if (ratio) params.aspectRatio = ratio;
    if (size) params.size = size;
    if (quality) params.quality = quality;
    if (version) params.version = version;
    if (background) params.background = background;
    // 深链/模板 refImg 三态：ast_ 直用；**站内相对路径同源 fetch → 直传**（后端 import-url
    // 只收绝对外链，相对路径会 UNFETCHABLE_URL —— 2026-09-24「商品图设计」模板报错根因，
    // 亦覆盖提示词库深链 /api/v1/prompt-library/:id/image）；其余（http 外链）走 import-url。
    let inputAssetIds: string[] | undefined;
    if (view === "image" && refImg) {
      setRefErr(null);
      if (/^ast_/i.test(refImg)) {
        inputAssetIds = [refImg];
      } else {
        setImportingRef(true);
        try {
          let assetId: string;
          if (refImg.startsWith("/")) {
            const res = await fetch(refImg);
            if (!res.ok) throw new Error(ui.refImportFail);
            const blob = await res.blob();
            const name = refImg.split("/").pop() || "reference.png";
            const file = new File([blob], name, { type: blob.type || "image/png" });
            const confirmed = await assetsApi.uploadFile(file);
            assetId = confirmed.asset.id;
          } else {
            const imported = await assetsApi.importUrl({ url: refImg, kind: "upload" });
            assetId = imported.assetId;
          }
          inputAssetIds = [assetId];
        } catch (e) {
          setImportingRef(false);
          setRefErr(e instanceof Error && e.message ? e.message : ui.refImportFail);
          return;
        }
        setImportingRef(false);
      }
    }
    await run({
      capability: effectiveCapability,
      modelId: modelId ?? undefined,
      prompt: prompt.trim(),
      params,
      inputAssetIds,
    });
    // 余额已变（提交即扣），刷新 credits 供 Create 置灰与侧栏使用。
    void refresh();
  }

  // translate 视图：非生成链路，保留旧本地进度（不走 run、不扣费）。
  function createTranslate() {
    if (trBusy) return;
    setTrBusy(true);
    setTrProgress(5);
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setTrProgress((p) => {
        if (p >= 100) {
          if (timerRef.current) clearInterval(timerRef.current);
          setTrBusy(false);
          return 100;
        }
        return Math.min(100, p + 9);
      });
    }, 250);
  }

  const toolDefs: { id: View; label: string; icon: typeof Clapperboard }[] = [
    { id: "video", label: a.tools[0], icon: Clapperboard },
    { id: "image", label: a.tools[1], icon: ImageIcon },
    { id: "audio", label: a.tools[2], icon: Music },
    { id: "canvas", label: a.tools[3], icon: Shapes },
    { id: "editor", label: a.tools[4], icon: Scissors },
  ];
  const studioIcons = [Zap, User, Languages];
  const studioIds: View[] = ["viral", "avatar", "translate"];
  // 个人中心入口「我的作品」排在最前，其余保持原顺序（不破坏既有 1:1 还原）
  const footIcons = [Sparkles, Compass, Headphones, Globe];
  const footLabels = [worksI18n.menu, a.explore, a.support, a.language];
  const footIds: View[] = ["works", "explore", "support", "language"];

  const composerPh =
    view === "audio" ? a.audioPh : view === "image" ? dict.uploadHint : a.composerPh;

  // ---- F2：当前模型的候选项（详情加载后以详情为准，避免列表回退带出过期维度；
  // 音频模型可能无视频参数，对应 chip 行自动隐藏） ----
  const selectedModel = models.find((m) => m.id === modelId);
  const detailLoaded = modelDetail !== null;
  const resOpts = (() => {
    if (!detailLoaded) return selectedModel?.resolutions ?? [];
    return modelDetail ? optionStrings(pickParam(modelDetail.params, ["resolution"])) : [];
  })();
  const durOpts = (() => {
    if (!detailLoaded) return selectedModel?.durations ?? [];
    return modelDetail ? optionStrings(pickParam(modelDetail.params, ["duration", "durationSec"])) : [];
  })();
  const ratioOpts = (() => {
    if (!detailLoaded) return selectedModel?.aspectRatios ?? [];
    return modelDetail ? optionStrings(pickParam(modelDetail.params, ["aspectRatio", "aspect_ratio"])) : [];
  })();
  // 图片专有：size（尺寸）与 quality（画质）。视频模型通常没有 → chip 行自动不显示。
  const sizeOpts = modelDetail ? optionStrings(pickParam(modelDetail.params, ["size"])) : [];
  const qualityOpts = modelDetail ? optionStrings(pickParam(modelDetail.params, ["quality"])) : [];

  /**
   * 参数下拉列表：**只保留当前模型真正支持的维度**。
   *
   * 判定规则：该维度的候选项 ≥ 2 个才展示。
   *  - 只有 1 个候选项 = 无可选余地，展示出来是误导（用户以为能改）；
   *  - 0 个 = 模型不支持该维度。
   * 顺序按「图片场景重要度」排列：比例 → 分辨率 → 尺寸 → 画质 → 时长。
   * （时长排最后：图片视图下通常为空，视频视图下才出现。）
   *
   * 注意：这里只影响**展示**，quote 与提交仍按原逻辑带上全部已选值，
   * 不改动任何价格/契约行为。
   */
  const paramDropdowns = (
    [
      { label: paramLabels.aspectRatio, options: ratioOpts, value: ratio, onPick: setRatio },
      { label: paramLabels.resolution, options: resOpts, value: resolution, onPick: setResolution },
      { label: paramLabels.size, options: sizeOpts, value: size, onPick: setSize },
      { label: paramLabels.quality, options: qualityOpts, value: quality, onPick: setQuality },
      { label: paramLabels.duration, options: durOpts, value: duration, onPick: setDuration },
    ] as const
  ).filter((p) => p.options.length >= 2);
  // 余额不足时 Create 置灰。
  const insufficient = credits !== null && quoted !== null && credits < quoted;

  function sideBtn(
    id: View,
    label: string,
    Icon: typeof Clapperboard,
    badge?: string,
  ) {
    const active = view === id;
    return (
      <button
        key={id}
        type="button"
        onClick={() => selectView(id)}
        className={`flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left text-sm transition-colors ${
          active ? "bg-[#f0eefe] font-semibold text-[#1f11ed]" : "text-black/75 hover:bg-black/5"
        }`}
      >
        <Icon className="size-4 opacity-70" />
        {label}
        {badge && (
          <span className="rounded-full bg-emerald-100 px-1.5 py-px text-[10px] font-bold text-emerald-700">
            {badge}
          </span>
        )}
      </button>
    );
  }

  return (
    <div className="min-h-screen bg-[#f9f9fa] text-black">
      <div className="flex items-center justify-center gap-3 bg-gradient-to-r from-[#f0eefe] via-[#e8e7f9] to-[#f0eefe] px-4 py-2 text-center text-xs font-semibold md:text-sm">
        <span className="text-[#1f11ed]">{a.promo}</span>
        <span className="hidden text-black/60 sm:inline">{a.promoPrice}</span>
        <span className="rounded-md bg-white/70 px-1.5 py-0.5 font-mono text-[11px] tabular-nums">
          {countdown}
        </span>
        <Link
          href={`${base}/app`}
          className="rounded-full bg-[#1f11ed] px-3.5 py-1 text-[11px] font-bold text-white md:text-xs"
        >
          {a.promoCta}
        </Link>
      </div>

      <div className="flex">
        <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col overflow-y-auto border-r border-black/10 bg-white px-4 py-4 lg:flex">
          <Link href={base === "/en" ? "/" : base} className="flex items-center gap-2 px-2">
            <Image src="/sites/vutu/logo.svg" alt="Vutu" width={26} height={26} className="size-6" />
            <span className="text-base font-bold text-[#1f11ed]">Vutu</span>
          </Link>
          <button
            type="button"
            onClick={() => {
              setView("video");
            }}
            className="mt-5 inline-flex items-center justify-center gap-2 rounded-full bg-black px-4 py-2.5 text-sm font-semibold text-white hover:opacity-85"
          >
            <Sparkles className="size-4" />
            {a.agentBtn}
          </button>

          <p className="mt-6 px-2 text-[11px] font-medium text-black/40">{a.toolsHead}</p>
          <nav className="mt-1 space-y-0.5">
            {toolDefs.map((t) => sideBtn(t.id, t.label, t.icon))}
          </nav>

          <p className="mt-5 px-2 text-[11px] font-medium text-black/40">{a.studioHead}</p>
          <nav className="mt-1 space-y-0.5">
            {a.studios.map((s, i) =>
              sideBtn(studioIds[i], s.t, studioIcons[i % studioIcons.length], s.badge),
            )}
          </nav>

          <nav className="mt-5 space-y-0.5 border-t border-black/10 pt-4">
            {footLabels.map((t, i) =>
              sideBtn(footIds[i], t, footIcons[i % footIcons.length]),
            )}
          </nav>

          {/* F3 计费展示：planName 取订阅接口（未登录回落字典），宝石数取 credits，签到仅未签到显示 */}
          <div className="mt-auto rounded-2xl border border-black/10 p-3">
            {/* F5 个人中心入口：点头像进入「我的作品」 */}
            <button
              type="button"
              onClick={() => selectView("works")}
              className="flex w-full items-center gap-2 rounded-lg p-1 text-left hover:bg-black/5"
            >
              <span className="flex size-8 items-center justify-center rounded-full bg-black text-xs font-bold text-white">
                <User className="size-4" />
              </span>
              <div className="text-xs">
                <p className="font-semibold">{planName}</p>
                <p className="inline-flex items-center gap-1 text-black/55">
                  <Gem className="size-3 text-[#1f11ed]" />{credits ?? 0}
                </p>
              </div>
            </button>
            {user && !checkedInToday && (
              <button
                type="button"
                disabled={checkinBusy}
                onClick={doCheckin}
                className="mt-2 w-full rounded-full border border-black/10 py-1.5 text-xs font-bold text-black/70 hover:bg-black/5 disabled:opacity-50"
              >
                {checkinBusy ? "…" : checkinLabel}
              </button>
            )}
            {checkinErr && (
              <p className="mt-1 text-center text-[11px] text-red-500">{checkinErr}</p>
            )}
            {user && (
              <div className="mt-2 flex items-center gap-1.5">
                <input
                  type="text"
                  value={redeemInput}
                  onChange={(e) => setRedeemInput(e.target.value)}
                  placeholder={f.redeemPlaceholder}
                  aria-label={f.redeemLabel}
                  className="min-w-0 flex-1 rounded-lg border border-black/10 bg-black/[0.02] px-2 py-1.5 text-xs outline-none focus:border-[#1f11ed]"
                />
                <button
                  type="button"
                  disabled={redeemBusy || redeemInput.trim().length === 0}
                  onClick={() => void doRedeem()}
                  className="shrink-0 rounded-lg bg-black/5 px-2.5 py-1.5 text-xs font-semibold text-black/70 hover:bg-black/10 disabled:opacity-40"
                >
                  {redeemBusy ? "…" : f.redeemBtn}
                </button>
              </div>
            )}
            {redeemMsg && <p className="mt-1 text-center text-[11px] text-black/55">{redeemMsg}</p>}
            {!isPro && (
              <Link
                href={pricingHref}
                className="mt-2.5 block w-full rounded-full bg-[#1f11ed] py-2 text-center text-xs font-bold text-white hover:opacity-90"
              >
                {a.upgrade}
              </Link>
            )}
          </div>
        </aside>

        <div className="min-w-0 flex-1 px-4 py-6 md:px-10">
          <div className="flex justify-end">
            <Link
              href={base === "/en" ? "/" : base}
              className="inline-flex items-center gap-1 rounded-full border border-black/10 bg-white px-3 py-1.5 text-xs text-black/60 hover:bg-black/5"
            >
              <Undo2 className="size-3.5" />
              {a.backV1}
            </Link>
          </div>

          {(view === "video" || view === "image" || view === "audio") && (
            <>
              {/* Top toolbar */}
              <div className="flex items-center gap-2 border-b border-black/10 pb-3">
                <button
                  type="button"
                  onClick={() => { setPrompt(""); resetTask(); setTrBusy(false); setTrProgress(0); }}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-black/5 px-3 py-1.5 text-xs font-medium text-black/70 hover:bg-black/10"
                >
                  <Plus className="size-3.5" />
                  {ui.newChat}
                </button>
                <button
                  type="button"
                  onClick={() => selectView("works")}
                  className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-black/50 hover:bg-black/5"
                >
                  <Folder className="size-3.5" />
                  {worksI18n.menu}
                </button>
                <button type="button" className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-black/50 hover:bg-black/5">
                  <Shapes className="size-3.5" />
                  {ui.canvas}
                </button>
                <button type="button" className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-black/50 hover:bg-black/5">
                  <Scissors className="size-3.5" />
                  {ui.editor}
                </button>
              </div>

              {/* 创作记录已迁至「我的作品」页面（个人中心），工作台不再重复展示 */}

              {/* 页面标题（左对齐，给两栏布局让位） */}
              <h1 className="mt-5 text-2xl leading-snug font-extrabold md:text-3xl">
                {view === "image" ? dict.imageHero : view === "audio" ? a.tools[2] : a.tools[0]}
              </h1>
              <p className="mt-2 max-w-2xl text-sm text-black/55">
                {view === "image" ? dict.imageLead : a.heroSub}
              </p>

              <div className="mt-5 flex flex-col gap-6 lg:flex-row lg:items-start">
                {/* 左：参数区（提示词 + 模型 + 参数 + 生成） */}
                <div className="w-full lg:w-[25rem] lg:shrink-0">
                <div className="lg:sticky lg:top-4 rounded-3xl border border-black/5 bg-white p-4 shadow-[0_8px_30px_rgba(0,0,0,0.10)] md:p-5">
                  {/* Reference image preview */}
                  {refImg && (
                    <div className="mb-3 flex items-center gap-3 rounded-xl border border-black/10 bg-black/[0.02] p-3">
                      <div className="relative size-16 shrink-0 overflow-hidden rounded-lg">
                        <Image src={refImg} alt={ui.refImg} fill sizes="64px" className="object-cover" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium text-black/70">{ui.refImg}</p>
                        <p className="mt-0.5 truncate text-[11px] text-black/45">{refImg.split("/").pop()}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setRefImg(null)}
                        className="shrink-0 rounded-full bg-black/5 p-1.5 text-black/50 hover:bg-black/10"
                      >
                        <X className="size-3.5" />
                      </button>
                    </div>
                  )}
                  {/* 提示词输入行：上传按钮 + 多行输入。输入区给一个浅底，
                      让「输入框」在视觉上成块，不再是浮在白卡上的裸文字。 */}
                  <div className="flex gap-3 rounded-2xl border border-black/[0.07] bg-black/[0.02] p-2.5 transition-colors focus-within:border-[#1f11ed]/35 focus-within:bg-white">
                    <button
                      type="button"
                      aria-label={ui.uploadRef}
                      title={ui.uploadRef}
                      className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-white text-black/50 shadow-[0_1px_2px_rgba(0,0,0,0.06)] transition-colors hover:text-[#1f11ed]"
                    >
                      <Plus className="size-5" />
                    </button>
                    <textarea
                      value={prompt}
                      onChange={(e) => setPrompt(e.target.value.slice(0, 2000))}
                      rows={2}
                      placeholder={view === "image" ? dict.imageComposerPh : composerPh}
                      className="w-full resize-none bg-transparent py-2 text-sm leading-relaxed outline-none placeholder:text-black/35"
                    />
                  </div>

                  {/* 模型选择：加一行分组标题，避免 chip 悬空不知是什么 */}
                  {models.length > 0 && (
                    <div className="mt-4">
                      <p className="mb-2 text-[11px] font-semibold tracking-wide text-black/40 uppercase">
                        {locale.startsWith("zh") ? "模型" : "Model"}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {models.map((m) => (
                          <button
                            key={m.id}
                            type="button"
                            onClick={() => setModelId(m.id)}
                            aria-pressed={modelId === m.id}
                            className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                              modelId === m.id
                                ? "bg-black text-white"
                                : "bg-black/5 text-black/70 hover:bg-black/10"
                            }`}
                          >
                            {m.displayName}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {/* 参数下拉行：只渲染当前模型**真实支持**的维度。
                      以前无条件渲染 5 个下拉，模型不支持时它们会回落到列表字段或变成
                      只有一个选项的死下拉，既占地方又让人以为可调。现在按 opt 数组是否
                      有值决定显隐；全都没有时整行不出现。 */}
                  {paramDropdowns.length > 0 && (
                    <div className="mt-4">
                      <p className="mb-2 text-[11px] font-semibold tracking-wide text-black/40 uppercase">
                        {locale.startsWith("zh") ? "参数" : "Settings"}
                      </p>
                      <div className="flex flex-wrap items-center gap-2">
                        {paramDropdowns.map((p) => (
                          <ParamDropdown
                            key={p.label}
                            label={p.label}
                            value={p.value}
                            options={p.options}
                            onPick={p.onPick}
                          />
                        ))}
                      </div>
                    </div>
                  )}

                  {/* 底部操作行：费用靠左、主 CTA 靠右，中间用分隔线收口 */}
                  <div className="mt-4 flex items-center gap-2 border-t border-black/[0.07] pt-3.5">
                    <button
                      type="button"
                      aria-label="@ 提及"
                      title="@ 提及"
                      className="flex size-9 items-center justify-center rounded-full bg-black/5 text-black/60 transition-colors hover:bg-black/10"
                    >
                      <AtSign className="size-4" />
                    </button>
                    {/* F1 提示词优化：charge-after 扣积分 → refresh 刷余额 */}
                    <button
                      type="button"
                      onClick={() => void doOptimize()}
                      disabled={optimizing || busy || !prompt.trim()}
                      className="inline-flex items-center gap-1.5 rounded-full border border-[#1f11ed]/25 bg-[#f0eefe] px-3 py-1.5 text-xs font-semibold text-[#1f11ed] transition-colors hover:bg-[#e7e6fd] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {optimizing && <Loader2 className="size-3.5 animate-spin" />}
                      {optimizing ? f.optimizing : f.optimize}
                    </button>
                    {/* Credits（F2：quote 实时价，无选择时显示所选默认规格价） */}
                    <span
                      className="inline-flex items-center gap-1.5 rounded-full bg-black/5 px-3 py-1.5 text-xs tabular-nums text-black/70"
                      title={locale.startsWith("zh") ? "本次生成预计消耗" : "Estimated cost"}
                    >
                      <Gem className="size-3.5 text-[#1f11ed]" />
                      {quoting ? "…" : quoted !== null ? quoted : "–"}
                    </span>
                    {/* Create button：主色实心（醒目），悬停加深；不可用时转灰 */}
                    <button
                      type="button"
                      onClick={() => void handleCreate()}
                      disabled={busy || !prompt.trim() || insufficient}
                      title={
                        insufficient
                          ? locale.startsWith("zh")
                            ? "积分不足"
                            : "Not enough credits"
                          : !prompt.trim()
                            ? locale.startsWith("zh")
                              ? "请先输入提示词"
                              : "Enter a prompt first"
                            : undefined
                      }
                      className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-[#1f11ed] px-8 py-2.5 text-sm font-semibold text-white shadow-[0_4px_14px_rgba(31,17,237,0.28)] transition-all hover:bg-[#3b2ff5] hover:shadow-[0_6px_20px_rgba(31,17,237,0.42)] active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-black/10 disabled:text-black/35 disabled:shadow-none disabled:hover:bg-black/10"
                    >
                      {busy && <Loader2 className="size-4 animate-spin" />}
                      {busy ? `${progress}%` : "Create"}
                    </button>
                  </div>
                  {optimizeErr && (
                    <p className="mt-2 text-xs text-red-600">{optimizeErr}</p>
                  )}
                  {taskError && (
                    <p className="mt-2 text-xs text-red-600">
                      {taskError.code === "INSUFFICIENT_CREDITS"
                        ? `${taskError.message}（${locale === "en" ? "check in for credits or upgrade" : "可签到领取积分或升级套餐"}）`
                        : taskError.message}
                    </p>
                  )}
                  {refErr && (
                    <p className="mt-2 text-xs text-red-600">{refErr}</p>
                  )}
                </div>
                </div>

                {/* 右：任务列表（对齐 nova 参考图：72px 小方图任务卡 + 筛选 + 统计 + 清空） */}
                <div className="min-w-0 flex-1">
                  <TaskListPane
                    locale={locale}
                    view={view === "image" ? "image" : view === "audio" ? "audio" : "video"}
                    busy={busy}
                    progress={progress}
                    taskStatus={isTranslate ? undefined : taskStatus}
                    refreshKey={resultStamp}
                    onEdit={setPrompt}
                    onRerun={rerunFromRow}
                    onPickExample={setPrompt}
                  />
                </div>
              </div>
            </>
          )}

          {view === "canvas" && (
            <div className="mx-auto mt-8 max-w-4xl">
              <p className="text-center text-sm text-black/55">{a.canvasCap}</p>
              <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
                {INSP.map((src) => (
                  <div key={src} className="relative aspect-square overflow-hidden rounded-2xl border border-black/10 bg-black/5">
                    <Image src={src} alt="" fill loading="lazy" sizes="30vw" className="object-cover" />
                  </div>
                ))}
              </div>
            </div>
          )}

          {view === "editor" && (
            <div className="mx-auto mt-8 max-w-4xl rounded-3xl border border-black/10 bg-white p-6">
              <p className="text-sm font-bold">{a.edCap}</p>
              <div className="mt-4 space-y-3">
                {[85, 60, 40].map((w, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <span className="w-16 shrink-0 text-xs text-black/50">
                      {a.edTrack} {i + 1}
                    </span>
                    <div className="h-8 flex-1 overflow-hidden rounded-lg bg-black/5">
                      <div
                        className="h-full rounded-lg bg-gradient-to-r from-[#1f11ed] to-cyan-400"
                        style={{ width: `${w}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {view === "viral" && (
            <div className="mx-auto mt-8 max-w-4xl">
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                {TPL.map((src) => (
                  <div key={src} className="relative aspect-[3/4] overflow-hidden rounded-2xl border border-black/10 bg-black/5">
                    <Image src={src} alt="" fill loading="lazy" sizes="25vw" className="object-cover" />
                  </div>
                ))}
              </div>
            </div>
          )}

          {view === "avatar" && (
            <div className="mx-auto mt-8 flex max-w-md flex-col items-center rounded-3xl border border-black/10 bg-white p-8 text-center">
              <Image
                src={dict.testimonials[3].avatar}
                alt={dict.testimonials[3].name}
                width={136}
                height={136}
                className="size-[68px] rounded-full border-2 border-white object-cover shadow"
              />
              <p className="mt-3 text-lg font-bold">{dict.testimonials[3].name}</p>
              <p className="text-xs text-black/55">{dict.testimonials[3].role}</p>
              <p className="mt-3 text-xs leading-relaxed text-black/60">
                {dict.testimonials[3].quote}
              </p>
            </div>
          )}

          {view === "translate" && (
            <div className="mx-auto mt-8 max-w-md rounded-3xl border border-black/10 bg-white p-6 text-center">
              <p className="flex items-center justify-center gap-2 text-sm font-bold">
                <Languages className="size-4" />
                {a.trTitle}
              </p>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                {LOCALES.map((l) => (
                  <Link
                    key={l.code}
                    href={l.href}
                    className="rounded-full bg-black/5 px-3 py-1.5 text-xs hover:bg-black/10"
                  >
                    {l.label}
                  </Link>
                ))}
              </div>
              <button
                type="button"
                onClick={createTranslate}
                className="mt-4 w-full rounded-full bg-black py-2.5 text-sm font-bold text-white hover:opacity-85"
              >
                {busy ? `${progress}%` : a.trBtn}
              </button>
            </div>
          )}


          {/* F5 个人中心「我的作品」：网格 + 分类/日期筛选 + 批量操作 + 大图预览 */}
          {view === "works" && <WorksGallery i18n={worksI18n} />}

          {view === "explore" && (
            <div className="mx-auto mt-8 grid max-w-4xl grid-cols-2 gap-4 sm:grid-cols-3">
              {INSP.map((src) => (
                <div key={src} className="relative aspect-video overflow-hidden rounded-xl border border-black/10 bg-black/5">
                  <Image src={src} alt="" fill loading="lazy" sizes="30vw" className="object-cover" />
                </div>
              ))}
            </div>
          )}

          {view === "support" && (
            <div className="mx-auto mt-8 max-w-md rounded-3xl border border-black/10 bg-white p-6 text-center">
              <p className="flex items-center justify-center gap-2 text-sm font-bold">
                <Headphones className="size-4" />
                {a.supTitle}
              </p>
              <p className="mt-2 text-xs leading-relaxed text-black/60">{a.supBody}</p>
            </div>
          )}

          {view === "language" && (
            <div className="mx-auto mt-8 max-w-md rounded-3xl border border-black/10 bg-white p-6">
              <p className="flex items-center gap-2 text-sm font-bold">
                <Globe className="size-4" />
                {a.language}
              </p>
              <div className="mt-4 grid grid-cols-2 gap-2">
                {LOCALES.map((l) => (
                  <Link
                    key={l.code}
                    href={l.href}
                    className={`rounded-xl px-3 py-2.5 text-center text-sm hover:bg-black/5 ${
                      l.code === locale ? "bg-[#f0eefe] font-semibold text-[#1f11ed]" : "bg-black/[0.03]"
                    }`}
                  >
                    {l.label}
                  </Link>
                ))}
              </div>
            </div>
          )}

          <h2 className="mx-auto mt-12 max-w-6xl text-lg font-extrabold">
            {a.inspTitle}
          </h2>
          <div className="mx-auto mt-4 grid max-w-6xl grid-cols-2 gap-4 pb-10 sm:grid-cols-3 xl:grid-cols-5">
            {INSP.map((src) => (
              <div
                key={src}
                className="relative aspect-[3/4] overflow-hidden rounded-2xl border border-black/10 bg-black/5"
              >
                <Image
                  src={src}
                  alt=""
                  fill
                  loading="lazy"
                  sizes="(max-width: 640px) 50vw, 20vw"
                  className="object-cover"
                />
              </div>
            ))}
          </div>
        </div>
      </div>
      <AuthDialog
        locale={locale}
        open={loginOpen}
        onClose={() => setLoginOpen(false)}
        onSuccess={() => setLoginOpen(false)}
      />
    </div>
  );
}

// F3：顶层导出包 AuthProvider（契约第 3 条），不改 11 个 locale 的 page.tsx
export function AppHomePage(props: Props) {
  return (
    <AuthProvider>
      <AppHomePageInner {...props} />
    </AuthProvider>
  );
}
