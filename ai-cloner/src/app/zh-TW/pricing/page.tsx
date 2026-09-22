import type { Metadata } from "next";
import { PricingPage } from "@/components/sites/vutu/ToolPages";

export const metadata: Metadata = {
  title: "價格方案｜Vutu AI",
  description: "價格頁佈局復刻：價格為示意佔位，實際方案以 ai.vutu.cc 官網為準。",
};

export default function Page() {
  return <PricingPage locale="zh-TW" base="/zh-TW" />;
}
