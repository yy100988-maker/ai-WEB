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
  title: "Vutu AI — Free AI Video Generator",
  description:
    "Unofficial front-end study replica of ai.vutu.cc marketing site. No real generation service.",
};

export default function EnglishHome() {
  return (
    <>
      <SiteHeader locale="en" base="/" />
      <main>
        <HeroComposer locale="en" />
        <HowItWorks locale="en" />
        <FeatureCards locale="en" />
        <TemplatesSection locale="en" />
        <PromptLibrary locale="en" />
        <Testimonials locale="en" />
        <ModelWall locale="en" />
        <CtaFinal locale="en" />
        <HomeFaq locale="en" />
      </main>
      <SiteFooter locale="en" />
    </>
  );
}
