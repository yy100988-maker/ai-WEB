import Link from "next/link";
import Image from "next/image";
import type { Locale } from "./site-data";
import { siteContent } from "./site-data";

interface SiteFooterProps {
  locale: Locale;
}

export function SiteFooter({ locale }: SiteFooterProps) {
  const dict = siteContent[locale];
  const columns = dict.footerCols;
  return (
    <footer className="border-t border-black/10 bg-white text-black">
      <div className="mx-auto grid max-w-[1420px] gap-10 px-5 py-14 md:grid-cols-[1.2fr_2fr] md:px-6">
        <div>
          <p className="flex items-center gap-2 text-lg font-bold">
            <Image
              src="/sites/vutu/logo.svg"
              alt="Vutu"
              width={24}
              height={24}
              className="size-6 rounded"
            />
            Vutu AI
          </p>
          <p className="mt-3 max-w-xs text-sm leading-relaxed text-black/55">
            {dict.heroSubtitle}
          </p>
          <p className="mt-3 text-xs text-black/40">
            © 2026 Vutu AI · ai.vutu.cc
          </p>
        </div>
        <div className="grid grid-cols-2 gap-8 sm:grid-cols-3 lg:grid-cols-5">
          {columns.map((col) => (
            <div key={col.head}>
              <p className="text-sm font-semibold">{col.head}</p>
              <ul className="mt-3 space-y-2">
                {col.links.map((link) => (
                  <li key={link.label}>
                    <Link
                      href={link.href}
                      className="text-sm text-black/55 hover:text-black"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
      <div className="border-t border-black/10">
        <div className="mx-auto flex max-w-[1420px] items-center justify-between px-5 py-4 text-xs text-black/40 md:px-6">
          <span>© 2026 Vutu. 版權所有。</span>
          <span>iOS / Android / Discord / X / YouTube</span>
        </div>
      </div>
    </footer>
  );
}
