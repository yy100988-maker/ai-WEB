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
  title: "Vutu AI — generador gratis",
};

export default function Page() {
  return (
    <>
      <SiteHeader locale="es" base="/es" />
      <main>
        <HeroComposer locale="es" />
        <HowItWorks locale="es" />
        <FeatureCards locale="es" />
        <TemplatesSection locale="es" />
        <PromptLibrary locale="es" />
        <Testimonials locale="es" />
        <ModelWall locale="es" />
        <CtaFinal locale="es" />
        <HomeFaq locale="es" />
      </main>
      <SiteFooter locale="es" />
    </>
  );
}
