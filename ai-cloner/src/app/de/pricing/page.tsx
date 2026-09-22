import type { Metadata } from "next";
import { PricingPage } from "@/components/sites/vutu/ToolPages";

export const metadata: Metadata = {
  title: "Vutu AI — gratis KI-Videos | pricing",
};

export default function Page() {
  return <PricingPage locale="de" base="/de" />;
}
