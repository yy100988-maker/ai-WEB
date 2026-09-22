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
  title: "Vutu AI — 無料 AI 動画生成",
};

export default function Page() {
  return (
    <>
      <SiteHeader locale="ja" base="/ja" />
      <main>
        <HeroComposer locale="ja" />
        <HowItWorks locale="ja" />
        <FeatureCards locale="ja" />
        <TemplatesSection locale="ja" />
        <PromptLibrary locale="ja" />
        <Testimonials locale="ja" />
        <ModelWall locale="ja" />
        <CtaFinal locale="ja" />
        <HomeFaq locale="ja" />
      </main>
      <SiteFooter locale="ja" />
    </>
  );
}
