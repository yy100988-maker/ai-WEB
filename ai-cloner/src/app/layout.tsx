import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Vutu AI — 免費 AI 影片生成器",
    template: "%s｜Vutu AI",
  },
  description:
    "Vutu AI：影片、圖片、虛擬人、語音與音樂的一站式 AI 導演。ai.vutu.cc",
  metadataBase: new URL("https://ai.vutu.cc"),
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-TW" className={`${inter.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-[#f9f9fa] font-sans text-black">
        {children}
      </body>
    </html>
  );
}
