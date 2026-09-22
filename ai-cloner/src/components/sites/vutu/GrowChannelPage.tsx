"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  Check,
  ChevronDown,
  ExternalLink,
  Eye,
  Heart,
  Users,
  X,
} from "lucide-react";
import type { Locale } from "./site-data";
import { siteContent } from "./site-data";
import { SiteHeader } from "./SiteHeader";
import { SiteFooter } from "./SiteFooter";

interface Props {
  locale: Locale;
}

interface GycDict {
  navLabel: string;
  titleA: string;
  titleB: string;
  sub: string;
  startFree: string;
  seeHow: string;
  hwTitle: string;
  hwSub: string;
  hwItems: { t: string; b: string }[];
  storiesTitle: string;
  storiesSub: string;
  stories: { name: string; kind: string; stat1: string; stat2: string; stat3: string; title: string }[];
  toolsTitle: string;
  toolsSub: string;
  tools: { name: string; tagline: string; sub: string; b1: string; b2: string; cta: string; img: string }[];
  cmpTitle: string;
  cmpSub: string;
  beforeHead: string;
  before: string[];
  afterHead: string;
  after: string[];
  benTitle: string;
  ben: { t: string; b: string }[];
  ctaKicker: string;
  ctaTitleA: string;
  ctaTitleB: string;
  ctaSub: string;
  ctaBtn: string;
  faqTitle: string;
  faqs: { q: string; a: string }[];
  demoNote: string;
}

const IMGS = {
  reel: "/sites/vutu/showcase/row-02.jpg",
  pets: "/sites/vutu/showcase/row-03.jpg",
  brand: "/sites/vutu/showcase/show-1.png",
  studio: "/sites/vutu/showcase/row-01.png",
  agent: "/sites/vutu/showcase/row-05.jpg",
  canvas: "/sites/vutu/showcase/row-04.png",
  editor: "/sites/vutu/showcase/row-07.png",
};

const EN: GycDict = {
  navLabel: "Grow Your Channel",
  titleA: "Grow your channel",
  titleB: "in a Vutu way.",
  sub: "Make videos faster. Post more often. Give every idea a real chance to get views.",
  startFree: "Start creating for free",
  seeHow: "See how it works",
  hwTitle: "Make your channel worth returning to.",
  hwSub: "Make more videos without making the work harder.",
  hwItems: [
    { t: "Start with anything.", b: "Use an idea, prompt, image, clip, product, or reference." },
    { t: "Make it in one place.", b: "Plan, create, edit, and export without switching tools." },
    { t: "Make more versions.", b: "Reuse your assets to test new hooks, scenes, and styles." },
    { t: "Keep your channel recognizable.", b: "Keep recurring characters, visual style, and voice consistent across every post." },
    { t: "Post while it matters.", b: "Spend less time making and more time publishing." },
  ],
  storiesTitle: "Creator Stories",
  storiesSub: "See how creators use Vutu to turn ideas into videos people watch and share.",
  stories: [
    { name: "Vutu AI", kind: "Short-form Reels", stat1: "590K", stat2: "9.7K", stat3: "125K", title: "1M+ views. +15K followers in one month." },
    { name: "Tiny Odd Pets", kind: "Short-form series", stat1: "1.9M", stat2: "426K", stat3: "13K", title: "3 Weeks: From 0 To 3 Million Views." },
  ],
  toolsTitle: "Turn ideas into scroll-stopping posts.",
  toolsSub: "Use the right tool for the video you want to make next.",
  tools: [
    { name: "Viral Studio", tagline: "Turn a trend into your post.", sub: "Add a video or URL. Use its structure, then make it your own.", b1: "See the hook, pace, and key scenes", b2: "Swap in your subject, product, or style", cta: "Try Viral Studio", img: IMGS.studio },
    { name: "Vutu Agent", tagline: "Turn a topic into a video plan.", sub: "Give Agent a topic, product, trend, or reference. It gives you a clear place to start.", b1: "Turn a rough idea into a simple brief", b2: "Create your first assets fast", cta: "Create with Vutu Agent", img: IMGS.agent },
    { name: "Canvas workflow", tagline: "Put every asset in one place.", sub: "Mix video, images, voice, music, prompts, and references on one board.", b1: "Start with the assets you already have", b2: "Test people, products, hooks, and scenes", cta: "Open Canvas", img: IMGS.canvas },
    { name: "Vutu Editor", tagline: "Turn clips into a finished post.", sub: "Trim clips, fix the pace, add sound, and export without leaving Vutu.", b1: "Keep the best parts and cut the rest", b2: "Finish without switching editing tools", cta: "Open Editor", img: IMGS.editor },
  ],
  cmpTitle: "Make more. Test more. Post faster.",
  cmpSub: "Spend less time starting from zero.",
  beforeHead: "Before Vutu",
  before: [
    "Good trends pass before you can turn them into a post.",
    "Every video starts from scratch and takes too long.",
    "One idea becomes one post, if it gets finished at all.",
    "You cannot test new hooks without rebuilding.",
    "Too many tools break the flow before the video is ready.",
  ],
  afterHead: "With Vutu",
  after: [
    "Start with trends, then make them your own.",
    "Reuse a proven format and make each post feel fresh.",
    "Turn one idea into more videos to test and post.",
    "Test new hooks without rebuilding the video.",
    "Create, edit, and export in one place.",
  ],
  benTitle: "Stay in control at every step.",
  ben: [
    { t: "You decide what goes into every video.", b: "Check before you post. Edit prompts, assets, scenes, and cuts before export." },
    { t: "Keep your style.", b: "Choose the people, product, look, and story." },
    { t: "Use content responsibly.", b: "Only use content you have the right to use." },
  ],
  ctaKicker: "Your next post starts here",
  ctaTitleA: "Make Your Next Viral Video",
  ctaTitleB: "for Free",
  ctaSub: "Your Personal AI Creative & Production Team, From Idea to Publish.",
  ctaBtn: "Create now",
  faqTitle: "Questions?",
  faqs: [
    { q: "Who is Vutu for?", a: "Creators who want to make more videos for their channel." },
    { q: "Can I start from a reference?", a: "Yes. Add a video or supported social URL, then make it your own." },
    { q: "Do I need editing experience?", a: "No. Start with AI tools, then use Editor when you need more control." },
    { q: "Can I make different versions?", a: "Yes. Change the subject, product, setting, style, or format." },
    { q: "Can Vutu help me get more views?", a: "Views are never guaranteed. Vutu helps you move faster, test more ideas, and post more often." },
    { q: "Can I use my own assets?", a: "Yes. Use your images, clips, audio, prompts, products, and references." },
    { q: "What can I make?", a: "Make trend reactions, series, product videos, explainers, intros, and social clips." },
    { q: "Where should I start?", a: "Use Viral Studio for a trend, Agent for an idea, Canvas for assets, or Editor for clips." },
  ],
  demoNote: "Study-only front-end replica. Layout and copy mirror the original page; stats are placeholders.",
};

const ZH: GycDict = {
  navLabel: "经营你的频道",
  titleA: "用 Vutu 的方式",
  titleB: "经营你的频道。",
  sub: "更快做出影片，更频繁地发布，让每个创意都有真正获得观看的机会。",
  startFree: "免费开始创作",
  seeHow: "看看它怎么运作",
  hwTitle: "让频道值得观众一再回访。",
  hwSub: "产出更多影片，而不增加制作负担。",
  hwItems: [
    { t: "从任何东西开始。", b: "用想法、提示词、图片、片段、产品或参考素材起步。" },
    { t: "在一个地方完成。", b: "规划、创作、剪辑、导出，无需切换工具。" },
    { t: "做出更多版本。", b: "复用你的素材，测试新的钩子、场景与风格。" },
    { t: "保持频道辨识度。", b: "让常驻角色、视觉风格与声音在每条影片里保持一致。" },
    { t: "趁热发布。", b: "少花时间制作，多花时间发布。" },
  ],
  storiesTitle: "创作者故事",
  storiesSub: "看看创作者如何用 Vutu 把想法变成有人看、有人分享的影片。",
  stories: [
    { name: "Vutu AI", kind: "短影音 Reels", stat1: "590K", stat2: "9.7K", stat3: "125K", title: "单月播放破 100 万，粉丝 +1.5 万。" },
    { name: "Tiny Odd Pets", kind: "短影音系列", stat1: "1.9M", stat2: "426K", stat3: "13K", title: "3 周：从 0 到 300 万播放。" },
  ],
  toolsTitle: "把想法变成刷屏级帖子。",
  toolsSub: "为下一支影片选对工具。",
  tools: [
    { name: "爆款工作室", tagline: "把热点做成你的帖子。", sub: "贴上影片或链接，沿用它的结构，再改成你自己的版本。", b1: "看清钩子、节奏与关键场景", b2: "换成你的主角、产品或风格", cta: "试试爆款工作室", img: IMGS.studio },
    { name: "Vutu Agent", tagline: "把主题变成影片计划。", sub: "给 Agent 一个主题、产品、趋势或参考，它会给你明确的起点。", b1: "把粗略想法变成简洁的策划", b2: "快速做出第一批素材", cta: "用 Vutu Agent 创作", img: IMGS.agent },
    { name: "画布工作流", tagline: "把所有素材放在一处。", sub: "把影片、图片、配音、音乐、提示词和参考放在同一块画布上。", b1: "从已有素材开始", b2: "测试人物、产品、钩子与场景", cta: "打开画布", img: IMGS.canvas },
    { name: "Vutu 编辑器", tagline: "把片段变成成品帖子。", sub: "修剪片段、调整节奏、加入声音并导出，全程不用离开 Vutu。", b1: "保留精华，剪掉多余", b2: "无需切换剪辑工具即可完成", cta: "打开编辑器", img: IMGS.editor },
  ],
  cmpTitle: "产出更多。测试更多。发布更快。",
  cmpSub: "少一点从零开始。",
  beforeHead: "使用 Vutu 之前",
  before: [
    "热点过去了，帖子还没做出来。",
    "每支影片都从零开始，耗时太长。",
    "一个想法顶多变成一条帖子，还常常烂尾。",
    "不重做整支影片，就测不了新钩子。",
    "工具太多，影片没做完流程就断了。",
  ],
  afterHead: "使用 Vutu 之后",
  after: [
    "先跟上趋势，再改成你自己的。",
    "复用被验证过的格式，让每条帖子都有新鲜感。",
    "把一个想法变成更多影片去测试和发布。",
    "换钩子不必重做整支影片。",
    "在一个地方完成创作、剪辑与导出。",
  ],
  benTitle: "每一步都由你掌控。",
  ben: [
    { t: "每条影片放什么由你决定。", b: "发布前先检查，导出前可修改提示词、素材、场景与剪辑。" },
    { t: "保持你的风格。", b: "人物、产品、画面风格和故事都由你决定。" },
    { t: "负责任地使用内容。", b: "只使用你有权使用的内容。" },
  ],
  ctaKicker: "你的下一条帖子从这里开始",
  ctaTitleA: "免费生成你的下一支",
  ctaTitleB: "爆款影片",
  ctaSub: "从想法到发布的个人 AI 创意与制片团队。",
  ctaBtn: "立即创作",
  faqTitle: "常见问题",
  faqs: [
    { q: "Vutu 适合谁用？", a: "适合想为频道产出更多影片的创作者。" },
    { q: "可以从参考素材开始吗？", a: "可以。添加影片或受支持的社群链接，再改成你自己的版本。" },
    { q: "需要有剪辑经验吗？", a: "不需要。先用 AI 工具起步，需要更多控制时再用编辑器。" },
    { q: "可以做出不同版本吗？", a: "可以。更换主角、产品、场景、风格或格式即可。" },
    { q: "Vutu 能帮我拿到更多观看吗？", a: "观看量无法保证。Vutu 帮你跑得更快、测试更多想法、发布更频繁。" },
    { q: "可以用自己的素材吗？", a: "可以。使用你自己的图片、片段、音频、提示词、产品和参考素材。" },
    { q: "可以做什么？", a: "热点跟风、系列、产品影片、解说、开场和社群短片都能做。" },
    { q: "应该从哪里开始？", a: "有热点用爆款工作室，有想法用 Agent，有素材开画布，有片段用编辑器。" },
  ],
  demoNote: "学习研究用前端复刻：版式与文案还原原页面，数据为示意占位。",
};

const DICTS: Partial<Record<Locale, GycDict>> = {
  en: EN,
  "zh-CN": ZH,
  "zh-TW": ZH,
};

const NAV_LABELS: Partial<Record<Locale, string>> = {
  en: "Grow Your Channel",
  "zh-CN": "经营你的频道",
  "zh-TW": "經營你的頻道",
  ja: "チャンネルを伸ばす",
  ko: "채널 키우기",
  de: "Kanal aufbauen",
  es: "Haz crecer tu canal",
  fr: "Faites grandir votre chaîne",
  it: "Fai crescere il tuo canale",
  pt: "Faça crescer seu canal",
  ru: "Развивайте свой канал",
};

export function GrowChannelPage({ locale }: Props) {
  const d = DICTS[locale] ?? EN;
  const nav = NAV_LABELS[locale] ?? NAV_LABELS.en!;
  const base = locale === "en" ? "" : `/${locale}`;
  const appHref = locale === "en" ? "/en/app" : `/${locale}/app`;
  const [open, setOpen] = useState<number | null>(null);
  return (
    <>
      <SiteHeader locale={locale} base={locale === "en" ? "/" : `/${locale}`} />
      <main className="bg-white text-black">
        <section className="mx-auto grid w-[min(1420px,calc(100%-48px))] items-center gap-10 pt-16 md:grid-cols-2 md:pt-28">
          <div className="flex flex-col gap-8">
            <p className="text-xs font-semibold uppercase tracking-widest text-black/40">{nav}</p>
            <h1 className="bg-[linear-gradient(101.57deg,#000_3.36%,#666_29.45%,#000_50.04%,#7b7b7b_79.83%,#000_98.34%)] bg-clip-text text-[34px] leading-[1.25] font-bold text-transparent md:text-[56px]">
              {d.titleA}
              <br />
              {d.titleB}
            </h1>
            <p className="max-w-xl text-sm leading-relaxed text-black/60 md:text-lg">{d.sub}</p>
            <div className="flex flex-wrap gap-3">
              <Link
                href={appHref}
                className="inline-flex h-12 items-center justify-center rounded-full bg-[#1f11ed] px-7 text-sm font-semibold text-white hover:bg-[#1a0ec9]"
              >
                {d.startFree}
              </Link>
              <a
                href="#featured-use-cases"
                className="inline-flex h-12 items-center justify-center rounded-full border border-black/15 px-7 text-sm font-semibold text-black hover:bg-black/5"
              >
                {d.seeHow}
              </a>
            </div>
          </div>
          <div className="relative aspect-[4/3] overflow-hidden rounded-3xl border border-black/10 bg-black/5">
            <Image src={IMGS.reel} alt="" fill priority sizes="(max-width: 768px) 100vw, 50vw" className="object-cover" />
          </div>
        </section>

        <section className="mx-auto mt-20 w-[min(1420px,calc(100%-48px))]">
          <div className="flex flex-col items-center gap-3 text-center">
            <h2 className="max-w-[1000px] text-2xl leading-snug font-semibold md:text-5xl">{d.hwTitle}</h2>
            <p className="text-sm text-black/55 md:text-lg">{d.hwSub}</p>
          </div>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {d.hwItems.map((it, i) => (
              <article key={it.t} className="rounded-3xl border border-black/10 bg-[#fafafa] p-7">
                <span className="text-xs font-bold text-[#1f11ed]">0{i + 1}</span>
                <h3 className="mt-3 text-lg font-bold">{it.t}</h3>
                <p className="mt-2 text-sm leading-relaxed text-black/55">{it.b}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="mx-auto mt-24 w-[min(1420px,calc(100%-48px))]">
          <div className="flex flex-col items-center gap-3 text-center">
            <h2 className="max-w-[1000px] text-2xl leading-snug font-semibold md:text-5xl">{d.storiesTitle}</h2>
            <p className="text-sm text-black/55 md:text-lg">{d.storiesSub}</p>
          </div>
          <div className="mt-10 grid gap-6 lg:grid-cols-2">
            {d.stories.map((s, i) => (
              <article key={s.name} className="overflow-hidden rounded-3xl border border-black/10 bg-white">
                <div className="relative aspect-[16/9] bg-black/5">
                  <Image
                    src={i === 0 ? IMGS.reel : IMGS.pets}
                    alt={s.name}
                    fill
                    loading="lazy"
                    sizes="(max-width: 1024px) 100vw, 50vw"
                    className="object-cover"
                  />
                </div>
                <div className="p-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-base font-bold">{s.name}</p>
                      <p className="text-xs text-black/50">{s.kind}</p>
                    </div>
                    <span className="inline-flex items-center gap-1 text-xs text-black/45">
                      <ExternalLink className="size-3.5" />
                      Visit
                    </span>
                  </div>
                  <div className="mt-4 grid grid-cols-3 gap-3">
                    {[s.stat1, s.stat2, s.stat3].map((v, k) => (
                      <div key={k} className="rounded-2xl bg-[#f6f6f7] p-3 text-center">
                        <p className="inline-flex items-center gap-1 text-sm font-bold">
                          {k === 0 && <Eye className="size-3.5 text-black/45" />}
                          {k === 1 && <Users className="size-3.5 text-black/45" />}
                          {k === 2 && <Heart className="size-3.5 text-black/45" />}
                          {v}
                        </p>
                      </div>
                    ))}
                  </div>
                  <p className="mt-4 text-sm font-semibold">{s.title}</p>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section id="featured-use-cases" className="mx-auto mt-24 w-[min(1420px,calc(100%-48px))] scroll-mt-20">
          <div className="flex flex-col items-center gap-3 text-center">
            <h2 className="max-w-[1000px] text-2xl leading-snug font-semibold md:text-5xl">{d.toolsTitle}</h2>
            <p className="text-sm text-black/55 md:text-lg">{d.toolsSub}</p>
          </div>
          <div className="mt-10 grid gap-6 lg:grid-cols-2">
            {d.tools.map((t) => (
              <article key={t.name} className="grid overflow-hidden rounded-3xl border border-black/10 bg-white sm:grid-cols-2">
                <div className="relative min-h-[220px] bg-black/5">
                  <Image src={t.img} alt={t.name} fill loading="lazy" sizes="(max-width: 640px) 100vw, 25vw" className="object-cover" />
                </div>
                <div className="flex flex-col gap-3 p-6">
                  <p className="text-xs font-semibold uppercase tracking-wider text-[#1f11ed]">{t.name}</p>
                  <h3 className="text-lg font-bold leading-snug">{t.tagline}</h3>
                  <p className="text-sm text-black/55">{t.sub}</p>
                  <ul className="mt-1 space-y-1.5 text-sm text-black/70">
                    <li className="flex items-start gap-2">
                      <Check className="mt-0.5 size-4 shrink-0 text-[#1f11ed]" />
                      {t.b1}
                    </li>
                    <li className="flex items-start gap-2">
                      <Check className="mt-0.5 size-4 shrink-0 text-[#1f11ed]" />
                      {t.b2}
                    </li>
                  </ul>
                  <Link href={appHref} className="mt-auto inline-flex h-10 w-fit items-center rounded-full bg-black px-5 text-xs font-semibold text-white hover:opacity-85">
                    {t.cta}
                  </Link>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="mx-auto mt-24 w-[min(1420px,calc(100%-48px))]">
          <div className="flex flex-col items-center gap-3 text-center">
            <h2 className="max-w-[1000px] text-2xl leading-snug font-semibold md:text-5xl">{d.cmpTitle}</h2>
            <p className="text-sm text-black/55 md:text-lg">{d.cmpSub}</p>
          </div>
          <div className="mt-10 grid gap-6 lg:grid-cols-2">
            <div className="rounded-3xl border border-black/10 bg-[#fafafa] p-7">
              <p className="mb-4 inline-flex items-center gap-2 text-sm font-bold text-black/45">
                <X className="size-4" /> {d.beforeHead}
              </p>
              <ul className="space-y-3">
                {d.before.map((b) => (
                  <li key={b} className="flex items-start gap-3 rounded-2xl bg-white p-4 text-sm text-black/60">
                    <X className="mt-0.5 size-4 shrink-0 text-black/35" />
                    {b}
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-3xl border border-[#1f11ed]/20 bg-[#f5f4ff] p-7">
              <p className="mb-4 inline-flex items-center gap-2 text-sm font-bold text-[#1f11ed]">
                <Check className="size-4" /> {d.afterHead}
              </p>
              <ul className="space-y-3">
                {d.after.map((b) => (
                  <li key={b} className="flex items-start gap-3 rounded-2xl bg-white p-4 text-sm text-black/75">
                    <Check className="mt-0.5 size-4 shrink-0 text-[#1f11ed]" />
                    {b}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <section className="mx-auto mt-24 w-[min(1420px,calc(100%-48px))]">
          <div className="flex flex-col items-center gap-3 text-center">
            <h2 className="max-w-[1000px] text-2xl leading-snug font-semibold md:text-5xl">{d.benTitle}</h2>
          </div>
          <div className="mt-10 grid gap-4 md:grid-cols-3">
            {d.ben.map((b) => (
              <article key={b.t} className="rounded-3xl border border-black/10 bg-white p-7">
                <h3 className="text-base font-bold">{b.t}</h3>
                <p className="mt-2 text-sm leading-relaxed text-black/55">{b.b}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="relative mt-24 overflow-hidden bg-[#eaeaea]">
          <div className="mx-auto flex w-[min(1420px,calc(100%-48px))] flex-col items-center gap-4 py-20 text-center">
            <p className="text-xs font-semibold uppercase tracking-widest text-black/45">{d.ctaKicker}</p>
            <h2 className="max-w-[900px] bg-[linear-gradient(100deg,#000_9%,#666_33%,#000_59%,#2b1fa8_92%)] bg-clip-text text-3xl leading-tight font-bold text-transparent md:text-5xl">
              {d.ctaTitleA} {d.ctaTitleB}
            </h2>
            <p className="max-w-2xl text-sm text-black/60 md:text-lg">{d.ctaSub}</p>
            <Link
              href={appHref}
              className="mt-3 inline-flex h-14 items-center justify-center rounded-full bg-[#1f11ed] px-10 text-base font-semibold text-white shadow-[0_12px_32px_-8px_rgba(31,17,237,0.55)] hover:bg-[#1a0ec9]"
            >
              {d.ctaBtn}
            </Link>
          </div>
        </section>

        <section className="mx-auto w-[min(1420px,calc(100%-48px))] pb-24">
          <div className="mx-auto max-w-[1120px]">
            <h2 className="pt-16 text-center text-2xl font-semibold md:pt-24 md:text-5xl">{d.faqTitle}</h2>
            <div className="mt-10 flex flex-col md:mt-16">
              {d.faqs.map((f, i) => (
                <div key={f.q} className="border-b border-[#f4f4f4]">
                  <button
                    type="button"
                    aria-expanded={open === i}
                    aria-controls={`gyc-faq-answer-${i}`}
                    onClick={() => setOpen(open === i ? null : i)}
                    className="w-full cursor-pointer py-5 text-left transition-opacity hover:opacity-80 md:py-8"
                  >
                    <span className="pointer-events-none flex w-full items-center justify-between gap-4 md:gap-6">
                      <span className="max-w-[250px] text-[12px] leading-[18px] text-black md:max-w-[550px] md:text-[18px] md:leading-normal">
                        {f.q}
                      </span>
                      <ChevronDown className={`size-5 shrink-0 transition-transform ${open === i ? "rotate-90" : ""}`} />
                    </span>
                  </button>
                  {open === i && (
                    <p id={`gyc-faq-answer-${i}`} className="pb-6 text-sm leading-relaxed text-black/60 md:text-base">
                      {f.a}
                    </p>
                  )}
                </div>
              ))}
            </div>
            <p className="mt-10 text-center text-xs text-black/35">{d.demoNote}</p>
          </div>
        </section>
      </main>
      <SiteFooter locale={locale} />
    </>
  );
}
