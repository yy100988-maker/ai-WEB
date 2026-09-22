"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { Check, ChevronDown, Gem, Globe, LogOut, Menu, User, X } from "lucide-react";
import type { Locale } from "./site-data";
import { LOCALES, siteContent } from "./site-data";
import { AuthProvider, useAuth } from "@/lib/api/auth-context";
import { AuthDialog } from "./AuthDialog";

interface SiteHeaderProps {
  locale: Locale;
  base: string;
}

// 契约第 3 条：顶层 inner 包一层 AuthProvider，不改 locale page.tsx。
export function SiteHeader({ locale, base }: SiteHeaderProps) {
  return (
    <AuthProvider>
      <SiteHeaderInner locale={locale} base={base} />
    </AuthProvider>
  );
}

function SiteHeaderInner({ locale, base }: SiteHeaderProps) {
  const dict = siteContent[locale];
  const [open, setOpen] = useState(false);
  const [langOpen, setLangOpen] = useState(false);
  const [megaOpen, setMegaOpen] = useState<number | null>(null);
  // 登录弹窗开关；未登录点用户图标弹出，登录成功后关闭即可（context 内已 refresh）。
  const [authOpen, setAuthOpen] = useState(false);
  const { user, credits, logout } = useAuth();
  const currentLang = LOCALES.find((l) => l.code === locale) ?? LOCALES[0];
  // 登录后头像显示 displayName 首字，未登录显示默认图标。
  const initial = user?.displayName?.trim().charAt(0) || user?.email?.trim().charAt(0);

  function pickLocale(code: string) {
    // 原有逻辑：点击切换语言时写 cookie（事件处理器内赋值是正确做法，
    // 不能搬进 effect；react-hooks/immutability 误报，此处定点豁免）。
    // eslint-disable-next-line react-hooks/immutability
    document.cookie = `vutu-locale=${code}; path=/; max-age=31536000`;
    setLangOpen(false);
    setOpen(false);
  }
  const otherBase = locale === "zh-TW" ? "/" : "/zh-TW";
  const otherLabel = locale === "zh-TW" ? "EN" : "繁中";
  const appHref = base === "/" ? "/en/app" : `${base}/app`;
  // 注：原脚手架定义的 t2v/i2v/pricing/navMenus 在渲染中无任何引用（死代码），
  // 为通过 lint 已删除；如未来 mega 菜单需要直达链接，按需从 base 拼。

  type MegaCol = { head: string; items: { t: string; d: string }[] };

  // Temporarily hidden Resource-menu entries (CLI & MCP, contact support).
  const HIDDEN_RESOURCE = /cli|mcp|support|soporte|supporto|suporte|サポート|지원|поддерж|客服|联系|聯絡|contact/i;

  function visibleItems(menuIndex: number, items: { t: string; d: string }[]) {
    if (menuIndex !== 1) return items;
    return items.filter((it) => !HIDDEN_RESOURCE.test(it.t));
  }

  function megaFor(i: number): MegaCol[] | null {
    if (i === 0) return dict.mega as MegaCol[];
    if (i >= 1 && i <= 4) {
      const menus = dict.menus2 as MegaCol[][];
      return menus[i - 1] ?? null;
    }
    return null;
  }

  function hrefFor(menuIndex: number, colIndex: number, title: string) {
    // Menu 1: Resources — Prompt Library → home anchor
    if (menuIndex === 1 && /prompt|提示|プロンプト|프롬프트|biblioth/i.test(title)) {
      return `${base === "/" ? "" : base}/#prompt-library`;
    }
    // Menu 2: Use Cases — Grow Your Channel → dedicated page
    if (menuIndex === 2) {
      if (/channel|頻道|频道|チャンネル|채널|canal|Kanal|канал/i.test(title)) {
        return `${base === "/" ? "" : base}/grow-your-channel`;
      }
      return appHref;
    }
    // Menu 3: Guide — Viral Studio → dedicated page
    if (menuIndex === 3) {
      if (/viral|爆款|バズ|스튜디오|studio/i.test(title)) {
        return `${base === "/" ? "" : base}/guide/viral-studio`;
      }
      return appHref;
    }
    // Menu 0: Create — route by item title to matching app tool view
    if (menuIndex === 0) {
      const t = title.toLowerCase();
      if (/agent|創作|创作|エージェント|에이전트/i.test(t)) return `${base === "/" ? "" : base}/app`;
      if (/canvas|画布|畫布|キャンバス|캔버스/i.test(t)) return `${appHref}?tool=canvas`;
      if (/editor|编辑|編輯|エディタ|편집/i.test(t)) return `${appHref}?tool=editor`;
      if (/template|模板|模板|テンプレ|템플릿|脚本|腳本|scripts/i.test(t)) return `${appHref}?tool=explore`;
      if (/avatar|虛擬人|虚拟人|アバター|아바타/i.test(t)) return `${appHref}?tool=avatar`;
      if (/translate|翻譯|翻译|翻訳|번역/i.test(t)) return `${appHref}?tool=translate`;
      if (/viral|爆款|バズ|스튜디오|drama|短劇|短剧|ドラマ/i.test(t)) return `${appHref}?tool=viral`;
      if (/music|音樂|音乐|音楽|음악|sfx/i.test(t)) return `${appHref}?tool=audio`;
      if (/speech|語音|语音|音声|음성|tts/i.test(t)) return `${appHref}?tool=audio`;
      if (/image|圖片|图片|画像|이미지|.background|upscal|移除|升級|升级|remov/i.test(t)) return `${appHref}?tool=image`;
      // Default: AI Video tools (影片/视频/動画/영상/video)
      return `${appHref}?tool=video`;
    }
    // Menu 4: Pricing
    if (menuIndex === 4) return `${base === "/" ? "/en/app" : base}/pricing`;
    return appHref;
  }
  return (
    <header className="sticky top-0 z-40 bg-white/70 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-[1420px] items-center gap-4 px-5 md:px-6">
        <Link href={base} className="flex items-center gap-2">
          <Image
            src="/sites/vutu/logo.svg"
            alt="Vutu"
            width={28}
            height={28}
            className="size-7 rounded-md"
          />
          <span className="text-base font-bold tracking-tight text-[#1f11ed]">
            Vutu
          </span>
        </Link>
        <nav className="mx-auto hidden items-center gap-1 min-[900px]:flex">
          {dict.nav.map((item, i) => {
            const open = megaOpen === i;
            return (
              <div key={item.label} className="relative flex items-center">
                <button
                  type="button"
                  aria-expanded={open}
                  onClick={() => setMegaOpen(open ? null : i)}
                  onMouseEnter={() => setMegaOpen(i)}
                  className={`inline-flex items-center gap-1 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                    open ? "bg-black/5 text-black" : "text-black/75 hover:text-black"
                  }`}
                >
                  {item.label}
                  <ChevronDown
                    className={`size-3.5 transition-transform ${open ? "rotate-180" : ""}`}
                  />
                </button>
              </div>
            );
          })}
        </nav>
        <div className="ml-auto flex items-center gap-1.5 min-[900px]:ml-0">
          <div className="relative">
            <button
              type="button"
              aria-label="Language"
              aria-expanded={langOpen}
              onClick={() => setLangOpen((v) => !v)}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-black/60 hover:text-black"
            >
              <Globe className="size-4" />
              <span className="hidden sm:inline">{currentLang.label}</span>
              <ChevronDown className="size-3 opacity-60" />
            </button>
            {langOpen && (
              <div className="absolute right-0 z-50 mt-2 w-44 overflow-hidden rounded-2xl border border-black/10 bg-white py-1.5 shadow-xl">
                {LOCALES.map((l) => (
                  <Link
                    key={l.code}
                    href={l.href}
                    onClick={() => pickLocale(l.code)}
                    className="flex items-center justify-between px-4 py-2 text-sm text-black/75 hover:bg-black/5"
                  >
                    {l.label}
                    {l.code === locale && <Check className="size-4" />}
                  </Link>
                ))}
              </div>
            )}
          </div>
          <Link
            href={appHref}
            className="hidden items-center gap-1.5 rounded-full bg-white px-4 py-2 text-xs font-semibold text-black shadow-md min-[900px]:inline-flex"
          >
            <Gem className="size-3.5 text-[#1f11ed]" />
            {credits ?? 0}<span className="text-black/30">|</span>
            {dict.app.trial}
          </Link>
          {user ? (
            <Link
              href={appHref}
              aria-label={locale === "zh-TW" ? "帳戶" : "Account"}
              className="hidden size-9 items-center justify-center rounded-full bg-[#1f11ed] text-xs font-bold text-white min-[900px]:inline-flex"
            >
              {initial ?? <User className="size-4" />}
            </Link>
          ) : (
            <button
              type="button"
              aria-label={locale === "zh-TW" ? "帳戶" : "Account"}
              onClick={() => setAuthOpen(true)}
              className="hidden size-9 items-center justify-center rounded-full bg-[#1f11ed] text-xs font-bold text-white min-[900px]:inline-flex"
            >
              <User className="size-4" />
            </button>
          )}
          {user && (
            <button
              type="button"
              title={locale === "zh-TW" ? "登出" : "Logout"}
              aria-label={locale === "zh-TW" ? "登出" : "Logout"}
              onClick={() => void logout()}
              className="hidden size-9 items-center justify-center rounded-full text-black/60 hover:bg-black/5 min-[900px]:inline-flex"
            >
              <LogOut className="size-4" />
            </button>
          )}
          <button
            type="button"
            aria-label={locale === "zh-TW" ? "選單" : "Menu"}
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
            className="flex size-9 items-center justify-center rounded-full text-black hover:bg-black/5 min-[900px]:hidden"
          >
            {open ? <X className="size-4" /> : <Menu className="size-4" />}
          </button>
        </div>
      </div>
      {megaOpen !== null && megaFor(megaOpen) && (
        <>
          <div
            aria-hidden
            onClick={() => setMegaOpen(null)}
            className="fixed inset-0 top-16 z-30 bg-black/20 backdrop-blur-[2px]"
          />
          <div className="absolute inset-x-0 top-full z-40 hidden justify-center px-6 pt-2 min-[900px]:flex">
            <div className="w-full max-w-[1420px] rounded-3xl border border-black/10 bg-white p-8 shadow-2xl">
              <div
                className={`grid gap-8 ${
                  megaFor(megaOpen)!.length >= 5 ? "grid-cols-5" : "grid-cols-3"
                }`}
              >
                {megaFor(megaOpen)!.map((col, ci) => (
                  <div key={col.head}>
                    <p className="mb-3 text-xs font-medium text-black/40">{col.head}</p>
                    <div className="space-y-3">
                      {visibleItems(megaOpen, col.items).map((it) => (
                        <Link
                          key={it.t}
                          href={hrefFor(megaOpen, ci, it.t)}
                          onClick={() => setMegaOpen(null)}
                          className="block rounded-lg p-1 transition-colors hover:bg-black/5"
                        >
                          <p className="text-sm font-semibold text-black">{it.t}</p>
                          <p className="mt-0.5 text-xs leading-relaxed text-black/45">{it.d}</p>
                        </Link>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
      {open && (
        <nav className="border-t border-black/10 bg-white px-5 py-3 min-[900px]:hidden">
          {dict.nav.map((item) => (
            <Link
              key={item.label}
              href={item.href}
              onClick={() => setOpen(false)}
              className="block rounded-lg px-2 py-2.5 text-sm font-medium text-black/80 hover:bg-black/5"
            >
              {item.label}
            </Link>
          ))}
          <Link
            href={otherBase}
            onClick={() => pickLocale(otherBase === "/" ? "en" : "zh-TW")}
            className="mt-1 flex items-center gap-2 rounded-lg bg-black/5 px-2 py-2.5 text-sm font-semibold"
          >
            <Globe className="size-4" />
            {locale === "zh-TW" ? "切換到 English" : "Switch to 繁中"}
            ({otherLabel})
          </Link>
        </nav>
      )}
      <AuthDialog locale={locale} open={authOpen} onClose={() => setAuthOpen(false)} onSuccess={() => setAuthOpen(false)} />
    </header>
  );
}
