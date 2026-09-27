import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/sites/vutu/SiteHeader";
import { SiteFooter } from "@/components/sites/vutu/SiteFooter";

export const metadata: Metadata = {
  title: "Blog | Vutu AI",
};

/**
 * 博客列表（根级 EN 实页）。
 *
 * UI-DIFF 报告 P0：deevid /blog 有 60+ 篇文章，本站 404 但页脚展示链接。
 * 本站不搬运对方文章正文，只还原「列表页结构」+ 研究复刻声明；
 * 单篇文章深链经 next.config redirects 归一到本页（/blog/:slug → /blog）。
 */
const POSTS: { title: string; date: string; blurb: string }[] = [];

export default function BlogPage() {
  return (
    <>
      <SiteHeader locale="en" base="/" />
      <main className="bg-white text-black">
        <section className="mx-auto w-[min(1420px,calc(100%-48px))] pt-16 pb-24 md:pt-24">
          <p className="text-xs font-semibold uppercase tracking-widest text-[#1f11ed]">Blog</p>
          <h1 className="mt-3 text-[32px] leading-[1.2] font-bold md:text-[52px]">Latest News</h1>
          <p className="mt-5 max-w-3xl text-sm leading-relaxed text-black/60 md:text-base">
            Release notes, model round-ups, and workflow write-ups for this study replica.
          </p>

          {POSTS.length === 0 ? (
            <div className="mt-12 max-w-3xl rounded-3xl border border-dashed border-black/20 bg-[#fafafa] p-10 text-center">
              <p className="text-base font-semibold">No posts in the replica yet</p>
              <p className="mt-2 text-sm leading-relaxed text-black/55">
                The original site publishes articles here; this study replica keeps the page
                structure and placeholder list only, without copying article bodies.
              </p>
              <Link
                href="/"
                className="mt-6 inline-flex h-11 items-center rounded-full bg-[#1f11ed] px-6 text-sm font-semibold text-white hover:bg-[#1a0ec9]"
              >
                Back to home
              </Link>
            </div>
          ) : (
            <ul className="mt-12 flex max-w-3xl flex-col gap-6">
              {POSTS.map((p) => (
                <li key={p.title} className="rounded-3xl border border-black/10 bg-[#fafafa] p-6">
                  <p className="text-xs text-black/40">{p.date}</p>
                  <h2 className="mt-1 text-lg font-bold">{p.title}</h2>
                  <p className="mt-2 text-sm leading-relaxed text-black/60">{p.blurb}</p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
      <SiteFooter locale="en" />
    </>
  );
}
