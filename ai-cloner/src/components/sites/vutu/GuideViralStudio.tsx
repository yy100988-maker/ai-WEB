"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight, ChevronDown, Check } from "lucide-react";
import type { Locale } from "./site-data";
import { siteContent } from "./site-data";
import { SiteHeader } from "./SiteHeader";
import { SiteFooter } from "./SiteFooter";

interface Props {
  locale: Locale;
}

const STEP_IMG = [
  "/sites/vutu/showcase/row-06.png",
  "/sites/vutu/showcase/row-07.png",
  "/sites/vutu/showcase/row-01.png",
  "/sites/vutu/showcase/row-02.jpg",
];

interface GuideDict {
  heroSub: string;
  tryIt: string;
  viewSteps: string;
  wfTitle: string;
  wfSub: string;
  steps: { title: string; body: string; result: string }[];
  benefitTitle: string;
  benefitSub: string;
  benefits: { t: string; b: string }[];
  tipsTitle: string;
  tipsSub: string;
  tips: { t: string; b: string }[];
  ctaTitle: string;
  ctaBody: string;
  ctaBtn: string;
  faqTitle: string;
  faqSub: string;
  faqs: { q: string; a: string }[];
  demoNote: string;
}

const EN: GuideDict = {
  heroSub: "Turn a video you like into a clear creative plan, new clips, and a finished edit. This guide walks you through every step, even if you are new to AI video tools.",
  tryIt: "Try it Now",
  viewSteps: "View steps",
  wfTitle: "Your first Viral Studio workflow",
  wfSub: "Four simple steps take you from a source video to an edit-ready result.",
  steps: [
    { title: "Add a source video", body: "Paste a TikTok, YouTube, X, or Instagram URL, or upload an MP4/MOV file.", result: "A reference ready for Vutu to analyze." },
    { title: "Analyze the video", body: "Click Create, then confirm the 1-credit analysis. Uploaded videos longer than 15 seconds are split into shorter segments automatically.", result: "Clear content notes and prompts for each scene." },
    { title: "Customize and generate", body: "Review the extracted content and prompts. Add global references or assets, edit each segment prompt, then choose a model and adjust its settings before generating.", result: "New scenes based on your own creative direction." },
    { title: "Finish in Editor", body: "Drag segmented clips to reorder them, then add audio and captions before exporting.", result: "A polished video ready to review and publish." },
  ],
  benefitTitle: "What Can Viral Studio Create for You?",
  benefitSub: "Start with what already works, then make it fully yours.",
  benefits: [
    { t: "Start with an idea that works.", b: "Use a reference as your starting point. You do not need to invent every scene." },
    { t: "Keep the idea. Make it yours.", b: "Use your product, people, setting, and style so the video feels unique to your brand." },
    { t: "Know what to do next.", b: "Follow a proven hook and scene flow, even if this is your first video." },
  ],
  tipsTitle: "Make Better Videos, Faster",
  tipsSub: "Use these simple habits to get clearer results, spend fewer credits, and reach a finished video sooner.",
  tips: [
    { t: "Choose a focused source clip", b: "A short clip with one main action is easier for AI to understand." },
    { t: "Set Global References", b: "Add your product, character, and brand look globally to keep every segment aligned." },
    { t: "Fix only what needs fixing", b: "Regenerate only the scenes that need changes." },
    { t: "Describe each scene clearly", b: "Name the subject, action, setting, and style to reduce unnecessary retries." },
    { t: "Test one variable at a time", b: "Batch-test videos by changing just one asset. Compare the versions to see what works best." },
    { t: "Save polish for Editor", b: "Reorder clips, add music, and add captions without another generation." },
  ],
  ctaTitle: "Ready to turn a reference into your own video?",
  ctaBody: "Start with one URL or video upload. Viral Studio will help you understand the source before you create the next version.",
  ctaBtn: "Try Viral Studio Now",
  faqTitle: "FAQ",
  faqSub: "Quick answers before you start your first Viral Studio project.",
  faqs: [
    { q: "What's the difference between Vutu 2.0 and 1.0?", a: "1.0 is a set of AI generation tools; 2.0 is a complete creative platform with Agent, Canvas, and Assets modules, plus multimodal I/O and smarter model routing." },
    { q: "Can I customize the video output?", a: "Yes — Canvas gives pixel-precise drag-and-drop control over duration, resolution, aspect ratio, and style." },
    { q: "Is there a free trial of AI Video Generator?", a: "Yes — a free plan with a fixed credit quota. Upgrade when you need more." },
    { q: "How do I start with the AI Video Generator?", a: "Register a free account, type in the prompt box, pick settings, and hit create." },
    { q: "Can I use AI-generated videos for commercial purposes?", a: "Yes — all paid plans include full commercial rights." },
    { q: "What types of input can I use to create videos?", a: "Text, images, video, audio, files, and URLs." },
  ],
  demoNote: "Study-only front-end replica. Layout and copy mirror the original page; stats are placeholders.",
};

const ZH: GuideDict = {
  heroSub: "把你喜欢的影片变成清晰的创作方案、新片段与成品剪辑。这份指南带你走完每一步，即使你是 AI 影片工具新手也没问题。",
  tryIt: "立即试用",
  viewSteps: "查看步骤",
  wfTitle: "你的第一次爆款工作室流程",
  wfSub: "四个简单步骤，从来源影片到可剪辑的成品。",
  steps: [
    { title: "添加来源影片", body: "贴上 TikTok、YouTube、X 或 Instagram 链接，或上传 MP4/MOV 文件。", result: "可供分析的参考素材。" },
    { title: "分析影片", body: "点击生成，确认使用 1 点数进行分析。超过 15 秒的影片会自动分成更短的片段。", result: "每个场景都清楚的内容笔记与提示词。" },
    { title: "自定义并生成", body: "查看提取的内容与提示词。新增全域参考素材，编辑每段提示词，选择模型并调整设置后生成。", result: "基于你自己创作方向的新场景。" },
    { title: "在编辑器中完成", body: "拖拽片段调整顺序，再加入声音与字幕后导出。", result: "可供检视与发布的精致影片。" },
  ],
  benefitTitle: "爆款工作室能为你做什么？",
  benefitSub: "从已被验证的内容开始，再完整融入你的风格。",
  benefits: [
    { t: "从一个好点子开始。", b: "用参考素材作为起点，不必自己凭空想出每个场景。" },
    { t: "保留核心想法，改成你的。", b: "使用你的产品、人物、场景与风格，让影片呈现品牌独有的特色。" },
    { t: "清楚下一步该做什么。", b: "跟着被验证过的钩子与场景流程走，即使这是你的第一支影片。" },
  ],
  tipsTitle: "更快做出更好的影片",
  tipsSub: "用这些简单习惯获得更清晰的结果、花更少点数，更快完成影片。",
  tips: [
    { t: "选一段聚焦的来源短片", b: "聚焦于单一动作的短片，AI 更容易理解。" },
    { t: "设定全域参考素材", b: "将产品、角色与品牌视觉设为全域参考，让每个片段保持一致。" },
    { t: "只修改需要改的部分", b: "只重新生成需要调整的场景。" },
    { t: "描述清楚每个场景", b: "写出主体、动作、场景与风格，减少不必要的重试。" },
    { t: "一次只测一个变量", b: "只换一项素材进行批次测试，比较不同版本找出效果最好的。" },
    { t: "精修留给编辑器", b: "不必再次生成，即可调整片段顺序、加入音乐与字幕。" },
  ],
  ctaTitle: "准备把参考素材变成你自己的影片了吗？",
  ctaBody: "贴上一个链接或上传一支影片即可开始。爆款工作室会先解析来源，再协助你制作新版本。",
  ctaBtn: "立即试用爆款工作室",
  faqTitle: "常见问题",
  faqSub: "开始你的第一次爆款工作室项目前的快速解答。",
  faqs: [
    { q: "Vutu 2.0 和 1.0 有什么差别？", a: "1.0 是一组 AI 生成工具；2.0 是一套完整的创作平台，包含 Agent、画布与资产模块，还有多模态输入输出和更智能的模型调度。" },
    { q: "可以自订影片输出吗？", a: "可以。画布支援像素级精準的拖拽控制，包括时长、解析度、画面比例与风格。" },
    { q: "AI 影片生成器有免费试用吗？", a: "有。免费方案提供固定额度的点数。需要更多时再升级。" },
    { q: "要如何开始使用 AI 影片生成器？", a: "注册免费帐号，在提示框中输入内容，选择设定，然后点击生成。" },
    { q: "AI 生成的影片可以用于商业用途吗？", a: "可以。所有付费方案所建立的影片都附带完整商业使用权。" },
    { q: "可以用哪些类型的输入来生成影片？", a: "文字、图片、影片、音频、文件和网址。" },
  ],
  demoNote: "学习研究用前端复刻：版式与文案还原原页面，数据为示意占位。",
};

/** 繁體版文案：原 ZH 同時喂 zh-CN / zh-TW 但正文为简体 —— UI-DIFF P1-13 拆分。 */
const ZHTW: GuideDict = {
  heroSub: "把你喜歡的影片變成清晰的創作方案、新片段與成品剪輯。這份指南帶你走完每一步，即使你是 AI 影片工具新手也沒問題。",
  tryIt: "立即試用",
  viewSteps: "查看步驟",
  wfTitle: "你的第一次爆款工作室流程",
  wfSub: "四個簡單步驟，從來源影片到可剪輯的成品。",
  steps: [
    { title: "添加來源影片", body: "貼上 TikTok、YouTube、X 或 Instagram 連結，或上傳 MP4/MOV 檔案。", result: "可供分析的參考素材。" },
    { title: "分析影片", body: "點擊生成，確認使用 1 點數進行分析。超過 15 秒的影片會自動分成更短的片段。", result: "每個場景都清楚的內容筆記與提示詞。" },
    { title: "自訂並生成", body: "查看擷取的內容與提示詞。新增全域參考素材，編輯每段提示詞，選擇模型並調整設定後生成。", result: "基於你自己創作方向的新場景。" },
    { title: "在編輯器中完成", body: "拖曳片段調整順序，再加入聲音與字幕後匯出。", result: "可供檢視與發布的精緻影片。" },
  ],
  benefitTitle: "爆款工作室能為你做什麼？",
  benefitSub: "從已被驗證的內容開始，再完整融入你的風格。",
  benefits: [
    { t: "從一個好點子開始。", b: "用參考素材作為起點，不必自己憑空想出每個場景。" },
    { t: "保留核心想法，改成你的。", b: "使用你的產品、人物、場景與風格，讓影片呈現品牌獨有的特色。" },
    { t: "清楚下一步該做什麼。", b: "跟著被驗證的鉤子與場景流程走，即使這是你的第一支影片。" },
  ],
  tipsTitle: "更快做出更好的影片",
  tipsSub: "用這些簡單習慣獲得更清晰的結果、花更少點數，更快完成影片。",
  tips: [
    { t: "選一段聚焦的來源短片", b: "聚焦於單一動作的短片，AI 更容易理解。" },
    { t: "設定全域參考素材", b: "將產品、角色與品牌視覺設為全域參考，讓每個片段保持一致。" },
    { t: "只修改需要改的部分", b: "只重新生成需要調整的場景。" },
    { t: "描述清楚每個場景", b: "寫出主體、動作、場景與風格，減少不必要的重試。" },
    { t: "一次只測一個變量", b: "只換一項素材進行批次測試，比較不同版本找出效果最好的。" },
    { t: "精修留給編輯器", b: "不必再次生成，即可調整片段順序、加入音樂與字幕。" },
  ],
  ctaTitle: "準備把參考素材變成你自己的影片了嗎？",
  ctaBody: "貼上一個連結或上傳一支影片即可開始。爆款工作室會先解析來源，再協助你製作新版本。",
  ctaBtn: "立即試用爆款工作室",
  faqTitle: "常見問題",
  faqSub: "開始你的第一次爆款工作室項目前的快速解答。",
  faqs: [
    { q: "Vutu 2.0 和 1.0 有什麼差別？", a: "1.0 是一組 AI 生成工具；2.0 是一套完整的創作平台，包含 Agent、畫布與資產模組，還有多模態輸入輸出與更智能的模型調度。" },
    { q: "可以自訂影片輸出嗎？", a: "可以。畫布支援像素級精準的拖曳控制，包括時長、解析度、畫面比例與風格。" },
    { q: "AI 影片生成器有免費試用嗎？", a: "有。免費方案提供固定額度的點數。需要更多時再升級。" },
    { q: "要如何開始使用 AI 影片生成器？", a: "註冊免費帳號，在提示框中輸入內容，選擇設定，然後點擊生成。" },
    { q: "AI 生成的影片可以用於商業用途嗎？", a: "可以。所有付費方案所建立的影片都附帶完整商業使用權。" },
    { q: "可以用哪些類型的輸入來生成影片？", a: "文字、圖片、影片、音訊、檔案和網址。" },
  ],
  demoNote: "學習研究用前端復刻：版式與文案還原原頁面，數據為示意佔位。",
};

const DICTS: Partial<Record<Locale, GuideDict>> = {
  en: EN,
  "zh-CN": ZH,
  "zh-TW": ZHTW,
};

export function GuideViralStudio({ locale }: Props) {
  const d = DICTS[locale] ?? EN;
  const appHref = locale === "en" ? "/en/app" : `/${locale}/app`;
  const [open, setOpen] = useState<number | null>(null);
  return (
    <>
      <SiteHeader locale={locale} base={locale === "en" ? "/" : `/${locale}`} />
      <main className="bg-white text-black">
        <section className="mx-auto flex w-[min(1420px,calc(100%-48px))] flex-col items-center gap-6 pt-16 text-center md:pt-28">
          <p className="text-xs font-semibold uppercase tracking-widest text-[#1f11ed]">Guide</p>
          <h1 className="max-w-4xl text-[32px] leading-[1.2] font-bold md:text-[56px]">
            How to Use
            <br />
            <span className="bg-[linear-gradient(101.57deg,#000_3.36%,#666_29.45%,#000_50.04%,#7b7b7b_79.83%,#000_98.34%)] bg-clip-text text-transparent">
              Vutu Viral Studio
            </span>
          </h1>
          <p className="max-w-3xl text-sm leading-relaxed text-black/60 md:text-lg">{d.heroSub}</p>
          <div className="flex flex-wrap justify-center gap-3">
            <Link href={appHref} className="inline-flex h-12 items-center gap-2 rounded-full bg-[#1f11ed] px-7 text-sm font-semibold text-white hover:bg-[#1a0ec9]">
              {d.tryIt}
              <ArrowRight className="size-4" />
            </Link>
            <a href="#workflow-steps" className="inline-flex h-12 items-center justify-center rounded-full border border-black/15 px-7 text-sm font-semibold text-black hover:bg-black/5">
              {d.viewSteps}
            </a>
          </div>
        </section>

        <section id="workflow-steps" className="mx-auto mt-20 w-[min(1420px,calc(100%-48px))] scroll-mt-20">
          <div className="flex flex-col items-center gap-3 text-center">
            <h2 className="max-w-[1000px] text-2xl leading-snug font-semibold md:text-5xl">{d.wfTitle}</h2>
            <p className="text-sm text-black/55 md:text-lg">{d.wfSub}</p>
          </div>
          <div className="mt-10 grid gap-6 md:grid-cols-4">
            {d.steps.map((s, i) => (
              <article key={s.title} className="flex flex-col gap-4 rounded-3xl border border-black/10 bg-[#fafafa] p-6">
                <div className="flex items-center gap-3">
                  <span className="inline-flex size-10 items-center justify-center rounded-full bg-[#1f11ed] text-sm font-bold text-white">0{i + 1}</span>
                  <h3 className="text-base font-bold">{s.title}</h3>
                </div>
                <p className="text-sm leading-relaxed text-black/60">{s.body}</p>
                <div className="mt-auto rounded-2xl bg-[#f0eefe] px-4 py-3">
                  <p className="text-xs font-semibold uppercase tracking-wider text-[#1f11ed]">You get</p>
                  <p className="mt-1 text-sm text-black/70">{s.result}</p>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="mx-auto mt-24 w-[min(1420px,calc(100%-48px))]">
          <div className="flex flex-col items-center gap-3 text-center">
            <h2 className="max-w-[1000px] text-2xl leading-snug font-semibold md:text-5xl">{d.benefitTitle}</h2>
            <p className="text-sm text-black/55 md:text-lg">{d.benefitSub}</p>
          </div>
          <div className="mt-10 grid gap-4 md:grid-cols-3">
            {d.benefits.map((b) => (
              <article key={b.t} className="rounded-3xl border border-black/10 bg-white p-7">
                <h3 className="text-base font-bold">{b.t}</h3>
                <p className="mt-2 text-sm leading-relaxed text-black/55">{b.b}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="mx-auto mt-24 w-[min(1420px,calc(100%-48px))]">
          <div className="flex flex-col items-center gap-3 text-center">
            <h2 className="max-w-[1000px] text-2xl leading-snug font-semibold md:text-5xl">{d.tipsTitle}</h2>
            <p className="text-sm text-black/55 md:text-lg">{d.tipsSub}</p>
          </div>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {d.tips.map((t) => (
              <article key={t.t} className="rounded-3xl border border-black/10 bg-[#fafafa] p-6">
                <div className="flex items-start gap-2.5">
                  <Check className="mt-0.5 size-5 shrink-0 text-[#1f11ed]" />
                  <div>
                    <h3 className="text-sm font-bold">{t.t}</h3>
                    <p className="mt-1 text-sm leading-relaxed text-black/55">{t.b}</p>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="relative mt-24 overflow-hidden bg-[#eaeaea]">
          <div className="mx-auto flex w-[min(1420px,calc(100%-48px))] flex-col items-center gap-4 py-20 text-center">
            <h2 className="max-w-[900px] text-2xl font-semibold md:text-4xl">{d.ctaTitle}</h2>
            <p className="max-w-2xl text-sm text-black/60 md:text-lg">{d.ctaBody}</p>
            <Link href={appHref} className="mt-3 inline-flex h-14 items-center justify-center rounded-full bg-[#1f11ed] px-10 text-base font-semibold text-white shadow-[0_12px_32px_-8px_rgba(31,17,237,0.55)] hover:bg-[#1a0ec9]">
              {d.ctaBtn}
            </Link>
          </div>
        </section>

        <section className="mx-auto w-[min(1420px,calc(100%-48px))] pb-24">
          <div className="mx-auto max-w-[1120px]">
            <h2 className="pt-16 text-center text-2xl font-semibold md:pt-24 md:text-5xl">{d.faqTitle}</h2>
            <p className="mt-3 text-center text-sm text-black/45">{d.faqSub}</p>
            <div className="mt-10 flex flex-col md:mt-14">
              {d.faqs.map((f, i) => (
                <div key={f.q} className="border-b border-[#f4f4f4]">
                  <button
                    type="button"
                    aria-expanded={open === i}
                    aria-controls={`guide-faq-${i}`}
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
                    <p id={`guide-faq-${i}`} className="pb-6 text-sm leading-relaxed text-black/60 md:text-base">{f.a}</p>
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
