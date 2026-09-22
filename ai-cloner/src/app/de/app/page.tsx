import type { Metadata } from "next";
import { AppHomePage } from "@/components/sites/vutu/AppHomePage";

export const metadata: Metadata = {
  title: "Vutu App",
  robots: { index: false, follow: false },
};

export default function Page() {
  return <AppHomePage locale="de" base="/de" />;
}
