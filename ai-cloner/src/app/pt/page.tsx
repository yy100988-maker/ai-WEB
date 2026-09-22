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
  title: "Vutu AI — vídeos grátis",
};

export default function Page() {
  return (
    <>
      <SiteHeader locale="pt" base="/pt" />
      <main>
        <HeroComposer locale="pt" />
        <HowItWorks locale="pt" />
        <FeatureCards locale="pt" />
        <TemplatesSection locale="pt" />
        <PromptLibrary locale="pt" />
        <Testimonials locale="pt" />
        <ModelWall locale="pt" />
        <CtaFinal locale="pt" />
        <HomeFaq locale="pt" />
      </main>
      <SiteFooter locale="pt" />
    </>
  );
}
