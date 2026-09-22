import type { Metadata } from "next";
import { GrowChannelPage } from "@/components/sites/vutu/GrowChannelPage";

export const metadata: Metadata = {
  title: "Vutu — 채널 키우기",
};

export default function Page() {
  return <GrowChannelPage locale="ko" />;
}
