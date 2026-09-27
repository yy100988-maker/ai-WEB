"use client";

import { useState } from "react";
import { Clapperboard, History, Home, Image, Mic, Music, Type, User } from "lucide-react";
import { ToolComposer } from "./ToolComposer";
import type { Locale } from "./site-data";

const TABS = [
  { id: "text", key: "text", icon: Type },
  { id: "image", key: "image", icon: Image },
  { id: "avatar", key: "avatar", icon: User },
  { id: "voice", key: "voice", icon: Mic },
  { id: "music", key: "music", icon: Music },
];

/** 演示工作台文案（按 locale；缺省回 EN，修 UI-DIFF P1-12 根路径语言串台） */
const STR: Record<string, Record<string, string>> = {
  en: {
    bannerTitle: "Demo studio (no Vutu account connected)",
    bannerBody:
      "The original /app requires login and touches real assets and billing. This page only replicates the studio layout and flow; every generation is simulated locally.",
    tabText: "Text to Video",
    tabImage: "Image to Video",
    tabAvatar: "AI Avatar",
    tabVoice: "Text to Speech",
    tabMusic: "AI Music",
    navHome: "Home",
    navWorks: "My Works",
    navHistory: "History",
    placeholder: "The “{tab}” panel is a layout placeholder — the demo fully replic only the Text-to-Video and Image-to-Video flows.",
    history: "History (placeholder)",
    draft: "Draft {i}",
  },
  "zh-TW": {
    bannerTitle: "演示工作台（未連接 Vutu 帳號）",
    bannerBody:
      "原站 /app 需登入且涉及個人資產與計費，本站刻意不做登入態復刻、不讀取你的瀏覽器登入資訊。此頁僅還原工作台佈局與操作流程，所有生成均為本地模擬。",
    tabText: "文字轉影片",
    tabImage: "圖片轉影片",
    tabAvatar: "AI 虛擬人",
    tabVoice: "文字轉語音",
    tabMusic: "AI 音樂",
    navHome: "首頁",
    navWorks: "我的創作",
    navHistory: "歷史記錄",
    placeholder: "「{tab}」面板為佈局佔位，演示版僅完整還原「文字轉影片 / 圖片轉影片」兩個流程。",
    history: "歷史（佔位）",
    draft: "草稿 {i}",
  },
  "zh-CN": {
    bannerTitle: "演示工作台（未连接 Vutu 账号）",
    bannerBody:
      "原站 /app 需登录且涉及个人资产与计费，本站刻意不做登录态复刻、不读取你的浏览器登录信息。此页仅还原工作台布局与操作流程，所有生成均为本地模拟。",
    tabText: "文字转视频",
    tabImage: "图片转视频",
    tabAvatar: "AI 虚拟人",
    tabVoice: "文字转语音",
    tabMusic: "AI 音乐",
    navHome: "首页",
    navWorks: "我的创作",
    navHistory: "历史记录",
    placeholder: "「{tab}」面板为布局占位，演示版仅完整还原“文字转视频 / 图片转视频”两个流程。",
    history: "历史（占位）",
    draft: "草稿 {i}",
  },
};

export function AppStudioMock({ locale = "en" }: { locale?: Locale }) {
  const s = STR[locale] ?? STR.en!;
  const tabLabel = (id: string): string => {
    const map: Record<string, string> = {
      text: s.tabText!,
      image: s.tabImage!,
      avatar: s.tabAvatar!,
      voice: s.tabVoice!,
      music: s.tabMusic!,
    };
    return map[id] ?? id;
  };
  const tabs = TABS.map((t) => ({ ...t, label: tabLabel(t.id) }));
  const [tab, setTab] = useState("text");
  const tcLocale: Locale = locale;
  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
        <p className="font-bold">{s.bannerTitle}</p>
        <p className="mt-1">{s.bannerBody}</p>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[220px_1fr_260px]">
        <aside className="hidden rounded-2xl border border-black/10 bg-white p-3 lg:block">
          {[
            { label: s.navHome, icon: Home },
            { label: s.navWorks, icon: Clapperboard },
            { label: s.navHistory, icon: History },
          ].map((item) => (
            <p
              key={item.label}
              className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-black/70"
            >
              <item.icon className="size-4" />
              {item.label}
            </p>
          ))}
          <div className="mt-2 border-t border-black/10 pt-2">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm ${
                  tab === t.id
                    ? "bg-black font-semibold text-white"
                    : "text-black/70 hover:bg-black/5"
                }`}
              >
                <t.icon className="size-4" />
                {t.label}
              </button>
            ))}
          </div>
        </aside>

        <div>
          <div className="mb-4 flex gap-2 overflow-x-auto lg:hidden">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold ${
                  tab === t.id ? "bg-black text-white" : "bg-black/5 text-black/70"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          {tab === "image" ? (
            <ToolComposer mode="image" locale={tcLocale} />
          ) : tab === "text" ? (
            <ToolComposer mode="text" locale={tcLocale} />
          ) : (
            <div className="rounded-2xl border border-dashed border-black/20 bg-white p-10 text-center text-sm text-black/55">
              {s.placeholder!.replace("{tab}", tabs.find((t) => t.id === tab)?.label ?? tab)}
            </div>
          )}
        </div>

        <aside className="rounded-2xl border border-black/10 bg-white p-4">
          <p className="text-sm font-bold">{s.history}</p>
          <div className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-1">
            {[1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className="flex aspect-video items-center justify-center rounded-lg bg-gradient-to-br from-slate-700 to-slate-900 text-[11px] text-white/70"
              >
                {s.draft!.replace("{i}", String(i))}
              </div>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}
