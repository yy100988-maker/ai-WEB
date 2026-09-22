import type { Metadata } from "next";
import { GuideViralStudio } from "@/components/sites/vutu/GuideViralStudio";

export const metadata: Metadata = {
  title: "Руководство по вирусной студии | Vutu",
};

export default function Page() {
  return <GuideViralStudio locale="ru" />;
}
