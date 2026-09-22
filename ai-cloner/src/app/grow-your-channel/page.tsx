import type { Metadata } from "next";
import { GrowChannelPage } from "@/components/sites/vutu/GrowChannelPage";

export const metadata: Metadata = {
  title: "Grow Your Channel with AI Video | Vutu Use Case",
};

export default function Page() {
  return <GrowChannelPage locale="en" />;
}
