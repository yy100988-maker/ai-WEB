import type { Metadata } from "next";
import { ImageToVideoPage } from "@/components/sites/vutu/ToolPages";

export const metadata: Metadata = {
  title: "Vutu AI — vídeos grátis | image-to-video",
};

export default function Page() {
  return <ImageToVideoPage locale="pt" base="/pt" />;
}
