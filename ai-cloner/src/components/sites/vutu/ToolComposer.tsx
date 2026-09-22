"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Settings2, Wand2 } from "lucide-react";
import type { Locale } from "./site-data";
import { siteContent } from "./site-data";
import { AuthProvider, useAuth } from "@/lib/api/auth-context";
import { useTaskRunner } from "@/lib/api/use-task-runner";
import { assetsApi, billingApi, catalogApi } from "@/lib/api/resources";
import type { CatalogModel, ModelDetail, ModelParamOption } from "@/lib/api/types";
import { AuthDialog } from "./AuthDialog";

interface ToolComposerProps {
  mode: "text" | "image";
  locale: Locale;
}

// 从模型 params 定义中取某键的候选项（兼容 resolution/duration/durationSec/aspectRatio/aspect_ratio 等键名）。
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

// chip 标签（如 "10s" / "10秒" / dict.dur10）解析出秒数。
function parseSeconds(label: string): number {
  const m = label.match(/(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
}

function ToolComposerInner({ mode, locale }: ToolComposerProps) {
  const dict = siteContent[locale];
  const { user } = useAuth();
  const { running, status, progress, results, error, run } = useTaskRunner();

  // 基础能力：文生视频 / 文生图（有上传图时提交改用 image_to_image）。
  const baseCapability = mode === "text" ? "text_to_video" : "text_to_image";
  const [prompt, setPrompt] = useState("");
  const [models, setModels] = useState<CatalogModel[]>([]);
  const [modelId, setModelId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ModelDetail | null>(null);
  const [resolution, setResolution] = useState("");
  const [duration, setDuration] = useState("");
  const [ratio, setRatio] = useState("");
  // 图片模型专有维度（目录驱动，无则自动隐藏）：size/quality/version/background。
  const [size, setSize] = useState("");
  const [quality, setQuality] = useState("");
  const [version, setVersion] = useState("");
  const [background, setBackground] = useState("");
  const [quoted, setQuoted] = useState<number | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const busy = running || uploading;
  const done = status === "succeeded";
  const effectiveCapability = mode === "image" && file ? "image_to_image" : baseCapability;
  const resultUrl = results[0]?.url ?? null;
  const resultIsVideo = (results[0]?.mimeType ?? "").startsWith("video/") || mode === "text";

  // 模型列表：按能力拉取，默认选中第一项。
  useEffect(() => {
    let alive = true;
    setModels([]);
    setModelId(null);
    setDetail(null);
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
  }, [baseCapability]);

  // 选中模型 → 拉 params 定义，默认选中第一项。
  useEffect(() => {
    if (!modelId) {
      setDetail(null);
      return;
    }
    let alive = true;
    setDetail(null);
    catalogApi
      .model(modelId)
      .then((d) => {
        if (!alive) return;
        setDetail(d);
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
        const resOpts = resFromDetail.length > 0 ? resFromDetail : (fallback?.resolutions ?? []);
        const durOpts = durFromDetail.length > 0 ? durFromDetail : (fallback?.durations ?? []);
        const ratioOpts = ratioFromDetail.length > 0 ? ratioFromDetail : (fallback?.aspectRatios ?? []);
        setResolution(pickDefault(resOpts, resDef, true));
        setDuration(pickDefault(durOpts, durDef, true));
        setRatio(pickDefault(ratioOpts, ratioDef, false));
        setSize(pickDefault(optionStrings(sizeDef), sizeDef, true));
        setQuality(pickDefault(optionStrings(qualityDef), qualityDef, false));
        setVersion(pickDefault(optionStrings(versionDef), versionDef, false));
        setBackground(pickDefault(optionStrings(backgroundDef), backgroundDef, false));
      })
      .catch(() => {
        if (!alive) return;
        // 详情拉不到时退回列表里的约束，保证 chip 仍可用。
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

  // 每次选择变化 → 实时报价。
  useEffect(() => {
    let alive = true;
    setQuoted(null);
    const durationSec = parseSeconds(duration);
    const params: Record<string, string | number> = {};
    if (resolution) params.resolution = resolution;
    if (durationSec > 0) params.durationSec = durationSec;
    if (ratio) params.aspectRatio = ratio;
    if (size) params.size = size;
    if (quality) params.quality = quality;
    if (version) params.version = version;
    if (background) params.background = background;
    // 无模型时不 quote（等列表加载）；无参数时仍可按裸能力报价。
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
  }, [effectiveCapability, modelId, resolution, duration, ratio, size, quality, version, background]);

  // 后端报未登录 → 弹登录。
  useEffect(() => {
    if (error && error.code === "UNAUTHORIZED") setLoginOpen(true);
  }, [error]);

  // 当前模型的候选项（详情加载后以详情为准，避免列表回退带出过期维度）。
  const fallback = models.find((m) => m.id === modelId);
  const detailLoaded = detail !== null;
  const resOpts = (() => {
    if (!detailLoaded) return fallback?.resolutions ?? [];
    return detail ? optionStrings(pickParam(detail.params, ["resolution"])) : [];
  })();
  const durOpts = (() => {
    if (!detailLoaded) return fallback?.durations ?? [];
    return detail ? optionStrings(pickParam(detail.params, ["duration", "durationSec"])) : [];
  })();
  const ratioOpts = (() => {
    if (!detailLoaded) return fallback?.aspectRatios ?? [];
    return detail ? optionStrings(pickParam(detail.params, ["aspectRatio", "aspect_ratio"])) : [];
  })();
  // 图片专有维度（目录驱动，无则自动隐藏）。
  const sizeOpts = detail ? optionStrings(pickParam(detail.params, ["size"])) : [];
  const qualityOpts = detail ? optionStrings(pickParam(detail.params, ["quality"])) : [];
  const versionOpts = detail ? optionStrings(pickParam(detail.params, ["version"])) : [];
  const backgroundOpts = detail ? optionStrings(pickParam(detail.params, ["background"])) : [];

  async function generate() {
    if (busy) return;
    if (user === null) {
      setLoginOpen(true);
      return;
    }
    if (!prompt.trim()) return;
    const durationSec = parseSeconds(duration);
    const params: Record<string, string | number> = {};
    if (resolution) params.resolution = resolution;
    if (durationSec > 0) params.durationSec = durationSec;
    if (ratio) params.aspectRatio = ratio;
    if (size) params.size = size;
    if (quality) params.quality = quality;
    if (version) params.version = version;
    if (background) params.background = background;
    // image 模式有上传图 → image_to_image，先直传拿 assetId。
    let inputAssetIds: string[] | undefined;
    if (mode === "image" && file) {
      setUploading(true);
      try {
        const confirmed = await assetsApi.uploadFile(file);
        inputAssetIds = [confirmed.asset.id];
      } catch {
        setUploading(false);
        return;
      }
      setUploading(false);
    }
    await run({
      capability: effectiveCapability,
      modelId: modelId ?? undefined,
      prompt: prompt.trim(),
      params,
      inputAssetIds,
    });
  }

  function Chip({
    active,
    label,
    onClick,
  }: {
    active: boolean;
    label: string;
    onClick: () => void;
  }) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
          active
            ? "bg-black text-white"
            : "bg-black/5 text-black/70 hover:bg-black/10"
        }`}
      >
        {label}
      </button>
    );
  }

  return (
    <div className="rounded-2xl border border-black/10 bg-white p-5 shadow-sm">
      {mode === "image" && (
        <label className="mb-4 flex h-32 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-black/15 bg-black/[0.02] text-sm text-black/50 hover:border-[#1f11ed]">
          <Wand2 className="size-5" />
          {file ? file.name : dict.uploadHint}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </label>
      )}
      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value.slice(0, 2000))}
        rows={5}
        placeholder={dict.composerShort}
        className="w-full resize-none rounded-xl border border-black/10 bg-black/[0.02] p-3 text-sm outline-none focus:border-[#1f11ed]"
      />
      <div className="mt-2 flex items-center justify-between text-[11px] text-black/45">
        <span className="inline-flex items-center gap-1">
          <Settings2 className="size-3.5" />
          {dict.paramsNote}
        </span>
        <span>{prompt.length}/2000</span>
      </div>
      {/* 模型 chip 行（顶部新增，样式复用 Chip） */}
      {models.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {models.map((m) => (
            <Chip
              key={m.id}
              label={m.displayName}
              active={modelId === m.id}
              onClick={() => setModelId(m.id)}
            />
          ))}
        </div>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {resOpts.map((q) => (
          <Chip key={q} label={q} active={resolution === q} onClick={() => setResolution(q)} />
        ))}
        {(resOpts.length > 0 && (durOpts.length > 0 || ratioOpts.length > 0)) && (
          <span className="mx-1 text-black/20">|</span>
        )}
        {durOpts.map((d) => (
          <Chip key={d} label={d} active={duration === d} onClick={() => setDuration(d)} />
        ))}
        {(durOpts.length > 0 && ratioOpts.length > 0) && (
          <span className="mx-1 text-black/20">|</span>
        )}
        {ratioOpts.map((r) => (
          <Chip key={r} label={r} active={ratio === r} onClick={() => setRatio(r)} />
        ))}
      </div>
      {/* 图片专有维度 chip 行（目录驱动，无则自动隐藏） */}
      {(sizeOpts.length > 0 || qualityOpts.length > 0 || versionOpts.length > 0 || backgroundOpts.length > 0) && (
        <div className="mt-3 flex flex-wrap gap-2">
          {sizeOpts.map((s) => (
            <Chip key={s} label={s} active={size === s} onClick={() => setSize(s)} />
          ))}
          {(sizeOpts.length > 0 && qualityOpts.length > 0) && (
            <span className="mx-1 text-black/20">|</span>
          )}
          {qualityOpts.map((q) => (
            <Chip key={q} label={q} active={quality === q} onClick={() => setQuality(q)} />
          ))}
          {(qualityOpts.length > 0 && versionOpts.length > 0) && (
            <span className="mx-1 text-black/20">|</span>
          )}
          {versionOpts.map((v) => (
            <Chip key={v} label={v} active={version === v} onClick={() => setVersion(v)} />
          ))}
          {(versionOpts.length > 0 && backgroundOpts.length > 0) && (
            <span className="mx-1 text-black/20">|</span>
          )}
          {backgroundOpts.map((b) => (
            <Chip key={b} label={b} active={background === b} onClick={() => setBackground(b)} />
          ))}
        </div>
      )}
      {/* 价格显示（按钮上方） */}
      <p className="mt-3 text-right text-xs text-black/55">
        {quoting ? "计价中…" : quoted !== null ? `预估 ${quoted} 积分` : ""}
      </p>
      {busy && progress > 0 && (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-black/10">
          <div
            className="h-full rounded-full bg-[#1f11ed] transition-all"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}
      <button
        type="button"
        onClick={() => void generate()}
        disabled={busy}
        className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-black py-2.5 text-sm font-bold text-white hover:opacity-85 disabled:opacity-60"
      >
        {(running || uploading) && <Loader2 className="size-4 animate-spin" />}
        {busy ? (uploading ? "上传中…" : `${dict.generating} ${progress}%`) : dict.createLocal}
      </button>
      {error && (
        <p className="mt-2 text-xs text-red-600">
          {error.code === "INSUFFICIENT_CREDITS"
            ? `${error.message}（可签到领取积分或升级套餐）`
            : error.message}
        </p>
      )}
      {done && (
        <div className="mt-4 overflow-hidden rounded-xl border border-black/10">
          {resultUrl ? (
            resultIsVideo ? (
              <video
                src={resultUrl}
                controls
                playsInline
                preload="metadata"
                className="block aspect-video w-full bg-black object-cover"
              />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={resultUrl}
                alt=""
                className="block aspect-video w-full bg-black object-cover"
              />
            )
          ) : (
            <div className="flex aspect-video items-center justify-center bg-gradient-to-br from-violet-600 via-fuchsia-500 to-cyan-400 text-white">
              <p className="px-6 text-center text-sm font-semibold">
                {resolution} · {duration} · {ratio} {dict.resultUnit}
              </p>
            </div>
          )}
          <p className="bg-black/[0.02] px-4 py-3 text-xs text-black/55">
            {dict.resultNote}：{prompt.slice(0, 80) || "—"}
          </p>
        </div>
      )}
      <AuthDialog
        locale={locale}
        open={loginOpen}
        onClose={() => setLoginOpen(false)}
        onSuccess={() => setLoginOpen(false)}
      />
    </div>
  );
}

export function ToolComposer({ mode, locale }: ToolComposerProps) {
  return (
    <AuthProvider>
      <ToolComposerInner mode={mode} locale={locale} />
    </AuthProvider>
  );
}
