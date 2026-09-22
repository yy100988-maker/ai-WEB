import type { Metadata } from "next";
import { GrowChannelPage } from "@/components/sites/vutu/GrowChannelPage";

export const metadata: Metadata = {
  title: "Vutu — Fai crescere il tuo canale",
};

export default function Page() {
  return <GrowChannelPage locale="it" />;
}
