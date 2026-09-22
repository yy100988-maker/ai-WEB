import type { Metadata } from "next";
import { GuideViralStudio } from "@/components/sites/vutu/GuideViralStudio";

export const metadata: Metadata = {
  title: "Guia Estúdio viral | Vutu",
};

export default function Page() {
  return <GuideViralStudio locale="pt" />;
}
