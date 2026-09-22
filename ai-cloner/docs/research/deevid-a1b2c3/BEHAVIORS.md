# DeeVid Clone — Behaviors (BEHAVIORS.md)

Source: text extraction of `/`, `/zh-TW`, `/zh-TW/text-to-video` via fetch
(no browser MCP available in this environment; values below are the
interaction contract the mock implements).

## Global

- Sticky header, dark `#0b0b14`, backdrop blur; locale links 繁中/EN.
- Hero has violet→cyan radial glows over near-black.
- Feature thumbs are gradient placeholders (original uses `cdn2.deevid.ai` webp; not bundled, see manifest).

## Hero composer

- INTERACTION MODEL: time-driven mock (no backend).
- Textarea 0–2000 chars with live counter; file input (image/video/audio) keeps name locally, never uploads.
- 「創作」runs a ~2s local progress simulation (4% → 100%), then shows a "placeholder result" notice.
- 「免費創作」routes to `/app/video` studio mock.

## Tool composer (text/image pages)

- INTERACTION MODEL: click-driven mock.
- Chips: 720P/1080P, 5秒/10秒, 16:9/9:16/1:1 — single-select per group.
- 「創建」shows spinner ~2.2s, then an aspect placeholder card echoing `quality · duration · ratio` + truncated prompt.
- Image mode adds a dashed upload dropzone (local only).

## Studio mock (`/app/video`)

- INTERACTION MODEL: click-driven tabs (文字轉影片/圖片轉影片/虛擬人/語音/音樂); only text/image tabs render full composers, others show layout placeholders.
- Sidebar + history rail are static layout replicas.
- Amber notice states: no login integration, no backend calls.

## Responsive

- Desktop 1440: 3-col cards, sidebar studio layout.
- Mobile 390: single column, horizontal tab pills, sticky composer stacks.
- Breakpoint ≈ 1024px (lg:).
