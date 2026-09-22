import type { Metadata } from "next";
import { ImageToVideoPage } from "@/components/sites/vutu/ToolPages";

export const metadata: Metadata = {
  title: "Vutu AI — бесплатный ИИ-генератор видео | image-to-video",
};

export default function Page() {
  return <ImageToVideoPage locale="ru" base="/ru" />;
}
