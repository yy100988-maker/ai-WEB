import type { Metadata } from "next";
import { ImageToVideoPage } from "@/components/sites/vutu/ToolPages";

export const metadata: Metadata = {
  title: "Vutu AI — 無料 AI 動画生成 | image-to-video",
};

export default function Page() {
  return <ImageToVideoPage locale="ja" base="/ja" />;
}
