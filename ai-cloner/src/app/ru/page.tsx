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
  title: "Vutu AI — бесплатный ИИ-генератор видео",
};

export default function Page() {
  return (
    <>
      <SiteHeader locale="ru" base="/ru" />
      <main>
        <HeroComposer locale="ru" />
        <HowItWorks locale="ru" />
        <FeatureCards locale="ru" />
        <TemplatesSection locale="ru" />
        <PromptLibrary locale="ru" />
        <Testimonials locale="ru" />
        <ModelWall locale="ru" />
        <CtaFinal locale="ru" />
        <HomeFaq locale="ru" />
      </main>
      <SiteFooter locale="ru" />
    </>
  );
}
