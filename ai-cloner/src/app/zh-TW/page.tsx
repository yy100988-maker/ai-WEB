import type { Metadata } from "next";
import { SiteHeader } from "@/components/sites/vutu/SiteHeader";
import { SiteFooter } from "@/components/sites/vutu/SiteFooter";
import { HeroComposer } from "@/components/sites/vutu/HeroComposer";
import { FeatureCards, HowItWorks } from "@/components/sites/vutu/Sections";
import {
  CtaFinal,
  HomeFaq,
  ModelWall,
  PromptLibrary,
  TemplatesSection,
  Testimonials,
} from "@/components/sites/vutu/HomeSections";

export const metadata: Metadata = {
  title: "Vutu AI — 免費 AI 影片生成器",
  description:
    "ai.vutu.cc/zh-TW 公開营销頁的非官方前端學習復刻，不提供真實生成服務。",
};

export default function ZhTwHome() {
  return (
    <>
      <SiteHeader locale="zh-TW" base="/zh-TW" />
      <main>
        <HeroComposer locale="zh-TW" />
        <HowItWorks locale="zh-TW" />
        <FeatureCards locale="zh-TW" />
        <TemplatesSection locale="zh-TW" />
        <PromptLibrary locale="zh-TW" />
        <Testimonials locale="zh-TW" />
        <ModelWall locale="zh-TW" />
        <CtaFinal locale="zh-TW" />
        <HomeFaq locale="zh-TW" />
      </main>
      <SiteFooter locale="zh-TW" />
    </>
  );
}
