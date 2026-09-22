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
  title: "Vutu AI — gratis KI-Videos",
};

export default function Page() {
  return (
    <>
      <SiteHeader locale="de" base="/de" />
      <main>
        <HeroComposer locale="de" />
        <HowItWorks locale="de" />
        <FeatureCards locale="de" />
        <TemplatesSection locale="de" />
        <PromptLibrary locale="de" />
        <Testimonials locale="de" />
        <ModelWall locale="de" />
        <CtaFinal locale="de" />
        <HomeFaq locale="de" />
      </main>
      <SiteFooter locale="de" />
    </>
  );
}
