import type { Metadata } from "next";
import { GuideViralStudio } from "@/components/sites/vutu/GuideViralStudio";

export const metadata: Metadata = {
  title: "How to Use Vutu Viral Studio | Vutu Guide",
};

export default function Page() {
  return <GuideViralStudio locale="en" />;
}
