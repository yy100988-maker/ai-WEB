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
  title: "Vutu AI — video gratis",
};

export default function Page() {
  return (
    <>
      <SiteHeader locale="it" base="/it" />
      <main>
        <HeroComposer locale="it" />
        <HowItWorks locale="it" />
        <FeatureCards locale="it" />
        <TemplatesSection locale="it" />
        <PromptLibrary locale="it" />
        <Testimonials locale="it" />
        <ModelWall locale="it" />
        <CtaFinal locale="it" />
        <HomeFaq locale="it" />
      </main>
      <SiteFooter locale="it" />
    </>
  );
}
