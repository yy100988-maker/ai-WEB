import type { Metadata } from "next";
import { PricingPage } from "@/components/sites/vutu/ToolPages";

export const metadata: Metadata = {
  title: "Vutu AI — video gratis | pricing",
};

export default function Page() {
  return <PricingPage locale="it" base="/it" />;
}
