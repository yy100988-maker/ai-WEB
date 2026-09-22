import type { Metadata } from "next";
import { GrowChannelPage } from "@/components/sites/vutu/GrowChannelPage";

export const metadata: Metadata = {
  title: "Vutu — Faça crescer seu canal",
};

export default function Page() {
  return <GrowChannelPage locale="pt" />;
}
