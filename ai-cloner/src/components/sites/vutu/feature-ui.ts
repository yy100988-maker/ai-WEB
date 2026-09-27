/**
 * 新功能文案（F1 优化 / F2 反推 / F3 兑换 / F4 发布 / F5 批量）—— 3 语，缺省回落 EN。
 *
 * 独立小字典 + pick 回落：与 AppHomePage 的 WORKBENCH_UI 同款模式，
 * 新增文案**不改** site-data 的 11 语种必填接口（沿用 works?: 可选键 + 兜底的既有先例），
 * 避免为一个按钮翻译 11 个 locale 文件。
 */
export interface FeatureStrings {
  optimize: string;
  optimizing: string;
  optimizeFail: string;
  needPrompt: string;
  reversing: string;
  reverseFail: string;
  publishing: string;
  published: string;
  publishFail: string;
  redeemLabel: string;
  redeemPlaceholder: string;
  redeemBtn: string;
  redeemOk: string;
  redeemInvalid: string;
  redeemFail: string;
  batch: string;
}

export const FEATURE_UI: Record<"en" | "zh-TW" | "zh-CN", FeatureStrings> = {
  en: {
    optimize: "AI enhance",
    optimizing: "Enhancing…",
    optimizeFail: "Enhance failed (credits are only charged on success)",
    needPrompt: "Enter a prompt first",
    reversing: "Extracting…",
    reverseFail: "Reverse failed",
    publishing: "Publishing…",
    published: "Published to Inspiration",
    publishFail: "Publish failed",
    redeemLabel: "Redeem code",
    redeemPlaceholder: "Redeem code",
    redeemBtn: "Redeem",
    redeemOk: "Redeemed",
    redeemInvalid: "Code not found",
    redeemFail: "Redeem failed",
    batch: "Batch",
  },
  "zh-TW": {
    optimize: "AI 優化",
    optimizing: "優化中…",
    optimizeFail: "優化失敗（成功才扣積分）",
    needPrompt: "請先輸入提示詞",
    reversing: "提取中…",
    reverseFail: "反推失敗",
    publishing: "發布中…",
    published: "已發布到靈感廣場",
    publishFail: "發布失敗",
    redeemLabel: "兌換碼",
    redeemPlaceholder: "輸入兌換碼",
    redeemBtn: "兌換",
    redeemOk: "兌換成功",
    redeemInvalid: "兌換碼不存在",
    redeemFail: "兌換失敗",
    batch: "批量",
  },
  "zh-CN": {
    optimize: "AI 优化",
    optimizing: "优化中…",
    optimizeFail: "优化失败（成功才扣积分）",
    needPrompt: "请先输入提示词",
    reversing: "提取中…",
    reverseFail: "反推失败",
    publishing: "发布中…",
    published: "已发布到灵感广场",
    publishFail: "发布失败",
    redeemLabel: "兑换码",
    redeemPlaceholder: "输入兑换码",
    redeemBtn: "兑换",
    redeemOk: "兑换成功",
    redeemInvalid: "兑换码不存在",
    redeemFail: "兑换失败",
    batch: "批量",
  },
};

export function pickFeature(locale: string): FeatureStrings {
  if (locale === "zh-TW") return FEATURE_UI["zh-TW"];
  if (locale === "zh-CN") return FEATURE_UI["zh-CN"];
  return FEATURE_UI.en;
}

/** 从未知异常取错误码（client.ts 抛 { code, ... }；非对象/无码 → 空串） */
export function errCode(e: unknown): string {
  if (typeof e === "object" && e !== null && "code" in e) {
    const c = (e as { code: unknown }).code;
    return typeof c === "string" ? c : "";
  }
  return "";
}
