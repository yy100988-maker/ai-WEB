import type { Metadata } from "next";
import { PricingPage } from "@/components/sites/vutu/ToolPages";

export const metadata: Metadata = {
  title: "Vutu AI — 免费 AI 视频生成器 | pricing",
};

export default function Page() {
  return <PricingPage locale="zh-CN" base="/zh-CN" />;
}
