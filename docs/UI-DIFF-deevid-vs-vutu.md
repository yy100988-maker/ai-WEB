# UI 差异核对报告：deevid.ai（源站） vs ai.vutu.cc（工作区项目）

> 核对日期：2026-09-23 ｜ 方法：HTTP 路由扫描（状态码矩阵）+ 全页 HTML 链接抽取 + 页面正文逐段比对 + 首屏截图目视比对。
> 桌面浏览器工具在本会话未连接（browser.disconnected），像素级截图比对以用户提供的两张首屏截图 + Hound 截图接口返回为准；结构性差异以 HTML/正文比对为证据，证据级别标注在各条目。

## 0. 结论速览

| 维度 | deevid.ai | ai.vutu.cc | 差异定性 |
|---|---|---|---|
| 页面总数（去重后可访问） | ≥ 100（含 60+ 博客文章、15 模型页、8 语言镜像） | ≈ 75（10 语言 × 7 页 + EN 5 页） | vutu 缺大量页面 |
| 语言 | EN + 8 语言（zh-TW/ja/de/fr/es/ko/pt/it） | EN + 10 语言（多 zh-CN、ru） | vutu 多 2 语种 |
| EN 子页面 | 全部存在（/pricing、/text-to-video…） | **仅 `/` 与 `/en/app`，其余 404** | **P0 断链** |
| 法务页 terms/privacy/content-policy | 200 完整长文 | **404**（footer 却展示链接） | **P0 断链** |
| 博客 / 联系 / 联盟 | 200 | **404**（footer 却展示链接） | **P0 断链** |
| robots.txt / sitemap.xml | 均 200 | **均 404** | SEO 缺失 |
| 工具页（11 个一级工具 + 20 个 more 工具） | 全部 200 | 仅 text-to-video / image-to-video 两页 | 大面积缺失 |
| 首页 / 定价 / 工作台 / 指南页 | 200 | 200（结构近似但内容差异大） | 见 §2–§6 |

---

## 1. 路由级差异（状态码实测）

### 1.1 deevid 有、vutu 返回 404（按组）

| 组 | deevid 路径 | vutu 状态 |
|---|---|---|
| SEO 旧首页 | `/home` | 404 |
| 法务 | `/terms` `/privacy-policy` `/content-policy` | 404 ×3 |
| 运营 | `/blog`（+60 篇 `/blog/*`） `/contact-us` `/affiliate` | 404 ×3 |
| 一级工具页 | `/video-to-video` `/reference-to-video` `/ai-image-generator` `/ai-image-editor` `/ai-video-editor` `/ai-avatar` `/ai-music-generator` `/text-to-speech` `/ai-video-tools` `/ai-ad` `/viral-video-clone` | 404 ×11 |
| more 工具页 | `/ai-video-generator` `/motion-control` `/pdf-to-video` `/ppt-to-video` `/video-to-prompt` `/image-to-prompt` `/3d-render-to-video` `/lip-sync-ai` `/template` `/ai-image-translator` `/ai-logo-generator` `/change-image-background` `/oc-maker` `/video-translator` `/ai-anime-generator` `/ai-photo-editor` `/text-to-image` | 404 ×17 |
| 探索/模型 | `/explore` `/model/{seedream,sora2,veo-ai,dall-e2,wanx-ai,runway-ai,kling-ai,hailuo-ai,stable-diffusion,vidu-ai,haiper-ai,luma-ai,nano-banana2,pika-ai}` | 404 ×16 |
| 应用子页 | `/app` `/app/editor` `/app/workflow` `/app/viral-studio` `/app/dev` `/app/explore/{ai-ad,ai-avatar,ai-image-generator,ai-music-generator,image-to-video,text-to-speech}` | 404 ×10（`/app/video` 仅根路径有） |
| 站点图 | `/sitemap.xml` `/robots.txt` | 404 ×2 |

**EN 子页（vutu 根级）**：`/pricing` `/text-to-video` `/image-to-video` `/app` `/en` `/en/pricing` `/en/text-to-video` `/en/image-to-video` `/en/guide/viral-studio` `/en/grow-your-channel` → **全部 404**。而 `/en/app` 侧栏「Upgrade」指向 `/en/pricing`（404），EN footer 的 Pricing/Terms/Privacy/Contact 全部降级指向 `/en/app`。

### 1.2 vutu 有、deevid 404（vutu 自增页）

| 路径 | 说明 |
|---|---|
| `/grow-your-channel`（+9 语言镜像） | deevid 实测 404，vutu 原创长页 |
| `/guide/viral-studio`（+9 语言镜像） | deevid 404（最近似的是登录态 `/app/viral-studio`） |
| `/zh-CN` `/ru` 及其 6 个子页 | deevid 这两个语种 404 |

### 1.3 语言矩阵

- deevid：`zh-TW ja de fr es ko pt it` = 200；`zh-CN ru zh ko-KR` = 404
- vutu：`zh-TW zh-CN ja de fr ru es ko pt it` 全部 200，但**每个语种只有 7 页**（`/` `/pricing` `/text-to-video` `/image-to-video` `/grow-your-channel` `/guide/viral-studio` `/app`）
- vutu 的 EN 只有 `/` 和 `/en/app`（2 页），是所有语种里最残缺的

---

## 2. 首页 `/`（EN）差异

### 2.1 头部
| 项 | deevid | vutu | 证据 |
|---|---|---|---|
| Logo | 文字「DeeVid」+ 紫色三角图标 | SVG `/sites/vutu/logo.svg`「Vutu」 | 截图 |
| 导航 | Create / Resources / **Use Case** / Guide / Pricing | Create / Resources / **Use Cases** / Guide / Pricing | 正文 |
| 语言切换 | 圆形地球图标 | 纯文字「English」 | 截图 |
| CTA | 「Login」白底 pill + 「Start For Free」黑底 pill（双按钮） | 单按钮「0\|Free trial」（带积分徽标样式） | 截图 |

### 2.2 Hero
- **H1 文案与断行**（原始 HTML `<h1>` 正则核验）：deevid「Your AI Creative & Production Team, From Idea to Publish.」（Publish 紫色渐变强调）；vutu「From Idea to Publish,By Your AI Creative Team.」——**逗号后缺空格（排版 bug）**，且强调色词位不同。证据：截图 + raw HTML 双源核验。
- **副标**：两边一致（All-in-one AI director for video, image, avatar, voice, and music.）。
- **Composer**：deevid 占位符「Create or edit a video from text, images, videos, audio, documents, or URLs.」+ Upload Files + @ 图标 + 灰色「Create Free」；vutu 占位「What do you want to create?」+ Upload Files + Create Free，**无 @ 按钮**。deevid 框下方有示例 prompt「Model rises, neon gas swirls, dominates.」+ Create / Recreate 双按钮；vutu 有 Recreate 但结构更简。
- **首屏展示带**：deevid 截图为 **3 张媒体卡并排**（人像/动画脸/科幻场景）；vutu 截图为 **1 张全宽媒体卡**（水下人像）。
- **头像堆**：vutu 在 composer 下有 7 个头像图 `av-01…av-07`；deevid 无此元素。证据：正文。

### 2.3 数据带 / How It Works
- 数据带（30M+/100M+/238 + Trusted by…）两边一致。
- How It Works：vutu 三卡带 **01/02/03 序号**，deevid 无序号；deevid 三卡各有 2 个同文案「Create Now」链接（hover 态重复），vutu 每卡 1 个「Create Now」。文案标点差异：deevid「Turn ideas into action.」/「Adjust anything. Exactly as intended.」 vs vutu 去句号改逗号。

### 2.4 Features（6 卡）
| # | deevid | vutu |
|---|---|---|
| 1 | Image to Video → `/app/explore/image-to-video` | Image to Video → `/en/app?tool=video` |
| 2 | AI Ads → `/app/explore/ai-ad` | AI Ads → `/en/app?tool=viral` |
| 3 | **AI Image Generator** → `/app/explore/ai-image-generator` | **Text to Video** → `/en/app?tool=video` |
| 4 | AI Avatar | **Avatar**（标题缩短） |
| 5 | AI Music（重复出现一次，疑似渲染 bug） | Music |
| 6 | Text to Speech | **TTS**（缩写） |
- 图片：deevid 用 6 张 CDN 实图（`cdn2.deevid.ai`，webp width=320）；vutu 用本地位图 `/sites/vutu/features/feat-N.png`。
- 标记结构：vutu 卡片同时输出 alt 文本 + `###` 标题（**重复标题**），deevid 为 图 + 纯文本标题。证据：正文 markdown。

### 2.5 模板带
- 标题：deevid「Create with All Trending&Hot Templates」+ 补充句 + CTA「Explore Now」；vutu「Create with trending templates」+ 缩短句 + CTA「Explore now」。
- 数量（`Template N` alt 正则统计，已核验）：deevid **unique 25 张 / 出现 33 次**（含走马灯重复）；vutu **unique 仅 8 张**。证据：raw HTML 统计。

### 2.6 vutu 独有两段（deevid 首页 SSR 未渲染）
以 `<h2>` 提取做双站核验：
- deevid 渲染的 h2 序列 = How It Works / Features / Create with All Trending&Hot Templates / Voice of Our Users / The right model for every task. / One idea. DeeVid makes it real. / Q & A（**7 段**）
- vutu 渲染的 h2 序列 = How It Works / Features / Create with trending templates / **The Viral Workflow Library** / **All video prompts** / What users say / The right model for every task / One idea. Vutu makes it real. / FAQ（**9 段**）

1. **The Viral Workflow Library** CTA 横幅（+「Free credits on signup · No credit card required」）
2. **All video prompts** 提示词画廊：分类 tab（All/Games/Music videos/Videos/Ads/AI Trends/Story plots）+ 16 张卡（含 5M/1M 等数据徽标、「複製此 Prompt」按钮）

> 注：deevid 首页 HTML 的 i18n 字典中**存在**这两个 key（如 `"The Viral Workflow Library":"Die Bibliothek für virale Workflows"`、`"All video prompts":"Alle Textvorlagen für Videos"` 的 de/en/es/fr 翻译），但 SSR 输出的 h2 序列里没有这两段 → 该组件在 deevid 侧为**客户端渲染或仅用于其它路由**（如 /app/explore）。对「首屏/SSR 可见 UI」而言，这两段仍是 vutu 独有；但若 deevid 客户端会渲染同款区块，则此项应从「vutu 自增」降级为「渲染时机差异」，待浏览器工具连接后复核。

> ⚠️ 该段按钮文案「複製此 Prompt」是**繁体中文出现在 EN 首页**（语言混排 bug）。证据：EN `/` 正文。

### 2.7 用户评价
- deevid「Voice of Our Users」**4 条**（Linda/Mia/Jesse/Lara，含头像与长文案）；vutu「What users say」**仅 1 条（Linda）**，且文案换成泛化句。缺 3 条。

### 2.8 模型带
- deevid：**14 个模型**真实图标/名称（Seedream, Sora 2, Veo 3.1, Dall-E 2, Wan 2.1, Runway, Kling, Hailuo, Stable Diffusion, Vidu, Haiper, Luma, Nano Banana Pro, Pika），带走马灯重复。
- vutu：**8 个自有模型**（Hailuo H3, MiniMax H3, GK Video 3, Omni 1.1, Omni Flash, Seedance 2.0, Seedance 2.5, HappyHorse），**首字母方块头像**替代图标，无走马灯。属「换品牌自有内容」的有意差异，但视觉形态（图标 vs 字母块）不同。

### 2.9 CTA / FAQ
- CTA：deevid「One idea. DeeVid makes it real.」→ `/app`；vutu「One idea. Vutu makes it real.」→ `/en/app`。结构一致。
- FAQ：标题 deevid「Q & A」vs vutu「FAQ」，5 问一致（主语替换为 Vutu）。

### 2.10 Footer（差异最大之一）
| 项 | deevid | vutu |
|---|---|---|
| 列数 | 4 列（Creation Tools 9 链 / Generation Tools 7 链 / Company 7 链 / Get the App + Stay Tuned） | 3 列（Create 4 / Generate 3 / Company 4） |
| 法务链接 | → `/terms` `/privacy-policy` `/content-policy` 真实页 | → **`/en/app` 或 `/zh-TW/pricing` 占位** |
| Blog / Affiliate / Contact | 真实页 | → `/en/app`（占位） |
| App 徽章 | App Store / Google Play 真实商店链接 | **无徽章**，仅一行文字「iOS / Android / Discord / X / YouTube」 |
| 社交图标 | Discord/X/YouTube/Instagram 图标真实外链 | **无图标**，文字指向占位页 |
| 版权行 | © 2026 Deevid. All rights reserved. | EN 页显示「© 2026 Vutu. **版權所有**。…」——**EN 语言混排 bug** |

zh-TW 系 footer 同样问题：Terms/Privacy/Content → `/zh-TW/pricing`，App 徽章/社交 → `/zh-TW/pricing`（占位）。证据：各页正文链接抽取。

---

## 3. 定价页 `/pricing`

| 项 | deevid | vutu（`/zh-TW/pricing` 等） |
|---|---|---|
| 顶部 | 年付/月付切换（Yearly 29% off） | **无切换** |
| 套餐 | Lite $10/$14、Pro $25/$35、**Premium $119/$159（Best Value）** | 免费版 NT$0、专业版 **NT$XXX（示意占位）**、企业版「聯絡我們」 |
| 每档内容 | CREDITS / FEATURES（7 项，含 720P/1080P 加粗）/ BENEFITS 分组 | 4 条 bullet，无分组 |
| 徽标 | 「Best Value」 | 「HOT」 |
| 用户评价 | 3 条长评价 | **无** |
| FAQ | **9 问** + 有效期/不退款法律注脚 | **无 FAQ** |
| 声明 | 无 | 顶部有「本頁僅還原價格頁佈局，金額為示意佔位」横幅 |
- vutu EN 侧根本无定价页（404），`/en/app` 的 Upgrade 按钮因此断链。

---

## 4. 工具页

### 4.1 `/text-to-video`
| 区块 | deevid | vutu（`/zh-TW/text-to-video`） |
|---|---|---|
| 左侧工具栏 | **有**（Create with Agent / Explore / CREATION TOOLS 11 项 / WORKFLOWS 2 项，含 New、Nano Banana 徽标） | **无**（只有顶部 header） |
| Composer 参数条 | 0/2000 · **720P · 5s · 16:9 · 1 Outputs** + Create | 0/2000 +「自訂解析度、時長與比例」+ 創建，**无参数 chips** |
| 首段 | 「Instant Video Creation from Text」+ 长示例 prompt 卡 | **缺该段与 prompt 卡**，仅一句简介 |
| 卖点段 | 2 段（Most Realistic / Fast and Scalable），各带 CTA 按钮 | 2 段标题在，**CTA 按钮缺失** |
| 步骤 | 5 步 | 5 步（一致） |
| FAQ | 5 问 | 5 问（一致） |
| 末尾 CTA 横幅 | 有（Create AI Videos from Text in Minutes!） | **无** |

### 4.2 `/image-to-video`
| 区块 | deevid | vutu（`/zh-TW/image-to-video`） |
|---|---|---|
| 左侧工具栏 | 有（同上 + API 入口） | 无 |
| 顶部 tab | **Start Image / Between Images / Reference Images** 三 tab | **无** |
| 上传区 | Click or drop an image + Select asset + Create image | 仅「點擊上傳參考圖片」按钮 |
| 参数条 | 0/2000 · 720P · 5s · 1 Outputs | 0/2000，无 chips |
| Before/After 演示 | **4 组**（原始图 + Prompt + video） | **无任何演示组** |
| 卖点段 | 2 段（One Tap Image Animation / Turn Any Photo… / Professional Video Quality） | **改为 01/02/03 三步卡**（上传/描述/得到短片），结构与源站不同 |
| 步骤 / FAQ / 末 CTA | 4 步 + 4 问 + CTA 横幅 | **全部缺失** |

### 4.3 缺失的 28 个工具页
见 §1.1，deevid 全部 200、vutu 全部 404（一级 11 + more 17）。

---

## 5. 工作台（App）

| 项 | deevid | vutu |
|---|---|---|
| 入口 | `/app`（200，登录态 SPA）、`/app/video` `/app/editor` `/app/workflow` `/app/viral-studio` `/app/dev` `/app/explore/*` | 仅 `/app/video`（根）、`/{lang}/app`（10 语种） |
| `/app/video` 抓取 | 无正文返回（登录门控/反爬） | 返回**繁体中文演示工作台**，含免责声明「演示工作台（未連接 Vutu 帳號）…此頁僅還原工作台佈局與操作流程，所有生成均為本地模擬」 |
| 语言一致性 | — | **根路径 `/` 是 EN，但 `/app/video` 输出 zh-TW 文案**（语言串台） |
| `/en/app` 结构 | — | 顶部促销条（50% off + 倒计时 --:--:-- + Subscribe）/ 左侧栏（AI tools 5 + AI studio 3 + My Works 等）/ Free plan 0 / Upgrade→`/en/pricing`(**404**) / 主区 AI Video H1 + composer + 空态 + Try an example 3 卡 + Quick start 7 卡 + Inspiration 5 图 |
| deevid `/app` 可见内容 | 未取到正文（无法逐项比对） | — |

> `/en/app` 内出现中英混排（「新聊天」「我的作品」「画布编辑器」「描述你想要的内容，点击生成」「结果会显示在这里」在 EN 语言下为中文）。证据：`/en/app` 正文。

---

## 6. 定价外新增长页（vutu 独有）

- `/guide/viral-studio`：四步工作流 + 3 卖点 + 6 tips + FAQ 6 问，页面底部有「Study-only front-end replica…stats are placeholders」声明。deevid 无对应公开页。
- `/grow-your-channel`：创作者故事 2 例 + before/after 对比 + 4 工具卡 + FAQ 8 问 + 同声明。deevid 404。
- zh-TW 版这两页正文为**简体中文混入繁体站**（「把你喜欢的影片变成清晰的创作方案」「更快做出影片，更频繁地发布」）。证据：`/zh-TW/guide/viral-studio`、`/zh-TW/grow-your-channel` 正文。

---

## 7. 差异分级汇总

### P0 — 断链/缺页（用户可点出 404）
1. EN 语言定价/工具子页全缺：`/en/pricing`（app 内 Upgrade 直达 404）、`/pricing` `/text-to-video` `/image-to-video` `/en/*` 全 404
2. 三方法务页 404，但 footer 处处展示这些链接（指向占位页）
3. `/blog` `/contact-us` `/affiliate` 404，footer 展示链接
4. 28 个工具页 + 16 个 explore/model 页 + 10 个 app 子页 404
5. `robots.txt` `/sitemap.xml` 404

### P1 — 结构性 UI 差异（同页对比可见）
6. 首页 H1「Publish,By」缺空格；EN 页混入繁中（「複製此 Prompt」「版權所有」）；`/en/app` 混入简中
7. 首页模板带 8 vs 24 张；用户评价 1 vs 4 条；模型带 8 字母块 vs 14 图标
8. Footer 列数 3 vs 4、App 徽章与社交图标缺失、公司链接全部占位
9. 定价页：无年/月切换、无 FAQ（9 问）、无评价、金额占位「NT$XXX」
10. image-to-video 页：缺 3 tab、缺 4 组 before/after、缺步骤/FAQ/CTA；卖点段被换成 01/02/03 结构
11. text-to-video 页：缺左侧工具栏、缺参数 chips（720P/5s/16:9）、缺 prompt 示例卡与末尾 CTA
12. 工作台 `/app/video` 输出 zh-TW（根路径应为 EN）
13. zh-TW 站的两页新增长页正文为简体（简繁混排）

### P2 — 有意差异（换品牌/自有内容，记录备查）
14. 品牌词 DeeVid→Vutu、按钮/导航文案微调（Use Case→Use Cases）
15. 模型清单换成自有 8 模型、头像换成字母块
16. Features 第 3 卡从 AI Image Generator 换成 Text to Video，标题缩写（Avatar/TTS）
17. vutu 新增 Viral Workflow Library 横幅 + All video prompts 画廊 + grow-your-channel/guide 两页 + zh-CN/ru 语种
18. 所有图片资源从 deevid CDN 换成本地 `/sites/vutu/*`

---

## 8. 覆盖度说明

- 路由状态码矩阵：deevid 41 条 + vutu 120+ 条全部实测。
- 正文逐段比对：`/`（EN）、`/zh-TW`、`/pricing`（双侧）、`/text-to-video`（双侧）、`/image-to-video`（双侧）、`/app/video`、`/en/app`、`/zh-TW/app`、`/guide/viral-studio`、`/grow-your-channel`、deevid `/home` `/terms` `/content-policy` `/blog` `/contact-us` `/affiliate` `/ai-image-generator` `/ai-video-tools`。
- 语种抽样：zh-TW 全页深比，其余 9 语种做状态码 + 页集矩阵。
- **未覆盖**：deevid 60+ 篇 `/blog/*` 文章正文（vutu 无对应页，差异即「缺失」）；deevid `/app` 登录态 SPA 内部 UI（反爬无正文返回，无法逐项比对）；像素级 CSS/间距比对（浏览器工具未连接）。

---

## 9. 修复记录（2026-09-23，ai-cloner 工作区；typecheck/lint 0 错、build 通过）

### P0 已修
| # | 问题 | 修复 |
|---|---|---|
| 1 | EN 子页全 404（/pricing /text-to-video /image-to-video 等） | 新建根级 EN 实页 3 个 + `next.config redirects` 全量深链归一（/en/* → 根、/{locale}/* 深链 → 本语言 /app 或根法务、/app → /en/app、deevid 29 个工具 slug → ?tool= 视图、/model/:slug → 首页、/blog/:slug → /blog、/home → /） |
| 2 | 三方法务页 404 | 新建 `/terms` `/privacy-policy` `/content-policy`（原创占位正文 + 研究复刻声明，不搬对方法务原文） |
| 3 | blog/contact/affiliate 404 | 新建 `/blog`（结构占位、不搬运文章）`/contact-us` `/affiliate`；11 个语种页脚公司列全部改指真实页 |
| 4 | 工具/explore/app 子页 404 | redirects 归一到本站 `?tool=` 视图（不做 28+16+10 个壳页） |
| 5 | robots/sitemap 404 | 新建 `src/app/robots.txt`（含 noindex 工作台 Disallow）+ `src/app/sitemap.xml`（84 条可索引 URL） |

### P1 已修
| # | 问题 | 修复 |
|---|---|---|
| 6 | H1「Publish,By」缺空格 | `HeroComposer` 按 h1a 结尾标点动态补空格（全角不补/ASCII 与破折号补），11 语种同时受益 |
| 7 | 模板带 8 vs 25 | `TEMPLATES` 扩到 24 张（复用本地 showcase/hero 资源），网格升 6 列 |
| 7' | 评价 SSR 只出 1 条 | `Testimonials` 改 4 卡网格一次渲染（原单卡轮播） |
| 8 | footer 3 列 vs 5 列、公司链接全占位、社交伪链 pricing | EN/zh-TW footer 补「Get the App」「Stay Tuned」列；`href` 改可选（App/社交条目渲染纯文本，不再伪跳转）；9 语种页脚 47 处占位链接改真实目标（contact/terms/privacy/content/blog/affiliate + tool= 修正） |
| 9 | 定价页无切换/无 FAQ/无评价 | 加 Yearly·29% off / Monthly 切换（数字价折算、NT$XXX 占位不动）+ 定价专属 9 问 FAQ（en/zh-TW 字典，缺省回退通用 FAQ）+ 复用评价区 |
| 10 | i2v 缺步骤/FAQ/CTA | i2v 移除错用的 t2v StepsHow，补 FAQ（首页通用 5 问）+ 末尾 CtaBanner |
| 11 | t2v 缺左栏/CTA/示例卡 | 新增 `ToolSidebar`（复用字典 tools 列表 + 徽标，t2v/i2v 三栏布局）+ 末尾 CtaBanner + prompt 示例卡 |
| 12 | /app/video 根路径输出繁中 | 页面改 `cookies()` 读 `vutu-locale`（缺省 EN）；`AppStudioMock` 加 locale prop（en/zh-TW/zh-CN 文案表）；9 语种字典 81 处 `/app/video` 深链改指本语言 `/{B}/app` |
| 13 | zh-TW 页简繁混排 | `GuideViralStudio`/`GrowChannelPage` 拆出繁体 `ZHTW` 字典（zh-CN 仍用简体 ZH）；zh-TW 头部 mega 菜单 26 条转繁体 |
| 6' | /en/app 混入简中 | `AppHomePage` 新增 `WORKBENCH_UI` 三语文案表（en/zh-TW/zh-CN，其余语种回落 en），替换结果卡/灯箱/工具栏/参考图/签到等 30+ 处写死中文；`SiteFooter` 版权行、`HomeSections` 复制按钮、EN 字典 recordTitle/filter/imageLead 等同步改 EN |
| - | 头部菜单 Pricing 拼出 /en/app/pricing | `SiteHeader.hrefFor` menu0/menu4 改走 appHref 与根 /pricing |

### 仍开放（未修，有意保留或需外部资源）
- 模型带 8 字母块 vs 14 图标 —— P2 有意换牌（自有 catalog 驱动，无对方图标资产）。
- Features 第 3 卡 Text-to-Video vs 源站 AI Image Generator —— P2 有意差异。
- 首屏 3 卡展示带 vs 1 卡 —— 需要设计决策/素材，未动。
- deevid `/app` 登录态 SPA 内部逐项比对 —— 源站反爬无正文，无法核。
- 像素级 CSS 比对 —— 桌面浏览器工具本会话未连接。
- 部署：2026-09-23 已上线 —— ai-cloner 经 `_deploy.py frontend`（35 文件）+ 远端 `npm run build`（BUILD_EXIT=0）+ `pm2 restart deevid`；vutu-web 经 `vutu-web/deploy/deploy.py`（release-20260923-152008 原子切换，previous=release-20260921-231724 可回滚）。线上验证：11 个 P0 新页 200、8 条深链 308、H1 空格/页脚法务链接/模板 23 卡 SSR 命中、studio+api health 200（mockProvider:false）。回滚：前端 studio 用 `python deploy/deploy.py rollback`。
