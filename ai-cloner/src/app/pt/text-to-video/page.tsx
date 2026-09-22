import type { Metadata } from "next";
import { TextToVideoPage } from "@/components/sites/vutu/ToolPages";

export const metadata: Metadata = {
  title: "Vutu AI — vídeos grátis | text-to-video",
};

export default function Page() {
  return <TextToVideoPage locale="pt" base="/pt" />;
}
