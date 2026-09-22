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
  title: "Vutu AI — générateur gratuit",
};

export default function Page() {
  return (
    <>
      <SiteHeader locale="fr" base="/fr" />
      <main>
        <HeroComposer locale="fr" />
        <HowItWorks locale="fr" />
        <FeatureCards locale="fr" />
        <TemplatesSection locale="fr" />
        <PromptLibrary locale="fr" />
        <Testimonials locale="fr" />
        <ModelWall locale="fr" />
        <CtaFinal locale="fr" />
        <HomeFaq locale="fr" />
      </main>
      <SiteFooter locale="fr" />
    </>
  );
}
