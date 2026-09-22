# DeeVid Clone — Page Topology (output plan)

Target: `https://deevid.ai` (EN) + `https://deevid.ai/zh-TW` (zh-TW).
Template root: this repository (single app, `<app-root> = .`).

## Route map (source → destination)

| Source | Destination route | File |
|---|---|---|
| `/` (EN marketing) | `/` | `src/app/page.tsx` |
| `/zh-TW` (zh-TW marketing) | `/zh-TW` | `src/app/zh-TW/page.tsx` |
| `/zh-TW/text-to-video` | `/zh-TW/text-to-video` | `src/app/zh-TW/text-to-video/page.tsx` |
| `/zh-TW/image-to-video` (via `/app/explore/image-to-video` card) | `/zh-TW/image-to-video` | `src/app/zh-TW/image-to-video/page.tsx` |
| `/zh-TW/pricing` | `/zh-TW/pricing` | `src/app/zh-TW/pricing/page.tsx` (prices marked 示意) |
| `/app/video` (login-gated studio) | `/app/video` | `src/app/app/video/page.tsx` — layout/flow mock only, `noindex` |

Out of scope (explicit): real generation backend, auth/session/billing,
personal asset library, `/app/explore/*` deep pages (cards link to the two
fully-built tool pages or the studio mock).

## Namespaces

- Research: `docs/research/deevid-a1b2c3/` (this folder)
- Screenshots: `docs/design-references/deevid-a1b2c3/` (grabbed via web_fetch text + manual notes; no browser MCP in this env)
- Components: `src/components/sites/deevid/`
- Assets: `public/sites/deevid/` (favicons only; CDN media intentionally NOT bundled — see ARTIFACT_MANIFEST.md)

## Sections (marketing pages, top → bottom)

1. Sticky header (logo, nav×5, locale switch, 登入, 免費開始)
2. Hero composer (eyebrow, H1, sub, prompt box + upload + create + free CTA, progress sim)
3. Stats band (30M+ / 100M+ / 238) + trust line
4. How It Works ×3 cards → `/app/video`
5. Features grid ×6 (gradient thumbs, tag pills)
6. Tool grid ×10 (from text-to-video page sidebar)
7. Steps ×5 + FAQ ×5 (tool pages)
8. CTA banner + footer (3 columns + legal note)
