import type { Metadata } from "next";
import { ImageToVideoPage } from "@/components/sites/vutu/ToolPages";

export const metadata: Metadata = {
  title: "圖片轉影片｜Vutu AI",
  description: "圖片轉影片工具頁的前端還原：上傳、提示詞、參數均為靜態復刻。",
};

export default function Page() {
  return <ImageToVideoPage locale="zh-TW" base="/zh-TW" />;
}
