import Link from "next/link";
import type { Locale } from "./site-data";
import { siteContent } from "./site-data";

export function StepsHow({ locale }: { locale: Locale }) {
  const dict = siteContent[locale];
  return (
    <section id="how" className="border-t border-black/10 bg-white text-black">
      <div className="mx-auto max-w-4xl px-4 py-16">
        <h2 className="text-center text-2xl font-bold tracking-tight">
          {dict.stepsTitle}
        </h2>
        <ol className="mt-10 space-y-4">
          {dict.steps.map((s, i) => (
            <li
              key={s.title}
              className="flex gap-4 rounded-2xl border border-black/10 p-5"
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-black text-sm font-bold text-white">
                {i + 1}
              </span>
              <div>
                <p className="font-bold">{s.title}</p>
                <p className="mt-1 text-sm leading-relaxed text-black/60">
                  {s.body}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

export function Faq({ locale }: { locale: Locale }) {
  const dict = siteContent[locale];
  return (
    <section className="border-t border-black/10 bg-[#fafafa] text-black">
      <div className="mx-auto max-w-4xl px-4 py-16">
        <h2 className="text-center text-2xl font-bold tracking-tight">
          {dict.faqTitle}
        </h2>
        <div className="mt-8 divide-y divide-black/10 rounded-2xl border border-black/10 bg-white">
          {dict.faqs.map((f) => (
            <details key={f.q} className="group px-5 py-4">
              <summary className="cursor-pointer list-none text-sm font-semibold group-open:text-violet-700">
                {f.q}
              </summary>
              <p className="mt-2 text-sm leading-relaxed text-black/60">{f.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

export function CtaBanner({ locale }: { locale: Locale }) {
  const dict = siteContent[locale];
  return (
    <section className="border-t border-black/5 bg-[#f9f9fa] text-black">
      <div className="mx-auto max-w-[1420px] px-5 py-16 text-center md:px-6">
        <h2 className="mx-auto max-w-2xl text-[22px] font-extrabold md:text-[32px]">
          {dict.ctaTitle}
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-sm text-black/60">
          {dict.ctaBody}
        </p>
        <Link
          href="/app/video"
          className="mt-7 inline-block rounded-full bg-[#1f11ed] px-8 py-3 text-sm font-bold text-white hover:opacity-90"
        >
          {dict.ctaButton}
        </Link>
      </div>
    </section>
  );
}
