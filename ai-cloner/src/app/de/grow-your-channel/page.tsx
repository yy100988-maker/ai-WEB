import type { Metadata } from "next";
import { GrowChannelPage } from "@/components/sites/vutu/GrowChannelPage";

export const metadata: Metadata = {
  title: "Vutu — Kanal aufbauen",
};

export default function Page() {
  return <GrowChannelPage locale="de" />;
}
