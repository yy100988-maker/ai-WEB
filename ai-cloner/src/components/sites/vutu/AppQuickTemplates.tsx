"use client";

// F4 内容区：app.quick[] 模板数据源。
// catalogApi.templates() 成功 → 渲染服务端模板；失败/未登录 → 回退字典名单（原 mock 外观）。
// 点击回调把 prompt + refImg 交给 AppHomePage（复用其 ?prompt=&img= 状态，不动解析逻辑）。

import { useEffect, useState } from "react";
import Image from "next/image";
import { catalogApi } from "@/lib/api/resources";
import type { CatalogTemplate } from "@/lib/api/types";
import type { AppQuick } from "./site-data";

interface AppQuickTemplatesProps {
  // 回退名单（取自 site-data：a.quick），接口失败或未登录时展示
  fallback: AppQuick[];
  // 模板点击：预填 prompt + 参考图（AppHomePage 侧 setPrompt / setRefImg）
  onSelect: (prompt: string, img: string) => void;
}

export function AppQuickTemplates({ fallback, onSelect }: AppQuickTemplatesProps) {
  const [templates, setTemplates] = useState<CatalogTemplate[] | null>(null);

  useEffect(() => {
    let alive = true;
    catalogApi
      .templates()
      .then((list) => {
        if (alive && list.length > 0) setTemplates(list);
      })
      .catch(() => {
        // 失败则保持 null → 渲染 fallback，不抛错
      });
    return () => {
      alive = false;
    };
  }, []);

  // 卡片样式与原来 1:1（div 改 button 以支持点击，补 text-left）
  if (templates) {
    return (
      <>
        {templates.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => onSelect(t.prompt, t.refImgUrl ?? t.img)}
            className="group relative aspect-[4/3] cursor-pointer overflow-hidden rounded-2xl border border-black/10 bg-black/5 text-left"
          >
            <Image
              src={t.img}
              alt={t.title}
              fill
              loading="lazy"
              sizes="(max-width: 640px) 50vw, 25vw"
              className="object-cover transition-transform group-hover:scale-105"
            />
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-3 pt-8">
              <p className="text-sm font-bold text-white">{t.title} ›</p>
              {t.sub && <p className="mt-0.5 text-[11px] text-white/75">{t.sub}</p>}
            </div>
          </button>
        ))}
      </>
    );
  }

  return (
    <>
      {fallback.map((q) => (
        <button
          key={q.t}
          type="button"
          onClick={() => onSelect(q.t, q.img)}
          className="group relative aspect-[4/3] cursor-pointer overflow-hidden rounded-2xl border border-black/10 bg-black/5 text-left"
        >
          <Image
            src={q.img}
            alt={q.t}
            fill
            loading="lazy"
            sizes="(max-width: 640px) 50vw, 25vw"
            className="object-cover transition-transform group-hover:scale-105"
          />
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-3 pt-8">
            <p className="text-sm font-bold text-white">{q.t} ›</p>
            {q.s && <p className="mt-0.5 text-[11px] text-white/75">{q.s}</p>}
          </div>
        </button>
      ))}
    </>
  );
}
