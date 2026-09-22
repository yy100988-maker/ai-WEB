import type { Metadata } from "next";
import { GuideViralStudio } from "@/components/sites/vutu/GuideViralStudio";

export const metadata: Metadata = {
  title: "バズスタジオの使い方 | Vutu ガイド",
};

export default function Page() {
  return <GuideViralStudio locale="ja" />;
}
