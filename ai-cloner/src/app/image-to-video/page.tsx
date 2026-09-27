import type { Metadata } from "next";
import { ImageToVideoPage } from "@/components/sites/vutu/ToolPages";

export const metadata: Metadata = {
  title: "Image to Video AI | Vutu",
  description:
    "Upload a photo, get motion in seconds. Study-only front-end replica of the Vutu image-to-video page.",
};

export default function Page() {
  return <ImageToVideoPage locale="en" base="/" />;
}
