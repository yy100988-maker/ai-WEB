import type { Metadata } from "next";
import { PricingPage } from "@/components/sites/vutu/ToolPages";

export const metadata: Metadata = {
  title: "Vutu AI — vídeos grátis | pricing",
};

export default function Page() {
  return <PricingPage locale="pt" base="/pt" />;
}
