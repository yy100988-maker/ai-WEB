"use client";
// F3 计费展示的定价页需要 hooks 拉 plans/skus/credit-packs，故本文件为客户端组件

import { useEffect, useState } from "react";
import Link from "next/link";
import { Check } from "lucide-react";
import { SiteHeader } from "./SiteHeader";
import { SiteFooter } from "./SiteFooter";
import { ToolComposer } from "./ToolComposer";
import { CtaBanner, Faq, StepsHow } from "./InfoSections";
import type { Locale } from "./site-data";
import { siteContent } from "./site-data";
// F3：定价数据全部走共享 billingApi，不虚构 checkout（Phase 2 未做）
import { AuthProvider } from "@/lib/api/auth-context";
import { billingApi } from "@/lib/api/resources";
import type { CreditPack, PlanView, SkuModel } from "@/lib/api/types";
import { Testimonials } from "./HomeSections";

interface Props {
  locale: Locale;
  base: string;
}

export function TextToVideoPage({ locale, base }: Props) {
  const dict = siteContent[locale];
  return (
    <>
      <SiteHeader locale={locale} base={base} />
      <main className="bg-[#fafafa] text-black">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-12 lg:grid-cols-[220px_1fr_380px]">
          <ToolSidebar locale={locale} />
          <div>
            <p className="text-xs font-semibold text-[#1f11ed]">{dict.t2vEyebrow}</p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight">{dict.t2vTitle}</h1>
            <p className="mt-3 max-w-xl text-sm leading-relaxed text-black/60">
              {dict.t2vBody}
            </p>
            <div className="mt-8">
              <h2 className="text-lg font-bold">{dict.t2vExtraTitle}</h2>
              <p className="mt-2 text-sm leading-relaxed text-black/60">
                {dict.t2vExtraBody}
              </p>
            </div>
            <div className="mt-4 rounded-2xl border border-black/10 bg-white p-5">
              <h3 className="font-bold">{dict.t2vFastTitle}</h3>
              <p className="mt-1.5 text-sm text-black/60">{dict.t2vFastBody}</p>
            </div>
            {/* 末尾 CTA 横幅前的示例 prompt 卡（对齐源站结构） */}
            <div className="mt-6 rounded-2xl border border-black/10 bg-white p-5">
              <p className="text-xs font-semibold text-black/45">
                {locale === "en" ? "Prompt" : "提示詞"}
              </p>
              <p className="mt-2 text-sm leading-relaxed text-black/70">
                {dict.promptLib.cards[0]?.title
                  ? `${dict.promptLib.cards[0].title} — ${dict.composerShort}`
                  : dict.composerShort}
              </p>
            </div>
          </div>
          <div className="lg:sticky lg:top-20 lg:self-start">
            <ToolComposer mode="text" locale={locale} />
          </div>
        </div>
        <StepsHow locale={locale} />
        <Faq locale={locale} />
        <CtaBanner locale={locale} />
      </main>
      <SiteFooter locale={locale} />
    </>
  );
}

export function ImageToVideoPage({ locale, base }: Props) {
  const dict = siteContent[locale];
  return (
    <>
      <SiteHeader locale={locale} base={base} />
      <main className="bg-[#fafafa] text-black">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-12 lg:grid-cols-[220px_1fr_380px]">
          <ToolSidebar locale={locale} />
          <div>
            <p className="text-xs font-semibold text-[#1f11ed]">{dict.imgEyebrow}</p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight">{dict.imgTitle}</h1>
            <p className="mt-3 max-w-xl text-sm leading-relaxed text-black/60">
              {dict.imgBody}
            </p>
            <div className="mt-8 grid gap-4 sm:grid-cols-3">
              {dict.imgSteps.map((s, i) => (
                <div key={s.t} className="rounded-2xl border border-black/10 bg-white p-5">
                  <p className="text-xs font-bold text-[#1f11ed]">0{i + 1}</p>
                  <p className="mt-1.5 font-bold">{s.t}</p>
                  <p className="mt-1 text-sm text-black/60">{s.b}</p>
                </div>
              ))}
            </div>
          </div>
          <div className="lg:sticky lg:top-20 lg:self-start">
            <ToolComposer mode="image" locale={locale} />
          </div>
        </div>
        <Faq locale={locale} list={dict.homeFaqs} />
        <CtaBanner locale={locale} />
      </main>
      <SiteFooter locale={locale} />
    </>
  );
}

/**
 * 工具页左侧栏（源站有 CREATION TOOLS 导航列，本站此前缺失 —— UI-DIFF P1-10/11）。
 * 数据复用字典 `toolsTitle` + `tools`（每个 locale 已有、href 均为有效页）。
 */
function ToolSidebar({ locale }: { locale: Locale }) {
  const dict = siteContent[locale];
  const appHref = locale === "en" ? "/en/app" : `/${locale}/app`;
  return (
    <aside className="hidden lg:block">
      <div className="sticky top-24 rounded-2xl border border-black/10 bg-white p-4">
        <Link
          href={appHref}
          className="mb-4 flex h-9 w-full items-center justify-center rounded-full bg-black text-xs font-bold text-white hover:opacity-85"
        >
          {dict.app.agentBtn}
        </Link>
        <p className="mb-2 px-1 text-[11px] font-medium text-black/40">
          {dict.toolsTitle}
        </p>
        <nav className="space-y-0.5">
          {(dict.tools ?? []).map((t) => (
            <Link
              key={t.title}
              href={t.href}
              className="flex items-center justify-between rounded-lg px-2 py-1.5 text-[13px] text-black/75 hover:bg-black/5"
            >
              <span>{t.title}</span>
              {t.badge && (
                <span className="rounded-full bg-[#e6e4ff] px-1.5 py-0.5 text-[9px] font-bold text-[#1f11ed]">
                  {t.badge}
                </span>
              )}
            </Link>
          ))}
        </nav>
      </div>
    </aside>
  );
}

// ---------- F3 计费展示：定价页（plans / skus / credit-packs 驱动） ----------

// nameI18n 按 locale 取名，回落链：完整码 → 主语言 → en → code
function pickI18nName(
  names: Record<string, string>,
  locale: Locale,
  fallback: string,
): string {
  return names[locale] ?? names[locale.split("-")[0]] ?? names.en ?? fallback;
}

// sku 规格对象转一行展示文案（如 "resolution: 1080P · durationSec: 10"）
function specText(spec: Record<string, unknown>): string {
  const parts = Object.entries(spec).map(([k, v]) => `${k}: ${String(v)}`);
  return parts.length > 0 ? parts.join(" · ") : "—";
}

// skus 按 capability 分组（保持后端返回顺序）
function groupSkus(list: SkuModel[]): Array<[string, SkuModel[]]> {
  const groups: Array<[string, SkuModel[]]> = [];
  for (const m of list) {
    const g = groups.find(([cap]) => cap === m.capability);
    if (g) g[1].push(m);
    else groups.push([m.capability, [m]]);
  }
  return groups;
}

// 与原 PriceTier 卡片 1:1 的展示模型（hot 高亮与 cta 文案沿用字典同位，保持样式不变）
interface TierView {
  key: string;
  name: string;
  price: string;
  period: string;
  creditsLine: string | null;
  features: string[];
  cta: string;
  hot: boolean;
}

function PricingPageInner({ locale, base }: Props) {
  const dict = siteContent[locale];
  const [plans, setPlans] = useState<PlanView[] | null>(null);
  const [skus, setSkus] = useState<SkuModel[] | null>(null);
  const [packs, setPacks] = useState<CreditPack[] | null>(null);
  // 年付/月付切换（对齐源站结构；年付按 29% off 展示，非数字占位价不折算）
  const [cycle, setCycle] = useState<"yearly" | "monthly">("yearly");
  // Phase 2 未做 checkout：只记录被点的购买项，行内小字提示联系运营（不用 alert）
  const [noticeFor, setNoticeFor] = useState<string | null>(null);
  const contactText =
    locale === "en" ? "Please contact operations to activate" : "请联系运营开通";
  const creditsUnit = locale === "en" ? "credits" : "积分";
  const buyText = locale === "en" ? "Buy" : "购买";

  useEffect(() => {
    let stop = false;
    // 三个接口互相独立：任一失败只隐藏对应分区，不影响其余展示
    void billingApi
      .plans()
      .then((r) => {
        if (!stop) setPlans(r.plans);
      })
      .catch(() => undefined);
    void billingApi
      .skus()
      .then((r) => {
        if (!stop) setSkus(r.skus);
      })
      .catch(() => undefined);
    void billingApi
      .creditPacks()
      .then((r) => {
        if (!stop) setPacks(r.packs);
      })
      .catch(() => undefined);
    return () => {
      stop = true;
    };
  }, []);

  // 三档：API 有数据取前三档，否则回落字典 tiers（保持原 mock 外观）
  const apiTiers = plans && plans.length > 0 ? plans.slice(0, 3) : null;
  const tierViews: TierView[] = apiTiers
    ? apiTiers.map((p, i) => {
        const d = dict.tiers[i];
        return {
          key: p.code,
          name: pickI18nName(p.nameI18n, locale, p.code),
          price: p.listPriceUsd === undefined ? (d?.price ?? "") : `$${p.listPriceUsd}`,
          period: d?.period ?? (locale === "en" ? "/ mo" : "/ 月"),
          creditsLine:
            locale === "en"
              ? `${p.monthlyCredits} credits/mo`
              : `每月 ${p.monthlyCredits} 积分`,
          features: p.features && p.features.length > 0 ? p.features : (d?.features ?? []),
          cta: d?.cta ?? buyText,
          hot: d?.hot ?? i === 1,
        };
      })
    : dict.tiers.map((t) => ({
        key: t.name,
        name: t.name,
        price: t.price,
        period: t.period,
        creditsLine: null,
        features: t.features,
        cta: t.cta,
        hot: t.hot,
      }));

  // 年付折算：$N → $round(N×0.71)（源站 Yearly 29% off）；非数字占位价（NT$XXX 等）原样
  const shownTiers = tierViews.map((t) => {
    if (cycle !== "yearly") return t;
    const m = t.price.match(/^\$(\d+(?:\.\d+)?)$/);
    if (!m) return t;
    const discounted = Math.round(Number(m[1]) * 0.71);
    if (discounted === Number(m[1])) return t;
    return {
      ...t,
      price: `$${discounted}`,
      period: locale === "en" ? "/ mo, billed yearly" : "/ 月（年付）",
    };
  });

  const cycleLabel = (c: "yearly" | "monthly") =>
    c === "yearly"
      ? locale === "en"
        ? "Yearly · 29% off"
        : "年付 · 省 29%"
      : locale === "en"
        ? "Monthly"
        : "月付";

  return (
    <>
      <SiteHeader locale={locale} base={base} />
      <main className="bg-white text-black">
        <div className="mx-auto max-w-6xl px-4 py-14 text-center">
          <p className="text-xs font-semibold text-[#1f11ed]">{dict.priceEyebrow}</p>
          <h1 className="mt-2 text-3xl font-bold">{dict.priceTitle}</h1>
          <p className="mx-auto mt-3 max-w-xl text-sm text-black/60">{dict.priceNote}</p>
          {/* 年付 / 月付切换（对齐源站结构 —— UI-DIFF P1-9） */}
          <div className="mt-6 inline-flex items-center gap-1 rounded-full border border-black/10 bg-black/5 p-1">
            {(["yearly", "monthly"] as const).map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCycle(c)}
                aria-pressed={cycle === c}
                className={`rounded-full px-4 py-1.5 text-xs font-semibold transition-colors ${
                  cycle === c ? "bg-black text-white" : "text-black/60 hover:text-black"
                }`}
              >
                {cycleLabel(c)}
              </button>
            ))}
          </div>
          <div className="mt-8 grid gap-5 text-left md:grid-cols-3">
            {shownTiers.map((t) => (
              <div
                key={t.key}
                className={`relative rounded-2xl border p-6 ${
                  t.hot ? "border-[#1f11ed] shadow-xl" : "border-black/10"
                }`}
              >
                {t.hot && (
                  <span className="absolute -top-3 left-6 rounded-full bg-[#1f11ed] px-2.5 py-0.5 text-[11px] font-bold text-white">
                    HOT
                  </span>
                )}
                <p className="font-bold">{t.name}</p>
                <p className="mt-2 text-3xl font-bold">
                  {t.price}
                  <span className="text-sm font-normal text-black/50">{t.period}</span>
                </p>
                {t.creditsLine && (
                  <p className="mt-1 text-xs text-black/50">{t.creditsLine}</p>
                )}
                <ul className="mt-5 space-y-2.5">
                  {t.features.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-sm text-black/70">
                      <Check className="mt-0.5 size-4 shrink-0 text-emerald-600" />
                      {f}
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  onClick={() => setNoticeFor(`tier:${t.key}`)}
                  className={`mt-6 block w-full cursor-pointer rounded-xl py-2.5 text-center text-sm font-bold ${
                    t.hot ? "bg-black text-white hover:opacity-85" : "bg-black/5 text-black hover:bg-black/10"
                  }`}
                >
                  {t.cta}
                </button>
                {noticeFor === `tier:${t.key}` && (
                  <p className="mt-2 text-center text-[11px] text-black/50">{contactText}</p>
                )}
              </div>
            ))}
          </div>

          {skus && skus.length > 0 && (
            <div className="mx-auto mt-14 max-w-6xl text-left">
              <h2 className="text-center text-xl font-bold">
                {locale === "en" ? "Usage rates by capability" : "按能力查看积分价"}
              </h2>
              <div className="mt-6 grid gap-5 md:grid-cols-2">
                {groupSkus(skus).map(([cap, models]) => (
                  <div key={cap} className="rounded-2xl border border-black/10 p-6">
                    <p className="font-bold">{cap}</p>
                    <ul className="mt-4 space-y-3">
                      {models.map((m) => (
                        <li key={m.modelId}>
                          <p className="text-sm font-semibold">{m.displayName}</p>
                          <ul className="mt-1 space-y-1">
                            {m.specs.map((s, si) => (
                              <li
                                key={`${m.modelId}-${si}`}
                                className="flex items-start justify-between gap-2 text-sm text-black/70"
                              >
                                <span>{specText(s.spec)}</span>
                                <span className="shrink-0 font-semibold">
                                  {s.credits} {creditsUnit}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          )}

          {packs && packs.length > 0 && (
            <div className="mx-auto mt-14 max-w-6xl">
              <h2 className="text-center text-xl font-bold">
                {locale === "en" ? "Credit packs" : "积分包"}
              </h2>
              <p className="mt-2 text-center text-sm text-black/60">
                {locale === "en"
                  ? "One-time purchase, credits never expire."
                  : "一次性购买，积分不过期。"}
              </p>
              <div className="mt-6 grid gap-5 text-left sm:grid-cols-2 md:grid-cols-4">
                {packs.map((p) => {
                  const price =
                    p.priceUsd ??
                    (p.priceUsdCents !== undefined ? p.priceUsdCents / 100 : undefined);
                  return (
                    <div key={p.code} className="rounded-2xl border border-black/10 p-6">
                      <p className="font-bold">{p.code}</p>
                      <p className="mt-2 text-3xl font-bold">
                        {price === undefined ? "—" : `$${price}`}
                      </p>
                      <p className="mt-1 text-xs text-black/50">
                        {p.credits} {creditsUnit}
                      </p>
                      <button
                        type="button"
                        onClick={() => setNoticeFor(`pack:${p.code}`)}
                        className="mt-6 block w-full cursor-pointer rounded-xl bg-black/5 py-2.5 text-center text-sm font-bold text-black hover:bg-black/10"
                      >
                        {buyText}
                      </button>
                      {noticeFor === `pack:${p.code}` && (
                        <p className="mt-2 text-center text-[11px] text-black/50">
                          {contactText}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
        {/* 用户评价（源站定价页有评价区 —— UI-DIFF P1-9；复用字典 4 条） */}
        <Testimonials locale={locale} />
        {/* 定价专属 9 问 FAQ（缺省回退通用 FAQ） */}
        <Faq
          locale={locale}
          list={dict.priceFaqs ?? dict.faqs}
          title={dict.faqTitle}
        />
      </main>
      <SiteFooter locale={locale} />
    </>
  );
}

// 契约第 3 条：PricingPage 自包一层 AuthProvider，不改 locale page.tsx
export function PricingPage(props: Props) {
  return (
    <AuthProvider>
      <PricingPageInner {...props} />
    </AuthProvider>
  );
}
