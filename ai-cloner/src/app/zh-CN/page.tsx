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
  title: "Vutu AI — 免费 AI 视频生成器",
};

export default function Page() {
  return (
    <>
      <SiteHeader locale="zh-CN" base="/zh-CN" />
      <main>
        <HeroComposer locale="zh-CN" />
        <HowItWorks locale="zh-CN" />
        <FeatureCards locale="zh-CN" />
        <TemplatesSection locale="zh-CN" />
        <PromptLibrary locale="zh-CN" />
        <Testimonials locale="zh-CN" />
        <ModelWall locale="zh-CN" />
        <CtaFinal locale="zh-CN" />
        <HomeFaq locale="zh-CN" />
      </main>
      <SiteFooter locale="zh-CN" />
    </>
  );
}
