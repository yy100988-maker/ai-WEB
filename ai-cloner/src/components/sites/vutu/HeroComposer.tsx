"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import { AtSign, ChevronLeft, ChevronRight, Loader2, RotateCcw, Upload } from "lucide-react";
import type { Locale } from "./site-data";
import { siteContent } from "./site-data";
import { AuthProvider, useAuth } from "@/lib/api/auth-context";
import { useTaskRunner } from "@/lib/api/use-task-runner";
import { AuthDialog } from "./AuthDialog";

interface HeroComposerProps {
  locale: Locale;
}

const AVATARS = Array.from({ length: 10 }, (_, i) => {
  const n = String(i + 1).padStart(2, "0");
  return `/sites/vutu/avatars/av-${n}.png`;
});

const SHOWS = [
  {
    src: "/sites/vutu/showcase/show-1.mp4",
    poster: "/sites/vutu/hero/hero-wide-1.jpg",
    label: "展示 1",
  },
  {
    src: "/sites/vutu/showcase/show-2.mp4",
    poster: "/sites/vutu/hero/hero-main.png",
    label: "展示 2",
  },
  {
    src: "/sites/vutu/showcase/show-3.mp4",
    poster: "/sites/vutu/hero/hero-wide-2.jpg",
    label: "展示 3",
  },
];

// 未登录时保持原 mock 外观：按钮可点 → 弹登录，不发任何请求。
function HeroComposerInner({ locale }: HeroComposerProps) {
  const dict = siteContent[locale];
  const { user } = useAuth();
  const { running, status, progress, results, error, run } = useTaskRunner();
  const [prompt, setPrompt] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [show, setShow] = useState(1);
  const [loginOpen, setLoginOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const working = running;
  const done = status === "succeeded";
  // 真实结果视频 URL（若有则渲染 video，否则保留原完成态）。
  const videoUrl = results.find((r) => r.url && r.mimeType.startsWith("video/"))?.url
    ?? results[0]?.url
    ?? null;

  // 后端报未登录（token 过期等）→ 弹登录。渲染期派生，不用 effect
  // （set-state-in-effect 规则禁止 effect 体内同步置位）。
  // authDismissed 避免用户手动关窗后同一错误反复顶开；下一次提交自动恢复可弹。
  const [authDismissed, setAuthDismissed] = useState(false);
  const loginShouldOpen = loginOpen || (error?.code === "UNAUTHORIZED" && !authDismissed);

  function handleCreate() {
    if (working) return;
    if (user === null) {
      setLoginOpen(true);
      return;
    }
    if (!prompt.trim()) return;
    setAuthDismissed(false);
    // 不指定 modelId：由后端 Router 按策略选最优模型。
    void run({ capability: "text_to_video", prompt: prompt.trim() });
  }

  const h1a = dict.h1a;
  const h1b = dict.h1b;

  return (
    <section className="relative overflow-hidden bg-[#f9f9fa] pt-[104px] text-black md:pt-[194px]">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(40%_30%_at_8%_20%,rgba(134,239,172,0.35),transparent_70%),radial-gradient(40%_30%_at_92%_25%,rgba(196,181,253,0.4),transparent_70%),radial-gradient(50%_30%_at_50%_100%,rgba(147,197,253,0.35),transparent_70%)]"
      />
      <div className="relative z-20 mx-auto flex max-w-[1420px] flex-col items-center px-5 md:px-6">
        <div className="w-full max-w-[1300px] text-center">
          <h1 className="mx-auto flex flex-col items-center justify-center gap-0 text-center md:max-w-[1300px]">
            <span className="text-[24px] leading-[normal] font-extrabold text-black md:text-[42px]">
              <span className="block md:inline">{h1a}</span>
              <span
                className="block bg-clip-text text-transparent md:inline"
                style={{
                  backgroundImage:
                    "linear-gradient(90deg, #000 0.11%, #666 33.28%, #000 72%, #7B35FA 100%)",
                }}
              >
                {h1b}
              </span>
            </span>
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-sm text-black/60 md:text-base">
            {dict.heroSubtitle}
          </p>

          <div className="mx-auto mt-8 max-w-3xl rounded-3xl border border-black/5 bg-white p-5 text-left shadow-[0_8px_30px_rgba(0,0,0,0.08)] md:p-6">
            <p className="px-1 text-xs font-semibold text-black/80">
              {dict.composerLabel}
            </p>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value.slice(0, 2000))}
              rows={2}
              placeholder={dict.composerHint}
              aria-label={dict.composerLabel}
              className="mt-1 w-full resize-none rounded-xl bg-transparent px-1 py-2 text-sm text-black outline-none placeholder:text-black/35"
            />
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <input
                ref={fileRef}
                type="file"
                accept="image/*,video/*,audio/*"
                className="hidden"
                onChange={(e) =>
                  setFileName(e.target.files?.[0]?.name ?? null)
                }
              />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="inline-flex items-center gap-1.5 rounded-full bg-black/5 px-4 py-2 text-xs font-medium text-black/75 hover:bg-black/10"
              >
                <Upload className="size-3.5" />
                {fileName ?? dict.composerUpload}
              </button>
              <button
                type="button"
                title={locale === "zh-TW" ? "引用素材" : "Mention assets"}
                className="flex size-9 items-center justify-center rounded-full bg-black/5 text-black/70 hover:bg-black/10"
              >
                <AtSign className="size-4" />
              </button>
              <button
                type="button"
                onClick={handleCreate}
                disabled={working}
                className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-black/40 px-6 py-2.5 text-sm font-semibold text-white hover:bg-black/55 disabled:opacity-70"
              >
                {working && (
                  <Loader2 className="size-4 animate-spin" />
                )}
                {working ? `${progress}%` : dict.composerCreateFree}
              </button>
            </div>
            {(working || done) && (
              <div className="pt-3">
                <div className="h-1.5 overflow-hidden rounded-full bg-black/10">
                  <div
                    className="h-full rounded-full bg-[#1f11ed] transition-all"
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <p className="mt-2 text-[11px] text-black/50">
                  {working ? dict.mockWorking : dict.mockDone}
                </p>
              </div>
            )}
            {error && (
              <p className="mt-2 px-1 text-[11px] text-red-600">
                {error.code === "INSUFFICIENT_CREDITS"
                  ? `${error.message}（可签到领取积分或升级套餐）`
                  : error.message}
              </p>
            )}
            {done && videoUrl && (
              <div className="pt-3">
                <video
                  src={videoUrl}
                  controls
                  playsInline
                  preload="metadata"
                  className="block aspect-video w-full rounded-xl bg-black object-cover"
                />
              </div>
            )}
          </div>

          <div className="relative mx-auto mt-10 w-full max-w-[1300px]">
            <div className="overflow-hidden rounded-3xl border border-black/10 shadow-xl">
              <video
                key={SHOWS[show].src}
                src={SHOWS[show].src}
                poster={SHOWS[show].poster}
                autoPlay
                muted
                loop
                playsInline
                preload="auto"
                aria-label={SHOWS[show].label}
                className="block aspect-video h-auto w-full bg-black object-cover"
              />
            </div>
            <div className="mt-4 flex items-center justify-center gap-3">
              <button
                type="button"
                aria-label="Show previous showcase"
                onClick={() => setShow((s) => (s + SHOWS.length - 1) % SHOWS.length)}
                className="flex size-9 items-center justify-center rounded-full border border-black/10 bg-white text-black/70 hover:bg-black/5"
              >
                <ChevronLeft className="size-4" />
              </button>
              <button
                type="button"
                onClick={() => setShow(1)}
                className="inline-flex items-center gap-1.5 rounded-full border border-black/10 bg-white px-4 py-2 text-xs font-semibold text-black/75 hover:bg-black/5"
              >
                <RotateCcw className="size-3.5" />
                {dict.showcaseRebuild}
              </button>
              <button
                type="button"
                aria-label="Show next showcase"
                onClick={() => setShow((s) => (s + 1) % SHOWS.length)}
                className="flex size-9 items-center justify-center rounded-full border border-black/10 bg-white text-black/70 hover:bg-black/5"
              >
                <ChevronRight className="size-4" />
              </button>
            </div>
          </div>

          <div className="mt-10 flex items-center justify-center gap-1">
            <div className="flex -space-x-2">
              {AVATARS.slice(0, 7).map((src) => (
                <Image
                  key={src}
                  src={src}
                  alt=""
                  width={48}
                  height={48}
                  loading="lazy"
                  className="size-8 rounded-full border-2 border-white object-cover"
                />
              ))}
            </div>
          </div>
          <p className="mt-4 text-xs text-black/50">{dict.trustLine}</p>
          <div className="mx-auto mt-4 grid max-w-3xl grid-cols-3 gap-4">
            {dict.stats.map((s) => (
              <div key={s.label}>
                <p className="text-2xl font-extrabold md:text-3xl">{s.value}</p>
                <p className="mt-1 text-xs text-black/55 md:text-sm">{s.label}</p>
              </div>
            ))}
          </div>
        </div>
        <div className="h-10 md:h-[60px]" />
      </div>
      <AuthDialog
        locale={locale}
        open={loginShouldOpen}
        onClose={() => {
          setLoginOpen(false);
          setAuthDismissed(true);
        }}
        onSuccess={() => {
          setLoginOpen(false);
          setAuthDismissed(false);
        }}
      />
    </section>
  );
}

export function HeroComposer({ locale }: HeroComposerProps) {
  return (
    <AuthProvider>
      <HeroComposerInner locale={locale} />
    </AuthProvider>
  );
}
