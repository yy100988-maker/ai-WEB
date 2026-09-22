import type { Metadata } from "next";
import { GrowChannelPage } from "@/components/sites/vutu/GrowChannelPage";

export const metadata: Metadata = {
  title: "Vutu — Faites grandir votre chaîne",
};

export default function Page() {
  return <GrowChannelPage locale="fr" />;
}
