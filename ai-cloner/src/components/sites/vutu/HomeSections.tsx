"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { ArrowRight, ChevronLeft, ChevronRight, Copy, Eye, Heart, Star } from "lucide-react";
import type { Locale } from "./site-data";
import { siteContent } from "./site-data";
import { catalogApi, promptsApi } from "@/lib/api/resources";
import type { PromptCard as ServerPromptCard, PromptTab as ServerPromptTab } from "@/lib/api/types";

interface Props {
  locale: Locale;
}

const TEMPLATES = [
  "/sites/vutu/templates/tpl-1.png",
  "/sites/vutu/templates/tpl-2.png",
  "/sites/vutu/templates/tpl-3.jpg",
  "/sites/vutu/templates/tpl-4.png",
  "/sites/vutu/templates/tpl-5.png",
  "/sites/vutu/templates/tpl-6.png",
  "/sites/vutu/templates/tpl-7.png",
  "/sites/vutu/templates/tpl-8.jpg",
];

export function TemplatesSection({ locale }: Props) {
  const dict = siteContent[locale];
  const appHref = locale === "en" ? "/en/app" : `/${locale}/app`;
  return (
    <section className="bg-white py-[40px] text-black md:py-[90px]">
      <div className="mx-auto max-w-[1420px] px-5 md:px-6">
        <div className="mb-[20px] text-center md:mb-[40px]">
          <h2 className="mx-auto max-w-2xl text-[22px] leading-snug font-extrabold md:text-[32px]">
            {dict.templatesTitle}
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-sm text-black/60">
            {dict.templatesBody}
          </p>
          <Link
            href={appHref}
            className="mt-5 inline-flex items-center gap-1.5 rounded-full bg-black px-6 py-2.5 text-sm font-semibold text-white hover:opacity-85"
          >
            {dict.templatesCta}
            <ArrowRight className="size-4" />
          </Link>
        </div>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {TEMPLATES.map((src, i) => (
            <div
              key={src}
              className="relative aspect-[3/4] overflow-hidden rounded-2xl border border-black/10 bg-black/5"
            >
              <Image
                src={src}
                alt={`${locale === "zh-TW" ? "模板" : "Template"} ${i + 1}`}
                fill
                loading="lazy"
                sizes="(max-width: 640px) 50vw, 25vw"
                className="object-cover"
              />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export function PromptLibrary({ locale }: Props) {
  const dict = siteContent[locale];
  const lib = dict.promptLib;
  const [tab, setTab] = useState("all");
  const appHref = locale === "en" ? "/en/app" : `/${locale}/app`;

  // 后端卡片统一形状；server=false 为字典 fallback（mock 外观，不上报）
  interface LibCard {
    id: string;
    title: string;
    img: string;
    cat: string;
    views: string | number;
    likes: string | number;
    server: boolean;
  }
  interface LibTab {
    id: string;
    label: string;
  }

  // i18n 字典按当前 locale 取文案，缺失时回退英文/首个值
  function pickLabel(labelI18n: Record<string, string>, fallback: string): string {
    return labelI18n[locale] ?? labelI18n["en"] ?? Object.values(labelI18n)[0] ?? fallback;
  }

  const fallbackTabs: LibTab[] = lib.tabs.map((t) => ({ id: t.id, label: t.label }));
  const fallbackCards: LibCard[] = lib.cards.map((c) => ({
    id: c.title,
    title: c.title,
    img: c.img,
    cat: c.cat,
    views: c.views,
    likes: c.likes,
    server: false,
  }));

  const [tabs, setTabs] = useState<LibTab[]>(fallbackTabs);
  const [cards, setCards] = useState<LibCard[]>(fallbackCards);
  const [serverOn, setServerOn] = useState(false);
  // like() 返回的实时数字覆盖（按卡片 id）
  const [likeCount, setLikeCount] = useState<Record<string, number>>({});
  const [liked, setLiked] = useState<Record<string, boolean>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);
  // view() 节流：同一卡片 30s 内只报一次
  const lastViewRef = useRef<Record<string, number>>({});

  // tabs/cards 接 promptsApi.library()（locale 不传，后端按 Accept-Language）
  useEffect(() => {
    let alive = true;
    promptsApi
      .library()
      .then((data: { tabs: ServerPromptTab[]; cards: ServerPromptCard[] }) => {
        if (!alive || data.cards.length === 0) return;
        const serverTabs: LibTab[] = data.tabs.map((t) => ({
          id: t.id,
          label: pickLabel(t.labelI18n, t.id),
        }));
        // 后端 tabs 若无 all，补一个（文案取字典）
        if (!serverTabs.some((t) => t.id === "all")) {
          const allLabel = lib.tabs.find((t) => t.id === "all")?.label ?? "全部";
          serverTabs.unshift({ id: "all", label: allLabel });
        }
        setTabs(serverTabs);
        setCards(
          data.cards.map((c) => ({
            id: c.id,
            title: c.title,
            img: c.img,
            cat: c.cat,
            views: c.views,
            likes: c.likes,
            server: true,
          })),
        );
        setServerOn(true);
      })
      .catch(() => {
        // 失败则保留字典 fallback，不抛错
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 服务端 tabs 若不含当前 tab，回退到 all
  useEffect(() => {
    if (serverOn && !tabs.some((t) => t.id === tab)) setTab("all");
  }, [serverOn, tabs, tab]);

  // 卡片曝光上报 view()（30s 节流；失败静默）
  function reportView(card: LibCard): void {
    if (!card.server) return;
    const now = Date.now();
    if (now - (lastViewRef.current[card.id] ?? 0) < 30_000) return;
    lastViewRef.current[card.id] = now;
    promptsApi.view(card.id).catch(() => undefined);
  }

  function flashCopied(id: string): void {
    setCopiedId(id);
    window.setTimeout(() => {
      setCopiedId((cur) => (cur === id ? null : cur));
    }, 1500);
  }

  // 复制按钮：先调 copy() 拿原文（同时上报复制计数），再写剪贴板
  async function handleCopy(card: LibCard): Promise<void> {
    if (!card.server) {
      try {
        await navigator.clipboard.writeText(card.title);
      } catch {
        /* 剪贴板不可用则忽略 */
      }
      flashCopied(card.id);
      return;
    }
    try {
      const r = await promptsApi.copy(card.id);
      await navigator.clipboard.writeText(r.title);
    } catch {
      try {
        await navigator.clipboard.writeText(card.title);
      } catch {
        /* 剪贴板不可用则忽略 */
      }
    }
    flashCopied(card.id);
  }

  // 点赞：调 like() 并用返回的最新数字更新
  async function handleLike(card: LibCard): Promise<void> {
    if (!card.server) return;
    try {
      const r = await promptsApi.like(card.id);
      setLikeCount((prev) => ({ ...prev, [card.id]: r.likes }));
      setLiked((prev) => ({ ...prev, [card.id]: r.liked }));
    } catch {
      /* 点赞失败静默，保持原数字 */
    }
  }

  const visible = cards.filter((c) => tab === "all" || c.cat === tab);
  return (
    <>
      <section className="bg-white px-5 pt-[48px] text-center text-black md:pt-[72px]">
        <div className="mx-auto max-w-4xl">
          <h2 className="text-[30px] leading-tight font-extrabold tracking-tight md:text-[52px]">
            {lib.heroTitleA}
            <span className="text-[#1f11ed]">{lib.heroTitleB}</span>
          </h2>
          <p className="mx-auto mt-4 max-w-3xl text-[14px] leading-relaxed text-black/60 md:text-[17px]">
            {lib.heroBody}
          </p>
          <Link
            href={appHref}
            className="mt-7 inline-flex items-center gap-2 rounded-full bg-[#1f11ed] px-12 py-4 text-[16px] font-bold text-white shadow-[0_12px_32px_-8px_rgba(31,17,237,0.55)] hover:bg-[#1a0ec9]"
          >
            {lib.heroCta}
            <ArrowRight className="size-5" />
          </Link>
          <p className="mt-4 text-[13px] text-black/40">{lib.heroNote}</p>
        </div>
      </section>
      <section id="prompt-library" className="scroll-mt-20 bg-white py-[36px] text-black md:py-[56px]">
        <div className="mx-auto max-w-[1420px] px-5 md:px-6">
          <h2 className="mb-5 text-left text-[24px] font-extrabold tracking-tight md:text-[30px]">
            {lib.sectionTitle}
          </h2>
          <div className="mb-6 flex gap-2 overflow-x-auto pb-1">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                aria-pressed={tab === t.id}
                className={`shrink-0 rounded-full px-4 py-1.5 text-sm font-medium whitespace-nowrap transition-colors ${
                  tab === t.id
                    ? "bg-black text-white"
                    : "bg-black/[0.06] text-black/70 hover:bg-black/10 hover:text-black"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {visible.map((c) => (
              <PromptLibraryCard
                key={c.id}
                card={c}
                badge={lib.badge}
                appHref={appHref}
                likes={likeCount[c.id] ?? null}
                liked={liked[c.id] ?? false}
                copied={copiedId === c.id}
                onVisible={reportView}
                onCopy={(card) => void handleCopy(card)}
                onLike={(card) => void handleLike(card)}
              />
            ))}
          </div>
        </div>
      </section>
    </>
  );
}

interface PromptLibraryCardProps {
  card: {
    id: string;
    title: string;
    img: string;
    cat: string;
    views: string | number;
    likes: string | number;
    server: boolean;
  };
  badge: string;
  appHref: string;
  // like() 返回的实时数字（null = 用卡片自带数字）
  likes: number | null;
  liked: boolean;
  copied: boolean;
  onVisible: (card: {
    id: string;
    title: string;
    img: string;
    cat: string;
    views: string | number;
    likes: string | number;
    server: boolean;
  }) => void;
  onCopy: (card: {
    id: string;
    title: string;
    img: string;
    cat: string;
    views: string | number;
    likes: string | number;
    server: boolean;
  }) => void;
  onLike: (card: {
    id: string;
    title: string;
    img: string;
    cat: string;
    views: string | number;
    likes: string | number;
    server: boolean;
  }) => void;
}

// 提示词卡片：深链跳转逻辑保留（/app?prompt=&img=），只把数据源换成服务端
function PromptLibraryCard({
  card,
  badge,
  appHref,
  likes,
  liked,
  copied,
  onVisible,
  onCopy,
  onLike,
}: PromptLibraryCardProps) {
  const ref = useRef<HTMLAnchorElement | null>(null);
  const promptParam = encodeURIComponent(card.title);
  const imgParam = encodeURIComponent(card.img);
  const cardHref = `${appHref}?prompt=${promptParam}&img=${imgParam}`;

  // 曝光即上报 view()（节流由父组件控制；上报一次后取消观察）
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            onVisible(card);
            io.disconnect();
          }
        }
      },
      { threshold: 0.3 },
    );
    io.observe(el);
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Link
      ref={ref}
      href={cardHref}
      className="group block overflow-hidden rounded-2xl border border-black/10 bg-white transition-shadow hover:shadow-xl"
    >
      <div className="relative aspect-[16/10] overflow-hidden bg-[#e9e9ee]">
        {card.server ? (
          <>
            {/* 服务端图片可能是远端 URL，不走 next/image（免改 remotePatterns） */}
            <img
              src={card.img}
              alt=""
              aria-hidden
              loading="lazy"
              className="absolute inset-0 size-full scale-110 object-cover blur-2xl brightness-[0.97]"
            />
            <img
              src={card.img}
              alt={card.title}
              loading="lazy"
              className="absolute inset-0 size-full object-cover transition-transform duration-300 group-hover:scale-105"
            />
          </>
        ) : (
          <>
            <Image
              src={card.img}
              alt=""
              aria-hidden
              fill
              loading="lazy"
              sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
              className="scale-110 object-cover blur-2xl brightness-[0.97]"
            />
            <Image
              src={card.img}
              alt={card.title}
              fill
              loading="lazy"
              sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
              className="object-cover transition-transform duration-300 group-hover:scale-105"
            />
          </>
        )}
        <span className="absolute top-3 left-3 rounded-full bg-[#e6e4ff] px-2.5 py-1 text-[11px] font-extrabold tracking-wide text-[#1f11ed]">
          {badge}
        </span>
        {/* Hover overlay with copy button */}
        <div className="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition-all duration-300 group-hover:bg-black/30 group-hover:opacity-100">
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onCopy(card);
            }}
            className="inline-flex cursor-pointer items-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-black shadow-lg transition-transform hover:scale-105"
          >
            <Copy className="size-4" />
            {copied ? "已複製" : "複製此 Prompt"}
            <ArrowRight className="size-4" />
          </button>
        </div>
      </div>
      <div className="flex items-start justify-between gap-3 p-4">
        <h3 className="line-clamp-2 min-h-[44px] text-left text-[15px] leading-snug font-bold">
          {card.title}
        </h3>
        <div className="flex shrink-0 items-center gap-3 pt-0.5 text-[13px] font-medium whitespace-nowrap text-black/55">
          <span className="inline-flex items-center gap-1">
            <Eye className="size-4" aria-hidden />
            {card.views}
          </span>
          {card.server ? (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onLike(card);
              }}
              aria-pressed={liked}
              aria-label="Like this prompt"
              className={`inline-flex items-center gap-1 hover:text-black ${
                liked ? "text-[#1f11ed]" : ""
              }`}
            >
              <Heart
                className={`size-4 ${liked ? "fill-[#1f11ed] text-[#1f11ed]" : ""}`}
                aria-hidden
              />
              {likes ?? card.likes}
            </button>
          ) : (
            <span className="inline-flex items-center gap-1">
              <Heart className="size-4" aria-hidden />
              {card.likes}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}

export function Testimonials({ locale }: Props) {
  const dict = siteContent[locale];
  const [idx, setIdx] = useState(0);
  const t = dict.testimonials[idx % dict.testimonials.length];
  return (
    <section className="border-t border-black/5 bg-[#f9f9fa] py-[40px] text-black md:py-[90px]">
      <div className="mx-auto max-w-[1420px] px-5 md:px-6">
        <div className="mb-[20px] text-center md:mb-[40px]">
          <h2 className="text-[22px] font-extrabold md:text-[32px]">
            {dict.testimonialsTitle}
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-sm text-black/60">
            {dict.testimonialsBody}
          </p>
        </div>
        <div className="mx-auto max-w-3xl rounded-3xl border border-black/10 bg-white p-8 shadow-sm md:p-10">
          <div className="flex flex-col items-start gap-5">
            <Image
              src={t.avatar}
              alt={t.name}
              width={136}
              height={136}
              loading="lazy"
              className="size-[68px] rounded-full border-2 border-white object-cover shadow"
            />
            <p className="text-[12px] leading-[18px] text-[#5c5c5c]">
              {t.quote}
            </p>
          </div>
          <div className="mt-6 flex items-end justify-between">
            <div>
              <p className="text-[18px] font-bold text-[#5c5c5c]">{t.name}</p>
              <p className="text-[12px] font-medium text-[#5c5c5c]">{t.role}</p>
              <span className="mt-1 flex gap-0.5" aria-hidden>
                {Array.from({ length: 5 }).map((_, i) => (
                  <Star key={i} className="size-4 fill-amber-400 text-amber-400" />
                ))}
              </span>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                aria-label="Show previous testimonial"
                onClick={() =>
                  setIdx((v) => (v + dict.testimonials.length - 1) % dict.testimonials.length)
                }
                className="flex size-9 items-center justify-center rounded-full border border-black/10 text-black/70 hover:bg-black/5"
              >
                <ChevronLeft className="size-4" />
              </button>
              <button
                type="button"
                aria-label="Show next testimonial"
                onClick={() => setIdx((v) => (v + 1) % dict.testimonials.length)}
                className="flex size-9 items-center justify-center rounded-full border border-black/10 text-black/70 hover:bg-black/5"
              >
                <ChevronRight className="size-4" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export function ModelWall({ locale }: Props) {
  const dict = siteContent[locale];
  // 模型名由 GET /v1/catalog/models 的 displayName 驱动（公开接口，未登录可调）；
  // 加载中/失败时回退字典名单，避免闪空
  const [names, setNames] = useState<string[] | null>(null);
  useEffect(() => {
    let alive = true;
    catalogApi
      .models()
      .then((ms) => {
        if (alive && ms.length > 0) setNames(ms.map((m) => m.displayName));
      })
      .catch(() => {
        /* 失败则保留字典名单 */
      });
    return () => {
      alive = false;
    };
  }, []);
  const list = names ?? dict.models;
  return (
    <section className="bg-white py-[40px] text-black md:py-[90px]">
      <div className="mx-auto max-w-[1420px] px-5 text-center md:px-6">
        <h2 className="mx-auto max-w-2xl text-[22px] leading-snug font-extrabold md:text-[32px]">
          {dict.modelsTitle}
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-sm text-black/60">
          {dict.modelsBody}
        </p>
        <div className="mx-auto mt-8 grid max-w-4xl grid-cols-4 gap-3 sm:grid-cols-7">
          {list.map((m, i) => (
            <div key={`${m}-${i}`} className="flex flex-col items-center gap-2">
              <span className="flex h-[72px] w-[72px] items-center justify-center rounded-[16px] bg-[#f9f9fa] p-5 text-xl font-extrabold text-[#1f11ed] shadow-sm md:h-[88px] md:w-[88px] md:rounded-[20px]">
                {m.slice(0, 1)}
              </span>
              <span className="text-center text-[10px] whitespace-nowrap text-[#434343] md:text-[14px]">
                {m}
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export function HomeFaq({ locale }: Props) {
  const dict = siteContent[locale];
  return (
    <section className="border-t border-black/5 bg-[#fafafa] text-black">
      <div className="mx-auto max-w-4xl px-5 py-16 md:px-6">
        <h2 className="text-center text-[22px] font-extrabold md:text-[32px]">
          {dict.homeFaqTitle}
        </h2>
        <div className="mt-8 divide-y divide-black/10 rounded-2xl border border-black/10 bg-white">
          {dict.homeFaqs.map((f) => (
            <details key={f.q} className="group px-5 py-4">
              <summary className="cursor-pointer list-none text-sm font-semibold group-open:text-[#1f11ed]">
                {f.q}
              </summary>
              <p className="mt-2 text-sm leading-relaxed text-black/60">{f.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

export function CtaFinal({ locale }: Props) {
  const dict = siteContent[locale];
  const appHref = locale === "en" ? "/en/app" : `/${locale}/app`;
  return (
    <section className="bg-white text-black">
      <div className="mx-auto max-w-[1420px] px-5 py-16 text-center md:px-6">
        <h2 className="mx-auto max-w-2xl text-[22px] font-extrabold md:text-[32px]">
          {dict.cta2Title}
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-sm text-black/60">
          {dict.cta2Body}
        </p>
        <Link
          href={appHref}
          className="mt-7 inline-block rounded-full bg-[#1f11ed] px-8 py-3 text-sm font-bold text-white hover:opacity-90"
        >
          {dict.cta2Button}
        </Link>
      </div>
    </section>
  );
}
