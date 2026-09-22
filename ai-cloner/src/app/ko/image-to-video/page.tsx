import type { Metadata } from "next";
import { ImageToVideoPage } from "@/components/sites/vutu/ToolPages";

export const metadata: Metadata = {
  title: "Vutu AI — 무료 AI 영상 생성 | image-to-video",
};

export default function Page() {
  return <ImageToVideoPage locale="ko" base="/ko" />;
}
