import type { Metadata } from "next";
import { PricingPage } from "@/components/sites/vutu/ToolPages";

export const metadata: Metadata = {
  title: "Vutu AI — 無料 AI 動画生成 | pricing",
};

export default function Page() {
  return <PricingPage locale="ja" base="/ja" />;
}
