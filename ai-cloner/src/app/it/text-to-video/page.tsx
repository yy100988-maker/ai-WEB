import type { Metadata } from "next";
import { TextToVideoPage } from "@/components/sites/vutu/ToolPages";

export const metadata: Metadata = {
  title: "Vutu AI — video gratis | text-to-video",
};

export default function Page() {
  return <TextToVideoPage locale="it" base="/it" />;
}
