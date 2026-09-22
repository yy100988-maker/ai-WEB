import { NextRequest, NextResponse } from "next/server";

const MAP: [RegExp, string][] = [
  [/^zh-cn/i, "/zh-CN"],
  [/^zh/i, "/zh-TW"],
  [/^ja/i, "/ja"],
  [/^ko/i, "/ko"],
  [/^es/i, "/es"],
  [/^fr/i, "/fr"],
  [/^de/i, "/de"],
  [/^it/i, "/it"],
  [/^pt/i, "/pt"],
  [/^ru/i, "/ru"],
];

const LOCALES = new Set([
  "en",
  "zh-TW",
  "zh-CN",
  "ja",
  "ko",
  "es",
  "fr",
  "de",
  "it",
  "pt",
  "ru",
]);

export function proxy(req: NextRequest) {
  if (req.nextUrl.pathname !== "/") return NextResponse.next();
  // Manual choice wins: header language menu sets this cookie.
  const picked = req.cookies.get("vutu-locale")?.value;
  if (picked && LOCALES.has(picked)) return NextResponse.next();
  const first = (req.headers.get("accept-language") || "").split(",")[0].trim();
  for (const [re, dest] of MAP) {
    if (re.test(first)) {
      const url = req.nextUrl.clone();
      url.pathname = dest;
      return NextResponse.redirect(url);
    }
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/"],
};
