import type { Metadata } from "next";
import { PricingPage } from "@/components/sites/vutu/ToolPages";

export const metadata: Metadata = {
  title: "Vutu AI — 무료 AI 영상 생성 | pricing",
};

export default function Page() {
  return <PricingPage locale="ko" base="/ko" />;
}
