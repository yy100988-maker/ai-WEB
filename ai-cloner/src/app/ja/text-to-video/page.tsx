import type { Metadata } from "next";
import { TextToVideoPage } from "@/components/sites/vutu/ToolPages";

export const metadata: Metadata = {
  title: "Vutu AI — 無料 AI 動画生成 | text-to-video",
};

export default function Page() {
  return <TextToVideoPage locale="ja" base="/ja" />;
}
