import type { Metadata } from "next";
import { TextToVideoPage } from "@/components/sites/vutu/ToolPages";

export const metadata: Metadata = {
  title: "Text to Video AI | Vutu",
  description:
    "Turn a prompt into a finished clip in minutes. Study-only front-end replica of the Vutu text-to-video page.",
};

export default function Page() {
  return <TextToVideoPage locale="en" base="/" />;
}
