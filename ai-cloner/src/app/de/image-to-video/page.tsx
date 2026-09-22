import type { Metadata } from "next";
import { ImageToVideoPage } from "@/components/sites/vutu/ToolPages";

export const metadata: Metadata = {
  title: "Vutu AI — gratis KI-Videos | image-to-video",
};

export default function Page() {
  return <ImageToVideoPage locale="de" base="/de" />;
}
