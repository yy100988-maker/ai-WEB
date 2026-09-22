import type { Metadata } from "next";
import { TextToVideoPage } from "@/components/sites/vutu/ToolPages";

export const metadata: Metadata = {
  title: "Vutu AI — 免费 AI 视频生成器 | text-to-video",
};

export default function Page() {
  return <TextToVideoPage locale="zh-CN" base="/zh-CN" />;
}
