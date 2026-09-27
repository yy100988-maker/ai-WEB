import { SiteHeader } from "@/components/sites/vutu/SiteHeader";
import { SiteFooter } from "@/components/sites/vutu/SiteFooter";

/**
 * 法务/内容页（根级 EN 实页）。
 *
 * 背景：UI-DIFF 报告 P0 —— deevid 的 /terms /privacy-policy /content-policy
 * /contact-us /blog /affiliate 在本站全部 404，但页脚「公司」列处处展示这些链接。
 * 其余 10 个语种经 next.config redirects 归一到这些根级页面。
 *
 * ⚠️ 正文为本站原创占位说明（研究复刻声明），不搬运 deevid 的法务原文。
 */
export interface LegalDocProps {
  title: string;
  eyebrow: string;
  intro: string;
  sections: { h: string; p: string }[];
}

export function LegalDoc({ title, eyebrow, intro, sections }: LegalDocProps) {
  return (
    <>
      <SiteHeader locale="en" base="/" />
      <main className="bg-white text-black">
        <section className="mx-auto w-[min(1420px,calc(100%-48px))] pt-16 pb-24 md:pt-24">
          <p className="text-xs font-semibold uppercase tracking-widest text-[#1f11ed]">
            {eyebrow}
          </p>
          <h1 className="mt-3 max-w-4xl text-[32px] leading-[1.2] font-bold md:text-[52px]">
            {title}
          </h1>
          <p className="mt-5 max-w-3xl text-sm leading-relaxed text-black/60 md:text-base">
            {intro}
          </p>

          <div className="mt-12 flex max-w-3xl flex-col gap-8">
            {sections.map((s) => (
              <section key={s.h}>
                <h2 className="text-lg font-bold">{s.h}</h2>
                <p className="mt-2 text-sm leading-relaxed text-black/60">{s.p}</p>
              </section>
            ))}
          </div>

          <p className="mt-14 max-w-3xl rounded-2xl border border-black/10 bg-[#fafafa] p-5 text-xs leading-relaxed text-black/50">
            Study-only front-end replica (unofficial). This page documents the replica itself,
            not the original service. For the official terms of the real product, visit
            ai.vutu.cc.
          </p>
        </section>
      </main>
      <SiteFooter locale="en" />
    </>
  );
}

export const siteName = "Vutu AI";
