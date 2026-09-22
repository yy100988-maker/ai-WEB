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
  title: "Vutu AI — 무료 AI 영상 생성",
};

export default function Page() {
  return (
    <>
      <SiteHeader locale="ko" base="/ko" />
      <main>
        <HeroComposer locale="ko" />
        <HowItWorks locale="ko" />
        <FeatureCards locale="ko" />
        <TemplatesSection locale="ko" />
        <PromptLibrary locale="ko" />
        <Testimonials locale="ko" />
        <ModelWall locale="ko" />
        <CtaFinal locale="ko" />
        <HomeFaq locale="ko" />
      </main>
      <SiteFooter locale="ko" />
    </>
  );
}
