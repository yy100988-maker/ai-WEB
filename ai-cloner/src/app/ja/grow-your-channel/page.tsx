import type { Metadata } from "next";
import { GrowChannelPage } from "@/components/sites/vutu/GrowChannelPage";

export const metadata: Metadata = {
  title: "Vutu — チャンネルを伸ばす",
};

export default function Page() {
  return <GrowChannelPage locale="ja" />;
}
