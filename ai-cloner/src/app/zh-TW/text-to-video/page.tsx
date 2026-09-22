import type { Metadata } from "next";
import { TextToVideoPage } from "@/components/sites/vutu/ToolPages";

export const metadata: Metadata = {
  title: "文字轉影片 AI｜Vutu AI",
  description: "文字轉影片工具頁的前端還原：提示詞、參數、流程、FAQ 均為靜態復刻。",
};

export default function Page() {
  return <TextToVideoPage locale="zh-TW" base="/zh-TW" />;
}
