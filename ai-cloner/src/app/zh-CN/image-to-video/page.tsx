import type { Metadata } from "next";
import { ImageToVideoPage } from "@/components/sites/vutu/ToolPages";

export const metadata: Metadata = {
  title: "Vutu AI — 免费 AI 视频生成器 | image-to-video",
};

export default function Page() {
  return <ImageToVideoPage locale="zh-CN" base="/zh-CN" />;
}
