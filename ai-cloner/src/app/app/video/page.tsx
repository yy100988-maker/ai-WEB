import type { Metadata } from "next";
import { SiteHeader } from "@/components/sites/vutu/SiteHeader";
import { AppStudioMock } from "@/components/sites/vutu/AppStudioMock";

export const metadata: Metadata = {
  title: "Vutu 工作台｜Vutu AI",
  description:
    "原站 /app/video 需登入；本站僅提供佈局與流程的演示還原，不連接任何帳號。",
  robots: { index: false, follow: false },
};

export default function AppVideoPage() {
  return (
    <div className="min-h-screen bg-[#fafafa]">
      <SiteHeader locale="zh-TW" base="/zh-TW" />
      <main>
        <AppStudioMock />
      </main>
    </div>
  );
}
