import type { Metadata } from "next";
import { GrowChannelPage } from "@/components/sites/vutu/GrowChannelPage";

export const metadata: Metadata = {
  title: "经营你的频道 | Vutu 应用场景",
};

export default function Page() {
  return <GrowChannelPage locale="zh-CN" />;
}
