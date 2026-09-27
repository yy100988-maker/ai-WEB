import type { Metadata } from "next";
import { cookies } from "next/headers";
import { SiteHeader } from "@/components/sites/vutu/SiteHeader";
import { AppStudioMock } from "@/components/sites/vutu/AppStudioMock";
import { LOCALES, type Locale } from "@/components/sites/vutu/site-data";

export const metadata: Metadata = {
  title: "Vutu Studio | Vutu AI",
  description:
    "原站 /app/video 需登入；本站僅提供佈局與流程的演示還原，不連接任何帳號。",
  robots: { index: false, follow: false },
};

/**
 * 根级 /app/video 工作台演示。
 *
 * UI-DIFF P1-12：根路径属 EN，但本页曾写死 zh-TW —— 现按 `vutu-locale`
 * cookie（SiteHeader 语言切换时写入）取 locale，缺省回落 EN。
 */
export default async function AppVideoPage() {
  const store = await cookies();
  const raw = store.get("vutu-locale")?.value;
  const locale: Locale = LOCALES.some((l) => l.code === raw)
    ? (raw as Locale)
    : "en";

  return (
    <div className="min-h-screen bg-[#fafafa]">
      <SiteHeader locale={locale} base={locale === "en" ? "/" : `/${locale}`} />
      <main>
        <AppStudioMock locale={locale} />
      </main>
    </div>
  );
}
