import type { Metadata } from "next";
import { PricingPage } from "@/components/sites/vutu/ToolPages";

export const metadata: Metadata = {
  title: "Pricing | Vutu AI",
  description:
    "Plan comparison for the Vutu study replica. Prices shown are placeholders; see ai.vutu.cc for real plans.",
};

export default function Page() {
  return <PricingPage locale="en" base="/" />;
}
