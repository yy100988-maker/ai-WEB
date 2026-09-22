import type { Metadata } from "next";
import { PricingPage } from "@/components/sites/vutu/ToolPages";

export const metadata: Metadata = {
  title: "Vutu AI — бесплатный ИИ-генератор видео | pricing",
};

export default function Page() {
  return <PricingPage locale="ru" base="/ru" />;
}
