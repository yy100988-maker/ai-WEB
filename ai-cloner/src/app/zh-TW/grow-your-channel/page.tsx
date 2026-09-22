import type { Metadata } from "next";
import { GrowChannelPage } from "@/components/sites/vutu/GrowChannelPage";

export const metadata: Metadata = {
  title: "經營你的頻道 | Vutu 應用場景",
};

export default function Page() {
  return <GrowChannelPage locale="zh-TW" />;
}
