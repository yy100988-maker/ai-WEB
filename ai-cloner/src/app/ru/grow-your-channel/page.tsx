import type { Metadata } from "next";
import { GrowChannelPage } from "@/components/sites/vutu/GrowChannelPage";

export const metadata: Metadata = {
  title: "Vutu — Развивайте свой канал",
};

export default function Page() {
  return <GrowChannelPage locale="ru" />;
}
