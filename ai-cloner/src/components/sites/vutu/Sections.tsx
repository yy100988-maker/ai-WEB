import Link from "next/link";
import Image from "next/image";
import { ArrowUpRight } from "lucide-react";
import type { Locale } from "./site-data";
import { siteContent } from "./site-data";

interface SectionProps {
  locale: Locale;
}

const FEATURE_IMAGES = [
  "/sites/vutu/features/feat-1.png",
  "/sites/vutu/features/feat-2.png",
  "/sites/vutu/features/feat-3.png",
  "/sites/vutu/features/feat-4.png",
  "/sites/vutu/features/feat-5.png",
  "/sites/vutu/features/feat-6.png",
];

const SHOWCASE_IMAGES = [
  "/sites/vutu/showcase/row-01.png",
  "/sites/vutu/showcase/row-02.jpg",
  "/sites/vutu/showcase/row-03.jpg",
  "/sites/vutu/showcase/row-04.png",
  "/sites/vutu/showcase/row-05.jpg",
  "/sites/vutu/showcase/row-06.png",
  "/sites/vutu/showcase/row-07.png",
  "/sites/vutu/showcase/row-08.png",
  "/sites/vutu/showcase/row-09.png",
  "/sites/vutu/showcase/row-10.png",
];

export function HowItWorks({ locale }: SectionProps) {
  const dict = siteContent[locale];
  const appHref = locale === "en" ? "/en/app" : `/${locale}/app`;
  return (
    <section id="use-cases" className="bg-white pt-[30px] pb-[40px] text-black md:pt-[10px] md:pb-[110px]">
      <div className="mx-auto max-w-[1420px] px-5 md:px-6">
        <div className="mb-[20px] text-center md:mb-[40px]">
          <h2 className="mx-auto max-w-2xl text-[22px] leading-snug font-extrabold md:text-[32px]">
            {dict.howTitle}
          </h2>
        </div>
        <div className="grid gap-5 md:grid-cols-3">
          {dict.workCards.map((card, i) => (
            <article
              key={card.title}
              className="flex flex-col rounded-2xl border border-black/10 bg-[#f9f9fa] p-6"
            >
              <span className="text-xs font-bold text-[#1f11ed]">
                0{i + 1}
              </span>
              <h3 className="mt-2 text-lg font-bold">{card.title}</h3>
              <p className="mt-2 flex-1 text-sm leading-relaxed text-black/60">
                {card.body}
              </p>
              <Link
                href={appHref}
                className="mt-5 inline-flex w-fit items-center gap-1 rounded-full bg-black px-5 py-2 text-sm font-semibold text-white hover:opacity-85"
              >
                {card.cta}
                <ArrowUpRight className="size-4" />
              </Link>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

export function ShowcaseStrip({ locale }: SectionProps) {
  void locale;
  return (
    <section className="overflow-hidden bg-white pb-[40px] md:pb-[90px]">
      <div className="flex gap-4 overflow-x-auto px-5 pb-2 md:px-6">
        {SHOWCASE_IMAGES.map((src) => (
          <div
            key={src}
            className="relative h-44 w-72 shrink-0 overflow-hidden rounded-xl border border-black/10 md:h-56 md:w-96"
          >
            <Image
              src={src}
              alt=""
              fill
              loading="lazy"
              sizes="(max-width: 768px) 288px, 384px"
              className="object-cover"
            />
          </div>
        ))}
      </div>
    </section>
  );
}

export function FeatureCards({ locale }: SectionProps) {
  const dict = siteContent[locale];
  return (
    <section id="features" className="bg-white py-[40px] text-black md:py-[90px]">
      <div className="mx-auto max-w-[1420px] px-5 md:px-6">
        <div className="mb-[20px] text-center md:mb-[80px]">
          <h2 className="mx-auto max-w-2xl text-[22px] leading-snug font-extrabold md:text-[32px]">
            {dict.featuresTitle}
          </h2>
        </div>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {dict.features.map((f, i) => (
            <Link
              key={f.title}
              href={f.href}
              className="group overflow-hidden rounded-2xl border border-black/10 bg-white transition-shadow hover:shadow-xl"
            >
              <div className="relative aspect-[16/9] bg-black/5">
                <Image
                  src={FEATURE_IMAGES[i % FEATURE_IMAGES.length]}
                  alt={f.title}
                  fill
                  loading="lazy"
                  sizes="(max-width: 1024px) 50vw, 33vw"
                  className="object-cover"
                />
              </div>
              <div className="p-5">
                <p className="text-[11px] font-bold tracking-wide text-[#1f11ed] uppercase">
                  {f.tag}
                </p>
                <h3 className="mt-1 font-bold group-hover:underline">
                  {f.title}
                </h3>
                <p className="mt-1.5 text-sm leading-relaxed text-black/60">
                  {f.body}
                </p>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

