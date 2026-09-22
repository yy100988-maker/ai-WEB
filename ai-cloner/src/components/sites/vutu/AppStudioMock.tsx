"use client";

import { useState } from "react";
import { Clapperboard, History, Home, Image, Mic, Music, Type, User } from "lucide-react";
import { ToolComposer } from "./ToolComposer";

const tabs = [
  { id: "text", label: "文字轉影片", icon: Type },
  { id: "image", label: "圖片轉影片", icon: Image },
  { id: "avatar", label: "AI 虛擬人", icon: User },
  { id: "voice", label: "文字轉語音", icon: Mic },
  { id: "music", label: "AI 音樂", icon: Music },
];

export function AppStudioMock() {
  const [tab, setTab] = useState("text");
  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
        <p className="font-bold">演示工作台（未連接 Vutu 帳號）</p>
        <p className="mt-1">
          原站 /app 需登入且涉及個人資產與計費，本站刻意不做登入態復刻、不讀取你的瀏覽器登入資訊。此頁僅還原工作台佈局與操作流程，所有生成均為本地模擬。
        </p>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[220px_1fr_260px]">
        <aside className="hidden rounded-2xl border border-black/10 bg-white p-3 lg:block">
          {[
            { label: "首頁", icon: Home },
            { label: "我的創作", icon: Clapperboard },
            { label: "歷史記錄", icon: History },
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
            <ToolComposer mode="image" locale="zh-TW" />
          ) : tab === "text" ? (
            <ToolComposer mode="text" locale="zh-TW" />
          ) : (
            <div className="rounded-2xl border border-dashed border-black/20 bg-white p-10 text-center text-sm text-black/55">
              「{tabs.find((t) => t.id === tab)?.label}」面板為佈局佔位，演示版僅完整還原「文字轉影片 / 圖片轉影片」兩個流程。
            </div>
          )}
        </div>

        <aside className="rounded-2xl border border-black/10 bg-white p-4">
          <p className="text-sm font-bold">歷史（佔位）</p>
          <div className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-1">
            {[1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className="flex aspect-video items-center justify-center rounded-lg bg-gradient-to-br from-slate-700 to-slate-900 text-[11px] text-white/70"
              >
                草稿 {i}
              </div>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}
