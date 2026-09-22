import type { Metadata } from "next";
import { TextToVideoPage } from "@/components/sites/vutu/ToolPages";

export const metadata: Metadata = {
  title: "Vutu AI — 무료 AI 영상 생성 | text-to-video",
};

export default function Page() {
  return <TextToVideoPage locale="ko" base="/ko" />;
}
