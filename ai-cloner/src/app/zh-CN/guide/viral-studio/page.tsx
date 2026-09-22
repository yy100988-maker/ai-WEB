import type { Metadata } from "next";
import { GuideViralStudio } from "@/components/sites/vutu/GuideViralStudio";

export const metadata: Metadata = {
  title: "如何使用爆款工作室 | Vutu 指南",
};

export default function Page() {
  return <GuideViralStudio locale="zh-CN" />;
}
