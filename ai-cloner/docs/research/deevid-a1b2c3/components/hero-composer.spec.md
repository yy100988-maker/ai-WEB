# HeroComposer Specification

## Overview
- **Target file:** `src/components/sites/deevid/HeroComposer.tsx`
- **Interaction model:** time-driven mock (no backend)

## DOM Structure
section > glow div + div.container > eyebrow pill, h1, sub, composer card
(textarea, upload button + hidden file input, char count, create btn, free link,
progress bar + notice), stats grid (3), trust line.

## Computed Styles (contract values)

### Section
- background: #0b0b14; color: white; glow: radial violet 139,92,246 @35% + cyan 34,211,238 @25%

### Composer card
- maxWidth: 42rem; radius: 1rem; border: white/15; bg: white/5; backdrop-blur

### Buttons
- Create: white bg, black text, xs bold; Free: gradient violet-500 → cyan-400, white text

## States & Behaviors
- **Working:** trigger = click 創作; progress 4→100 (~320ms ticks); button shows % + spinner, disabled.
- **Done:** notice text (zh-TW/EN) clarifying local simulation + official-site pointer.
- **Upload:** trigger = click 上傳檔案 → native picker; stores file NAME only; never uploads.

## Text Content (verbatim, zh-TW)
- Eyebrow「免費 AI 影片生成器」/ H1「從想法到發布，由你的 AI 創作團隊完成。」/ sub「適用於影片、圖片、虛擬人、語音與音樂的一站式 AI 導演。」/ stats「3000萬+ 創作者 / 1億次 生成量 / 238 國家/地區」.

## Responsive
- Desktop: centered max-w-6xl, h1 5xl. Mobile: h1 3xl, buttons wrap, stats 3-col retained.
