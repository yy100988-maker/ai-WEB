import type { Metadata } from "next";
import { PricingPage } from "@/components/sites/vutu/ToolPages";

export const metadata: Metadata = {
  title: "Vutu AI — générateur gratuit | pricing",
};

export default function Page() {
  return <PricingPage locale="fr" base="/fr" />;
}
