import type { Metadata } from "next";
import { GuideViralStudio } from "@/components/sites/vutu/GuideViralStudio";

export const metadata: Metadata = {
  title: "바이럴 스튜디오 가이드 | Vutu",
};

export default function Page() {
  return <GuideViralStudio locale="ko" />;
}
