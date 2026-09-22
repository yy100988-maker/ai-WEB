# Artifact Manifest — deevid-a1b2c3

## Sources (fetched 2026-09-12)
- `https://deevid.ai/` (EN homepage, text)
- `https://deevid.ai/zh-TW` (zh-TW homepage, text)
- `https://deevid.ai/zh-TW/text-to-video` (tool page incl. nav/tools/steps/FAQ/footer, text)
- `https://deevid.ai/app/video` (returns title only — client-rendered + login-gated, treated as out-of-scope for real functionality)

## Assets: pixel pass (2026-09-12, user-approved)
- 33 files in `public/sites/deevid/` (7.87MB): hero×3, showcase×3+row×10,
  features×6 (320px thumbs), avatars×10 (240px), `favicon.svg`.
  Source: `cdn2.deevid.ai` public CDN URLs harvested from homepage HTML.
  License: media belongs to DeeVid — local study only, do NOT republish.
- Type: Inter via `next/font/google` (same family as original's next/font
  Inter 400–800); Poppins/Jakarta present in original CSS but unused by
  marketing type — not loaded.
- Verified against original markup/CSS: hero H1 24px/42px extrabold gradient
  `linear-gradient(90deg,#000 0.11%,#666 33.28%,#000 72%,#7B35FA 100%)`,
  containers `max-w-[1420px]`, hero `pt-[104px]/md:pt-[194px]`, sections
  `py-[40px]/md:py-[90px]`, brand `--brand-600:#1f11ed`, bg `--bg-app:#f9f9fa`.
- H2 (22px/32px) and section paddings are best-effort (no browser MCP for
  getComputedStyle in this env); side-by-side eyeball QA recommended.

## Browser QA pass (2026-09-12, bsk 0.2.1 + extension)
- Agent Window screenshots at 1280–1906px: hero matches (header pills,
  two-tone H1, composer card, video carousel); features + templates grid clean.
- Testimonial quotes (Linda/Mia/Jesse/Lara) + 5 homepage FAQ answers extracted
  live via evaluate (client-rendered, absent from static HTML).
- Showcase = 3 real mp4s (~1.7MB each) autoplay/muted/loop with original posters.
- Known simplifications: model wall uses monogram tiles (original has SVG logos);
  features grid instead of original prev/next carousel; ToolGrid dropped (not on
  original homepage); template grid shows 8 of 25.

## Downloader
- `scripts/download-assets-deevid.mjs` documents the above policy; it only probes reachability and writes nothing into `public/` by default.

## Spec files vs components
- `components/hero-composer.spec.md` → `HeroComposer.tsx` ✓
- Topology §8 sections → `Sections.tsx` + `InfoSections.tsx` ✓
- Tool flow → `ToolComposer.tsx` ✓ (720P/5秒/16:9 contract)
- Studio → `AppStudioMock.tsx` ✓ (tabs + amber no-login notice)

## Known gaps
- No pixel-diff QA (no browser MCP in this env); visual parity is eyeball-level.
- `/app/explore/*` deep pages, iOS/Android listings, blog, affiliate: footer-linked stubs only.
- Pricing figures are 示意 placeholders, not the merchant's real tiers.

## i18n (10 locales, 2026-09-13)
- Original has 9 (en + zh-TW/ja/ko/es/fr/de/it/pt); zh-CN added per request (original 404s, translated from zh-TW).
- Homepage x10: nav/hero/stats/work-cards/features byte-harvested per locale.
- Lower sections + tool pages translator-rendered, faithful and condensed. Media identical.
- Root auto-redirects by Accept-Language via src/proxy.ts (Next 16 Proxy; must live in src/ next to app/).
- Header globe dropdown lists all 10; mobile menu works.
