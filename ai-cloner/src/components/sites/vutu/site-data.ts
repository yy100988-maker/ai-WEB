import { de } from "./locales/de";
import { es } from "./locales/es";
import { fr } from "./locales/fr";
import { it } from "./locales/it";
import { ja } from "./locales/ja";
import { ko } from "./locales/ko";
import { pt } from "./locales/pt";
import { ru } from "./locales/ru";
import { zhCN } from "./locales/zh-CN";

export type Locale =
  | "en"
  | "zh-TW"
  | "zh-CN"
  | "ja"
  | "ko"
  | "es"
  | "fr"
  | "de"
  | "it"
  | "pt"
  | "ru";

export const LOCALES: { code: Locale; label: string; href: string }[] = [
  { code: "en", label: "English", href: "/" },
  { code: "zh-TW", label: "繁體中文", href: "/zh-TW" },
  { code: "zh-CN", label: "简体中文", href: "/zh-CN" },
  { code: "ja", label: "日本語", href: "/ja" },
  { code: "ko", label: "한국어", href: "/ko" },
  { code: "es", label: "Español", href: "/es" },
  { code: "fr", label: "Français", href: "/fr" },
  { code: "de", label: "Deutsch", href: "/de" },
  { code: "it", label: "Italiano", href: "/it" },
  { code: "pt", label: "Português", href: "/pt" },
  { code: "ru", label: "Русский", href: "/ru" },
];

export interface NavLink {
  label: string;
  href: string;
  badge?: string;
}

export interface Stat {
  value: string;
  label: string;
}

export interface WorkCard {
  title: string;
  body: string;
  cta: string;
  href: string;
}

export interface FeatureCard {
  title: string;
  body: string;
  href: string;
  tag: string;
}

export interface ToolLink {
  title: string;
  href: string;
  badge?: string;
}

export interface Faq {
  q: string;
  a: string;
}

export interface Testimonial {
  name: string;
  role: string;
  quote: string;
  avatar: string;
}

export interface AppQuick {
  t: string;
  s?: string;
  img: string;
}

export interface MegaCol {
  head: string;
  items: { t: string; d: string }[];
}

export interface AppSection {
  promo: string;
  promoPrice: string;
  promoCta: string;
  agentBtn: string;
  toolsHead: string;
  tools: string[];
  studioHead: string;
  studios: { t: string; badge?: string }[];
  assets: string;
  explore: string;
  support: string;
  language: string;
  planName: string;
  upgrade: string;
  heroA: string;
  heroB: string;
  heroSub: string;
  composerPh: string;
  chipAgent: string;
  chipSkill: string;
  chipAsk: string;
  create: string;
  quickTitle: string;
  quick: AppQuick[];
  inspTitle: string;
  backV1: string;
  trial: string;
  audioPh: string;
  canvasCap: string;
  edCap: string;
  edTrack: string;
  trTitle: string;
  trBtn: string;
  supTitle: string;
  supBody: string;
  /**
   * 个人中心「我的作品」文案。
   *
   * ⚠️ 可选：未提供时由 WorksGallery 内置兜底文案渲染（见 DEFAULT_WORKS_I18N），
   * 这样新增该页面不必一次性改 11 个 locale 文件。
   */
  works?: WorksI18n;
}

/** 「我的作品」页面文案（个人中心用） */
export interface WorksI18n {
  /** 侧边栏菜单名 */
  menu: string;
  title: string;
  /** 分类：全部 / 视频 / 图片 / 音频 / 灵感 */
  tabAll: string;
  tabVideo: string;
  tabImage: string;
  tabAudio: string;
  tabInspire: string;
  /** 顶部长图保留提示条 */
  notice: string;
  pickDate: string;
  clearDate: string;
  batch: string;
  batchExit: string;
  selectAll: string;
  download: string;
  delete: string;
  deleteConfirm: string;
  /** 删除失败的兜底提示（作品被创作记录引用时后端会拒绝） */
  deleteFailed: string;
  empty: string;
  loading: string;
  needLogin: string;
  /** 多选计数模板，{n} 会被替换（如 "已选 {n} 项"） */
  selected: string;
}

/** 未在字典中提供 works 时的兜底文案（简体中文） */
export const DEFAULT_WORKS_I18N: WorksI18n = {
  menu: "我的作品",
  title: "我的作品",
  tabAll: "全部",
  tabVideo: "视频",
  tabImage: "图片",
  tabAudio: "音频",
  tabInspire: "灵感",
  notice: "温馨提示：作品在服务器保留时间有限（1~15天不等），请及时下载到本地保存~",
  pickDate: "选择日期",
  clearDate: "清除",
  batch: "批量操作",
  batchExit: "退出批量",
  selectAll: "全选",
  download: "下载",
  delete: "删除",
  deleteConfirm: "确认删除？",
  deleteFailed: "该作品已被创作记录引用，无法删除",
  empty: "暂无作品",
  loading: "加载中…",
  needLogin: "登录后查看你的作品",
  selected: "已选 {n} 项",
};

export interface PriceTier {  name: string;
  price: string;
  period: string;
  features: string[];
  cta: string;
  hot: boolean;
}

export interface PromptTab {
  id: string;
  label: string;
}

export interface PromptCard {
  title: string;
  views: string;
  likes: string;
  img: string;
  cat: string;
}

export interface PromptLib {
  heroTitleA: string;
  heroTitleB: string;
  heroBody: string;
  heroCta: string;
  heroNote: string;
  sectionTitle: string;
  badge: string;
  tabs: PromptTab[];
  cards: PromptCard[];
}

export interface SiteDictionary {
  nav: NavLink[];
  login: string;
  startFree: string;
  heroEyebrow?: string;
  heroTitle?: string;
  heroSubtitle: string;
  h1a: string;
  h1b: string;
  composerLabel: string;
  composerPlaceholder?: string;
  composerUpload: string;
  composerCreate?: string;
  composerCreateFree: string;
  trustLine: string;
  mockWorking: string;
  mockDone: string;
  uploadHint: string;
  paramsNote: string;
  generating: string;
  createLocal: string;
  resultUnit: string;
  resultNote: string;
  dur5: string;
  dur10: string;
  composerShort: string;
  recordTitle: string;
  filterAll: string;
  filterVideo: string;
  filterImage: string;
  filterAudio: string;
  imageLead: string;
  imageHero: string;
  imageComposerPh: string;
  modelLabel: string;
  mega: MegaCol[];
  menus2: MegaCol[][];
  stats: Stat[];
  howTitle: string;
  workCards: WorkCard[];
  featuresTitle: string;
  features: FeatureCard[];
  toolsTitle?: string;
  tools?: ToolLink[];
  stepsTitle: string;
  steps: { title: string; body: string }[];
  faqTitle: string;
  faqs: Faq[];
  ctaTitle?: string;
  ctaBody?: string;
  ctaButton?: string;
  footerNote: string;
  demoBadge: string;
  composerHint: string;
  showcaseRebuild: string;
  templatesTitle: string;
  templatesBody: string;
  templatesCta: string;
  promptLib: PromptLib;
  testimonialsTitle: string;
  testimonialsBody: string;
  testimonials: Testimonial[];
  modelsTitle: string;
  modelsBody: string;
  models: string[];
  cta2Title: string;
  cta2Body: string;
  cta2Button: string;
  homeFaqTitle: string;
  homeFaqs: Faq[];
  footerCols: { head: string; links: { label: string; href: string }[] }[];
  t2vEyebrow: string;
  t2vTitle: string;
  t2vBody: string;
  t2vExtraTitle: string;
  t2vExtraBody: string;
  t2vFastTitle: string;
  t2vFastBody: string;
  imgEyebrow: string;
  imgTitle: string;
  imgBody: string;
  imgSteps: { t: string; b: string }[];
  priceEyebrow: string;
  priceTitle: string;
  priceNote: string;
  tiers: PriceTier[];
  app: AppSection;
}

const zhTW: SiteDictionary = {
  nav: [
    { label: "創作", href: "/zh-TW/text-to-video" },
    { label: "資源", href: "/zh-TW#features" },
    { label: "應用場景", href: "/zh-TW#use-cases" },
    { label: "指南", href: "/zh-TW/guide/viral-studio" },
    { label: "價格方案", href: "/zh-TW/pricing" },
  ],
  login: "登入",
  startFree: "免費開始",
  heroEyebrow: "免費 AI 影片生成器",
  heroTitle: "從想法到發布，由你的 AI 創作團隊完成。",
  heroSubtitle: "適用於影片、圖片、虛擬人、語音與音樂的一站式 AI 導演。",
  composerPlaceholder: "你想創作什麼？描述你想要的影片…",
  composerUpload: "上傳檔案",
  composerCreate: "創作",
  composerCreateFree: "免費創作",
  trustLine: "深受領先開發者與企業信賴",
  mockWorking: "正在生成…",
  mockDone: "已完成",
  uploadHint: "點擊上傳參考圖片",
  paramsNote: "自訂解析度、時長與比例",
  generating: "生成中…",
  createLocal: "創建",
  resultUnit: "成片預覽",
  resultNote: "生成結果",
  dur5: "5秒",
  dur10: "10秒",
  composerShort: "描述你想要的影片…",
  stats: [
    { value: "3000萬+", label: "創作者" },
    { value: "1億次", label: "生成量" },
    { value: "238", label: "國家/地區" },
  ],
  howTitle: "運作方式",
  workCards: [
    {
      title: "創作，不再受限於媒介",
      body: "文字、照片、影像、音訊，每種格式都能成為提示。影片、圖片、虛擬分身與音樂，Vutu 一站完成。",
      cta: "立即創作",
      href: "/app/video",
    },
    {
      title: "賦予想法以執行力",
      body: "最強大的影片 Agent。你的 AI 導演。從靈感到成片，全程自主規劃、自主創作、自主迭代。",
      cta: "立即創作",
      href: "/app/video",
    },
    {
      title: "隨心調整，精準到位",
      body: "自由拖拽，精準定位，讓每一處改動，都落在你想要的地方。Vutu Canvas 讓編輯，回歸直覺。",
      cta: "立即創作",
      href: "/app/video",
    },
  ],
  featuresTitle: "功能特色",
  features: [
    {
      title: "圖片轉影片",
      body: "上傳一張圖，幾秒內變成會動的畫面。",
      href: "/zh-TW/image-to-video",
      tag: "Image to Video",
    },
    {
      title: "AI 廣告產生器",
      body: "填入產品，一鍵產出多平台廣告影片。",
      href: "/zh-TW/app?tool=viral",
      tag: "AI Ads",
    },
    {
      title: "文字轉影片",
      body: "輸入描述，幾分鐘內得到完整影片。",
      href: "/zh-TW/text-to-video",
      tag: "Text to Video",
    },
    {
      title: "AI 虛擬人",
      body: "打造你的數位分身，會說話的主播。",
      href: "/zh-TW/app?tool=avatar",
      tag: "Avatar",
    },
    {
      title: "AI 音樂",
      body: "為影片配上專屬主題曲與音效。",
      href: "/zh-TW/app?tool=audio",
      tag: "Music",
    },
    {
      title: "文字轉語音",
      body: "自然語音旁白，多語言一次搞定。",
      href: "/zh-TW/app?tool=audio",
      tag: "TTS",
    },
  ],
  toolsTitle: "創作工具",
  tools: [
    { title: "參考生成影片", href: "/zh-TW/app?tool=video", badge: "新" },
    { title: "圖片轉影片", href: "/zh-TW/image-to-video" },
    { title: "文字轉影片", href: "/zh-TW/text-to-video" },
    { title: "AI 圖片", href: "/zh-TW/app?tool=image", badge: "GPT Image 2.5" },
    { title: "AI 圖片編輯器", href: "/zh-TW/app?tool=image" },
    { title: "AI 影片編輯器", href: "/zh-TW/app?tool=editor" },
    { title: "AI 虛擬人", href: "/zh-TW/app?tool=avatar" },
    { title: "AI 音樂", href: "/zh-TW/app?tool=audio" },
    { title: "文字轉語音", href: "/zh-TW/app?tool=audio" },
    { title: "更多工具", href: "/zh-TW/app?tool=explore" },
  ],
  stepsTitle: "如何開始使用文字轉影片生成器？",
  steps: [
    { title: "撰寫你的文字提示", body: "輸入詳細描述、腳本，甚至幾個關鍵字，概述你的影片概念。" },
    { title: "AI 處理你的文字", body: "AI 閱讀並分析文字，理解上下文、語氣和意圖。" },
    { title: "即時影片生成", body: "觀看 AI 自動創建影片——視覺、旁白與動畫一次到位。" },
    { title: "完善和自定義", body: "加入音樂、調整風格與佈局，讓影片符合你的願景。" },
    { title: "下載或分享", body: "匯出你喜歡的格式，或直接分享到社群平台。" },
  ],
  faqTitle: "常見問題",
  faqs: [
    { q: "我可以使用哪些類型的文字來生成影片？", a: "任何描述都可以：一句話、完整腳本或關鍵字清單。越具體的場景、鏡頭與氛圍描述，成片越接近預期。" },
    { q: "影片生成後我可以編輯嗎？", a: "可以。Canvas 編輯器支援拖拽調整、配樂替換與風格微調。" },
    { q: "創建影片需要多長時間？", a: "依長度與解析度而定，短片通常幾分鐘內完成。" },
    { q: "我可以將 AI 生成的影片用於商業用途嗎？", a: "以 Vutu 官方服務條款為準。" },
    { q: "文字轉影片生成器是否適合大規模製作？", a: "官方主打高產量工作流；若需批量能力，請前往 Vutu 官網了解方案與配額。" },
  ],
  ctaTitle: "在幾分鐘內從文字創建 AI 影片！",
  ctaBody: "立即開始，看你的想法如何透過 AI 變為現實。",
  ctaButton: "立即開始",
  footerNote: "學習研究用前端復刻（非官方），不提供真實生成服務。",
  demoBadge: "前端復刻演示版",
  composerHint: "使用文字、圖片、影片、音訊、文件或 URL 建立或編輯影片。",
  showcaseRebuild: "重新建立",
  templatesTitle: "使用所有熱門與流行範本進行創作",
  templatesBody:
    "看到想參與的熱門趨勢嗎？一鍵將它變成你的專屬影片，隨時準備在熱度消退前發佈。",
  templatesCta: "立即探索",
  promptLib: {
    heroTitleA: "爆款工作",
    heroTitleB: "流程庫",
    heroBody:
      "加入 Vutu，獲得免費點數。你的 AI 創意與製片團隊 — 影片、圖片、虛擬人、聲音與音樂都在這裡。選一個工作流程，變成你的。",
    heroCta: "免費開始",
    heroNote: "註冊即送免費點數 · 無需信用卡",
    sectionTitle: "所有影片 Prompt",
    badge: "TRANSFORM",
    tabs: [
      { id: "all", label: "全部" },
      { id: "game", label: "遊戲" },
      { id: "music", label: "音樂影片" },
      { id: "video", label: "影片" },
      { id: "ads", label: "廣告" },
      { id: "ai", label: "AI 趨勢" },
      { id: "story", label: "故事情節" },
    ],
    cards: [
      { title: "Million-View AI cat dance video", views: "5M", likes: "1M", img: "/sites/vutu/showcase/row-03.jpg", cat: "ai" },
      { title: "路徑相機控制", views: "600k", likes: "10k", img: "/sites/vutu/showcase/row-06.png", cat: "video" },
      { title: "驚人的深度圖參考", views: "250k", likes: "3.5k", img: "/sites/vutu/showcase/row-07.png", cat: "video" },
      { title: "遊戲 CG 演示", views: "210k", likes: "8.1k", img: "/sites/vutu/showcase/row-09.png", cat: "game" },
      { title: "冷萃咖啡 UGC 廣告", views: "180k", likes: "6.2k", img: "/sites/vutu/templates/tpl-1.png", cat: "ads" },
      { title: "時尚大片感 MV", views: "150k", likes: "5.4k", img: "/sites/vutu/templates/tpl-2.png", cat: "music" },
      { title: "科幻蟲洞逃脫", views: "120k", likes: "4.1k", img: "/sites/vutu/templates/tpl-3.jpg", cat: "story" },
      { title: "疾馳列車動作場面", views: "98k", likes: "3.2k", img: "/sites/vutu/templates/tpl-8.jpg", cat: "game" },
      { title: "Your Spider Hero Moment", views: "150k", likes: "3k", img: "/sites/vutu/showcase/row-02.jpg", cat: "ai" },
      { title: "饒舌音樂錄影帶", views: "150k", likes: "3k", img: "/sites/vutu/showcase/row-04.png", cat: "music" },
      { title: "POV: You can Climb Walls Now", views: "100k", likes: "2.5k", img: "/sites/vutu/showcase/row-05.jpg", cat: "ai" },
      { title: "Bullet Shot I", views: "80k", likes: "2.5k", img: "/sites/vutu/showcase/row-08.png", cat: "video" },
      { title: "雙角色遊戲 CG 演示", views: "60k", likes: "2k", img: "/sites/vutu/showcase/row-10.png", cat: "game" },
      { title: "POV: Superpowers Find You", views: "40k", likes: "2k", img: "/sites/vutu/templates/tpl-5.png", cat: "story" },
      { title: "A Battle beyond Imagination", views: "40k", likes: "1k", img: "/sites/vutu/templates/tpl-6.png", cat: "ai" },
      { title: "When AI Turns a Simple Click into Chaos...", views: "40k", likes: "1k", img: "/sites/vutu/templates/tpl-7.png", cat: "story" },
    ],
  },
  testimonialsTitle: "用戶怎麼說",
  testimonialsBody:
    "Vutu 以簡單好上手的 AI 影片編輯，幫助創作者快速產出內容，深受全球使用者喜愛。",
  testimonials: [
    {
      name: "Linda",
      role: "社群媒體創作者",
      quote:
        "Vutu 以簡單好上手的 AI 影片編輯，幫助創作者快速產出內容，深受全球使用者喜愛。",
      avatar: "/sites/vutu/avatars/linda.png",
    },
    {
      name: "Mia",
      role: "電商賣家",
      quote:
        "我們每個月上架超過 20 個品項，以前每次新品都要找攝影師。現在一張產品照就能跑出試穿效果、配色變體和各種背景，一次搞定。內容製作成本直接砍半。",
      avatar: "/sites/vutu/avatars/mia.png",
    },
    {
      name: "Jesse",
      role: "廣告投手",
      quote:
        "我負責一個 D2C 品牌的 UA，每週要出 10 支素材、三種語言。以前找代理商，每批要等兩週。現在 Viral Clone 一個下午就能跑出變體，Lip Sync 搞定西文和葡文配音。素材跟得上投放節奏了。",
      avatar: "/sites/vutu/avatars/jesse.png",
    },
    {
      name: "Lara",
      role: "社群媒體創作者",
      quote:
        "我在 IG 上經營一個虛擬角色。「同一張臉、不同場景」一直是我的痛點——粉絲都看出來了。把她存進 Assets 之後，每個新場景都能自動帶出一樣的臉，再也不用擔心了。",
      avatar: "/sites/vutu/avatars/lara.png",
    },
  ],
  modelsTitle: "每個任務，都有最適配的模型",
  modelsBody: "不只是模型調用，更是模型深度調優。Vutu 基於任務場景精準匹配最優模型。",
  models: [
    "Hailuo H3",
    "MiniMax H3",
    "GK Video 3",
    "Omni 1.1",
    "Omni Flash",
    "Seedance 2.0", "Seedance 2.5",
    "HappyHorse",
  ],
  cta2Title: "一個想法，Vutu 幫你實現。",
  cta2Body:
    "從 Agent 開始，在 Canvas 中創作與完善，再使用 Editor 完成作品，所有流程都在一個 Vutu 工作流程中。",
  cta2Button: "免費開始創作",
  homeFaqTitle: "常見問答",
  homeFaqs: [
    {
      q: "Vutu 2.0 和 1.0 有什麼差別？",
      a: "簡單講，1.0 是一組 AI 生成工具，2.0 則是一套完整的 AI 創作平台。1.0 原本的生成功能通通保留，2.0 再加上三個全新模組：Agent 能讀懂你的想法，幫你規劃並跑完整個創作流程；Canvas 把創作過程攤在畫布上，每個環節都可以單獨調整、重複使用；Assets 則會幫你把素材、角色和工作流存起來，下次直接拿來用就好。再加上多模態輸入輸出和更聰明的模型調度，從想法到成品，一次就搞定。",
    },
    {
      q: "我可以自訂影片輸出嗎？",
      a: "可以！Vutu Canvas 讓你以像素級精準度拖曳、編排並微調影片中的每個元素。你可以調整時長、解析度、畫面比例、風格等更多設定。",
    },
    {
      q: "AI 影片產生器有免費試用嗎？",
      a: "有，Vutu 提供免費方案，讓你用固定額度的點數建立影片。你可以免費生成第一批影片，當你需要更多時，再升級到付費方案。",
    },
    {
      q: "我要如何開始使用 AI 影片產生器？",
      a: "只要註冊免費帳號，在提示框中輸入你想創作的內容，選擇想要的設定，然後點擊「免費創作」。你的 AI 生成影片幾秒內就會完成。",
    },
    {
      q: "我可以將 AI 生成的影片用於商業用途嗎？",
      a: "可以！所有付費方案所建立的影片都附帶完整商業使用權。你可以將它們用於廣告、社群媒體、行銷活動，以及任何其他商業用途。",
    },
  ],
  footerCols: [
    {
      head: "創作工具",
      links: [
        { label: "AI 創作 Agent", href: "/zh-TW/app" },
        { label: "爆款工作室", href: "/zh-TW/guide/viral-studio" },
        { label: "AI 畫布", href: "/zh-TW/app?tool=canvas" },
        { label: "AI 編輯器", href: "/zh-TW/app?tool=editor" },
        { label: "AI 影片產生器", href: "/zh-TW/app?tool=video" },
        { label: "AI 圖片產生器", href: "/zh-TW/app?tool=image" },
        { label: "AI 音樂生成器", href: "/zh-TW/app?tool=audio" },
        { label: "AI 虛擬分身", href: "/zh-TW/app?tool=avatar" },
        { label: "文字轉語音", href: "/zh-TW/app?tool=audio" },
      ],
    },
    {
      head: "生成工具",
      links: [
        { label: "圖片轉影片", href: "/zh-TW/image-to-video" },
        { label: "文字轉影片", href: "/zh-TW/text-to-video" },
        { label: "影片轉影片", href: "/zh-TW/app?tool=video" },
        { label: "參考圖轉影片", href: "/zh-TW/image-to-video" },
        { label: "AI 圖片編輯器", href: "/zh-TW/app?tool=image" },
        { label: "AI 影片編輯器", href: "/zh-TW/app?tool=editor" },
        { label: "更多", href: "/zh-TW#features" },
      ],
    },
    {
      head: "公司",
      links: [
        { label: "聯絡我們", href: "/zh-TW/app" },
        { label: "價格方案", href: "/zh-TW/pricing" },
        { label: "服務條款", href: "/zh-TW/pricing" },
        { label: "隱私權政策", href: "/zh-TW/pricing" },
        { label: "內容政策", href: "/zh-TW/pricing" },
        { label: "部落格", href: "/zh-TW/app" },
        { label: "聯盟計畫", href: "/zh-TW/app" },
      ],
    },
    {
      head: "下載 App",
      links: [
        { label: "App Store", href: "/zh-TW/pricing" },
        { label: "Google Play", href: "/zh-TW/pricing" },
      ],
    },
    {
      head: "最新動態",
      links: [
        { label: "Discord", href: "/zh-TW/pricing" },
        { label: "Twitter", href: "/zh-TW/pricing" },
        { label: "Youtube", href: "/zh-TW/pricing" },
        { label: "Instagram", href: "/zh-TW/pricing" },
      ],
    },
  ],
  h1a: "從想法到發布，",
  h1b: "由你的 AI 創作團隊完成。",
  composerLabel: "你想創作什麼？",
  t2vEyebrow: "創作工具",
  t2vTitle: "文字轉影片 AI",
  t2vBody: "即時影片創建：輸入文字，幾分鐘內得到完整影片。",
  t2vExtraTitle: "從提示中獲得最逼真的影片效果",
  t2vExtraBody:
    "逼真動畫、流暢過渡與貼近現實的動作，和環境行為高度一致。",
  t2vFastTitle: "快速且可擴展",
  t2vFastBody: "無論一部還是數百部，流程始終快速、高效且具成本效益。",
  imgEyebrow: "創作工具",
  imgTitle: "圖片轉影片",
  imgBody: "上傳一張圖，幾秒內變成會動的畫面。",
  imgSteps: [
    { t: "上傳照片", b: "支援常見圖片格式，本地選檔即可。" },
    { t: "描述動態", b: "寫下希望的運鏡、表情與氛圍。" },
    { t: "得到短片", b: "演示版以佔位成片呈現結果。" },
  ],
  priceEyebrow: "價格方案",
  priceTitle: "選擇適合你的創作方案",
  priceNote:
    "本頁僅還原價格頁佈局，金額為示意佔位，不構成報價。實際方案與點數請以 ai.vutu.cc 官網為準。",
  tiers: [
    {
      name: "免費版",
      price: "NT$0",
      period: "/ 永久",
      features: ["每日限量生成點數", "720P 短片匯出", "浮水印成片", "社群支援"],
      cta: "免費開始",
      hot: false,
    },
    {
      name: "專業版",
      price: "NT$XXX",
      period: "/ 月（示意）",
      features: ["更高解析度與時長", "去浮水印", "優先生成佇列", "Canvas 完整編輯"],
      cta: "選擇專業版",
      hot: true,
    },
    {
      name: "企業版",
      price: "聯絡我們",
      period: "",
      features: ["團隊協作與權限", "API 與批量工作流", "專屬客服", "客製化合約"],
      cta: "聯絡銷售",
      hot: false,
    },
  ],
  app: {
    promo: "新用戶享 50% 折扣！",
    promoPrice: "每月只要 $7 + 200 點數",
    promoCta: "立即訂閱",
    agentBtn: "使用 Agent 創作",
    toolsHead: "AI 工具",
    tools: ["AI 影片", "AI 圖像", "AI 音訊", "畫布", "編輯器"],
    studioHead: "AI 工作室",
    studios: [{ t: "爆款工作室", badge: "New" }, { t: "口播虛擬人" }, { t: "影片翻譯" }],
    assets: "資產",
    explore: "探索",
    support: "支援",
    language: "語言",
    planName: "免費方案",
    upgrade: "升級",
    heroA: "從想法到發布。",
    heroB: "交給 Vutu Agent 就好。",
    heroSub: "適用於影片、圖片、虛擬人、語音與音樂的一站式 AI 導演。",
    composerPh: "使用文字、圖片、影片、音訊、文件或網址建立任何內容。",
    chipAgent: "Agent",
    chipSkill: "技能",
    chipAsk: "詢問",
    create: "創作",
    quickTitle: "快速開始",
    quick: [
      { t: "AI 短劇", s: "制定完整的短劇製作計畫", img: "/sites/vutu/showcase/row-01.png" },
      { t: "角色設計", img: "/sites/vutu/templates/tpl-3.jpg" },
      { t: "漫畫", img: "/sites/vutu/showcase/row-05.jpg" },
      { t: "商品圖設計", s: "批量建立一致的產品圖像", img: "/sites/vutu/showcase/show-1.png" },
      { t: "UGC 廣告", s: "建立平台原生創作者廣告", img: "/sites/vutu/showcase/row-02.jpg" },
      { t: "URL 轉影片", img: "/sites/vutu/showcase/row-06.png" },
      { t: "PDF 轉影片", img: "/sites/vutu/showcase/row-07.png" },
    ],
    inspTitle: "靈感",
    backV1: "Vutu 1.0",
    audioPh: "描述你想要的聲音、音樂或旁白…",
    canvasCap: "畫布：把創作過程攤開，每一步都可單獨調整",
    edCap: "編輯器：時間線",
    edTrack: "軌道",
    trTitle: "影片翻譯",
    trBtn: "開始翻譯（演示）",
    supTitle: "支援",
    supBody: "需要幫助？演示版僅提供佈局還原，不連通客服系統。",
    trial: "免費試用",
    works: {
      menu: "我的作品",
      title: "我的作品",
      tabAll: "全部",
      tabVideo: "影片",
      tabImage: "圖片",
      tabAudio: "音訊",
      tabInspire: "靈感",
      notice: "溫馨提示：作品在伺服器保留時間有限（1~15天不等），請及時下載到本地保存~",
      pickDate: "選擇日期",
      clearDate: "清除",
      batch: "批次操作",
      batchExit: "退出批次",
      selectAll: "全選",
      download: "下載",
      delete: "刪除",
      deleteConfirm: "確認刪除？",
      deleteFailed: "該作品已被創作紀錄引用，無法刪除",
      empty: "暫無作品",
      loading: "載入中…",
      needLogin: "登入後查看你的作品",
      selected: "已選 {n} 項",
    },
  },
  recordTitle: "創作紀錄",
  filterAll: "全部",
  filterVideo: "影片",
  filterImage: "圖片",
  filterAudio: "音訊",
  imageLead: "一段文字或一張參考圖，生成你想要的畫面。",
  imageHero: "AI 圖像",
  imageComposerPh: "使用文字或圖片建立或編輯圖片",
  modelLabel: "模型",
  menus2: [
    [
  { head: "資源", items: [
        { t: "提示詞庫", d: "瀏覽並重複使用高品質提示詞" },
        { t: "CLI 與 MCP", d: "在命令列與代理中呼叫 Vutu" },
        { t: "聯絡客服", d: "取得協助與答疑" },
      ] },
    ],
    [
  { head: "應用場景", items: [
        { t: "經營你的頻道", d: "" },
      ] },
    ],
    [
  { head: "指南", items: [
        { t: "爆款工作室", d: "" },
      ] },
    ],
    [
  { head: "價格方案", items: [
        { t: "免費版", d: "每日點數，隨時試做" },
        { t: "專業版", d: "更高解析度與去浮水印" },
        { t: "企業版", d: "團隊協作與 API" },
      ] },
    ],
  ],
  mega: [
    { head: "工具", items: [
      { t: "AI 创作 Agent", d: "使用 AI 規劃、創作與完善" },
      { t: "脚本", d: "从现成的工作流程开始" },
      { t: "创作画布", d: "整理构想并重复使用视觉工作流程" },
      { t: "时间轴编辑器", d: "剪辑、加上字幕、编排并完成影片" },
    ] },
    { head: "AI 影片", items: [
      { t: "图片转影片", d: "将图片制作成动态影片" },
      { t: "文字转影片", d: "根据提示词生成影片" },
      { t: "网址转影片", d: "将任何网页转换成影片" },
      { t: "影片转影片", d: "重新设计、编辑或强化现有影片素材" },
      { t: "内容转影片", d: "使用 Agent 从脚本、文件或媒体开始创作" },
      { t: "影片深度图", d: "把任何影片转成深度图" },
    ] },
    { head: "AI 图像", items: [
      { t: "文字转图片", d: "根据文字创作图片" },
      { t: "图片转图片", d: "重新设计或转换图片" },
      { t: "AI 背景移除工具", d: "移除任何图片的背景" },
      { t: "AI 图片升级工具", d: "将图片提升至更高解析度" },
    ] },
    { head: "AI 音讯", items: [
      { t: "AI 音乐", d: "生成原创音乐" },
      { t: "文字转语音", d: "将文字转换为自然语音" },
    ] },
    { head: "AI 工作室", items: [
      { t: "爆款工作室", d: "创作并重新混合热门影片" },
      { t: "AI 短剧", d: "根据你的想法打造一部短剧" },
      { t: "口播虚拟人", d: "让虚拟分身自然说话" },
      { t: "影片翻译", d: "翻译语音、字幕并同步嘴型" },
    ] },
  ],
};

const en: SiteDictionary = {
  nav: [
    { label: "Create", href: "/en/app?tool=video" },
    { label: "Resources", href: "/#features" },
    { label: "Use Cases", href: "/#use-cases" },
    { label: "Guide", href: "/guide/viral-studio" },
    { label: "Pricing", href: "/en/app" },
  ],
  login: "Login",
  startFree: "Start For Free",
  heroEyebrow: "Free AI Video Generator",
  heroTitle: "Your AI Creative & Production Team, From Idea to Publish.",
  heroSubtitle: "All-in-one AI director for video, image, avatar, voice, and music.",
  composerPlaceholder: "What do you want to create? Describe your video…",
  composerUpload: "Upload Files",
  composerCreate: "Create",
  composerCreateFree: "Create Free",
  trustLine: "Trusted by leading developers and enterprises",
  mockWorking: "Generating…",
  mockDone: "Done",
  uploadHint: "Click to upload a reference image",
  paramsNote: "Tune resolution, length, and ratio",
  generating: "Generating…",
  createLocal: "Create",
  resultUnit: "Preview",
  resultNote: "Result",
  dur5: "5s",
  dur10: "10s",
  composerShort: "Describe your video…",
  stats: [
    { value: "30M+", label: "Creators" },
    { value: "100M+", label: "Generations" },
    { value: "238", label: "Countries & Regions" },
  ],
  howTitle: "How It Works",
  workCards: [
    {
      title: "Create with anything",
      body: "Text, photos, video, audio — every format is a prompt. Video, images, avatars, and music — Vutu, all in one.",
      cta: "Create Now",
      href: "/app/video",
    },
    {
      title: "Turn ideas into action",
      body: "The most powerful Video Agent. Your AI director. From idea to final cut — it plans, creates, and iterates, all on its own.",
      cta: "Create Now",
      href: "/app/video",
    },
    {
      title: "Adjust anything, exactly as intended",
      body: "Drag, drop, and place every edit exactly where you want it. Vutu Canvas makes editing feel instinctive.",
      cta: "Create Now",
      href: "/app/video",
    },
  ],
  featuresTitle: "Features",
  features: [
    {
      title: "Image to Video",
      body: "Drop in a photo and watch it come to life in seconds.",
      href: "/en/app?tool=video",
      tag: "Image to Video",
    },
    {
      title: "AI Ads",
      body: "Drop in a product and get ad videos for every platform.",
      href: "/en/app?tool=viral",
      tag: "AI Ads",
    },
    {
      title: "Text to Video",
      body: "Type a description, get a full video in minutes.",
      href: "/en/app?tool=video",
      tag: "Text to Video",
    },
    {
      title: "AI Avatar",
      body: "Your digital double — a presenter that speaks for you.",
      href: "/en/app?tool=avatar",
      tag: "Avatar",
    },
    {
      title: "AI Music",
      body: "Original themes and SFX scored for your cut.",
      href: "/en/app?tool=audio",
      tag: "Music",
    },
    {
      title: "Text to Speech",
      body: "Natural voice-over in many languages, in one pass.",
      href: "/en/app?tool=audio",
      tag: "TTS",
    },
  ],
  toolsTitle: "Creation Tools",
  tools: [
    { title: "Reference to Video", href: "/en/app?tool=video", badge: "New" },
    { title: "Image to Video", href: "/en/app?tool=video" },
    { title: "Text to Video", href: "/en/app?tool=video" },
    { title: "AI Image", href: "/en/app?tool=image", badge: "GPT Image 2.5" },
    { title: "AI Image Editor", href: "/en/app?tool=image" },
    { title: "AI Video Editor", href: "/en/app?tool=editor" },
    { title: "AI Avatar", href: "/en/app?tool=avatar" },
    { title: "AI Music", href: "/en/app?tool=audio" },
    { title: "Text to Speech", href: "/en/app?tool=audio" },
    { title: "More tools", href: "/en/app?tool=explore" },
  ],
  stepsTitle: "How to start with the text-to-video generator?",
  steps: [
    { title: "Write your prompt", body: "Enter a detailed description, a script, or just a few keywords." },
    { title: "AI reads your text", body: "The model parses context, tone, and intent." },
    { title: "Instant generation", body: "Watch visuals, narration, and animation come together." },
    { title: "Refine and customize", body: "Add music, restyle, and adjust the layout to your vision." },
    { title: "Download or share", body: "Export your favorite format or post straight to social." },
  ],
  faqTitle: "FAQ",
  faqs: [
    { q: "What kinds of text can I use?", a: "Anything from one line to a full script. Concrete scenes, shots, and moods give the closest results." },
    { q: "Can I edit after generation?", a: "Yes — the Canvas editor supports drag-to-adjust, music swap, and restyle." },
    { q: "How long does it take?", a: "Short clips usually finish in minutes." },
    { q: "Can I use generated videos commercially?", a: "Vutu's official terms apply." },
    { q: "Is it suitable for bulk production?", a: "The official product targets high-volume workflows — see ai.vutu.cc for plans and quotas." },
  ],
  ctaTitle: "Create AI videos from text in minutes!",
  ctaBody: "Start now and watch your idea come alive with AI.",
  ctaButton: "Get Started",
  footerNote: "Study-only front-end replica (unofficial). No real generation service.",
  demoBadge: "Front-end replica demo",
  composerHint: "Create or edit videos with text, images, video, audio, files, or a URL.",
  showcaseRebuild: "Recreate",
  templatesTitle: "Create with trending templates",
  templatesBody: "See a trend you want to join? Turn it into your own video in one click.",
  templatesCta: "Explore now",
  promptLib: {
    heroTitleA: "The Viral ",
    heroTitleB: "Workflow Library",
    heroBody:
      "Join Vutu and get free credits. Your AI creative & production team — video, image, avatar, voice, and music in one place. Pick a workflow below and make it yours.",
    heroCta: "Start For Free",
    heroNote: "Free credits on signup · No credit card required",
    sectionTitle: "All video prompts",
    badge: "TRANSFORM",
    tabs: [
      { id: "all", label: "All" },
      { id: "game", label: "Games" },
      { id: "music", label: "Music videos" },
      { id: "video", label: "Videos" },
      { id: "ads", label: "Ads" },
      { id: "ai", label: "AI Trends" },
      { id: "story", label: "Story plots" },
    ],
    cards: [
      { title: "Million-View AI cat dance video", views: "5M", likes: "1M", img: "/sites/vutu/showcase/row-03.jpg", cat: "ai" },
      { title: "Path camera control", views: "600k", likes: "10k", img: "/sites/vutu/showcase/row-06.png", cat: "video" },
      { title: "Amazing depth-map reference", views: "250k", likes: "3.5k", img: "/sites/vutu/showcase/row-07.png", cat: "video" },
      { title: "Game CG showcase", views: "210k", likes: "8.1k", img: "/sites/vutu/showcase/row-09.png", cat: "game" },
      { title: "Cold-brew coffee UGC ad", views: "180k", likes: "6.2k", img: "/sites/vutu/templates/tpl-1.png", cat: "ads" },
      { title: "Fashion-film MV", views: "150k", likes: "5.4k", img: "/sites/vutu/templates/tpl-2.png", cat: "music" },
      { title: "Sci-fi wormhole escape", views: "120k", likes: "4.1k", img: "/sites/vutu/templates/tpl-3.jpg", cat: "story" },
      { title: "Speeding-train action scene", views: "98k", likes: "3.2k", img: "/sites/vutu/templates/tpl-8.jpg", cat: "game" },
      { title: "Your Spider Hero Moment", views: "150k", likes: "3k", img: "/sites/vutu/showcase/row-02.jpg", cat: "ai" },
      { title: "Rap music video", views: "150k", likes: "3k", img: "/sites/vutu/showcase/row-04.png", cat: "music" },
      { title: "POV: You can Climb Walls Now", views: "100k", likes: "2.5k", img: "/sites/vutu/showcase/row-05.jpg", cat: "ai" },
      { title: "Bullet Shot I", views: "80k", likes: "2.5k", img: "/sites/vutu/showcase/row-08.png", cat: "video" },
      { title: "Dual-character game CG demo", views: "60k", likes: "2k", img: "/sites/vutu/showcase/row-10.png", cat: "game" },
      { title: "POV: Superpowers Find You", views: "40k", likes: "2k", img: "/sites/vutu/templates/tpl-5.png", cat: "story" },
      { title: "A Battle beyond Imagination", views: "40k", likes: "1k", img: "/sites/vutu/templates/tpl-6.png", cat: "ai" },
      { title: "When AI Turns a Simple Click into Chaos...", views: "40k", likes: "1k", img: "/sites/vutu/templates/tpl-7.png", cat: "story" },
    ],
  },
  testimonialsTitle: "What users say",
  testimonialsBody: "Creators around the world ship content faster with Vutu.",
  testimonials: [
    {
      name: "Linda",
      role: "Social creator",
      quote:
        "Vutu's easy AI video editing helps me ship content fast — loved by users worldwide.",
      avatar: "/sites/vutu/avatars/linda.png",
    },
    {
      name: "Mia",
      role: "E-commerce seller",
      quote:
        "We list 20+ items a month. One product photo now gives me try-ons, color variants, and backgrounds in one pass. Production cost cut in half.",
      avatar: "/sites/vutu/avatars/mia.png",
    },
    {
      name: "Jesse",
      role: "Media buyer",
      quote:
        "10 creatives a week in three languages. Viral Clone ships variants in an afternoon and Lip Sync covers Spanish and Portuguese.",
      avatar: "/sites/vutu/avatars/jesse.png",
    },
    {
      name: "Lara",
      role: "Social creator",
      quote:
        "I run a virtual persona on IG. Same face, new scenes, every time — saved to Assets, never a mismatch again.",
      avatar: "/sites/vutu/avatars/lara.png",
    },
  ],
  modelsTitle: "The right model for every task",
  modelsBody: "More than model calls — deeply tuned matching per scenario.",
  models: [
    "Hailuo H3",
    "MiniMax H3",
    "GK Video 3",
    "Omni 1.1",
    "Omni Flash",
    "Seedance 2.0", "Seedance 2.5",
    "HappyHorse",
  ],
  cta2Title: "One idea. Vutu makes it real.",
  cta2Body: "Start with Agent, refine in Canvas, finish in Editor — one workflow.",
  cta2Button: "Start creating free",
  homeFaqTitle: "FAQ",
  homeFaqs: [
    {
      q: "What is the difference between Vutu 2.0 and 1.0?",
      a: "1.0 is a set of AI generation tools; 2.0 is a complete creative platform with Agent, Canvas, and Assets modules, plus multimodal I/O and smarter model routing.",
    },
    {
      q: "Can I customize video output?",
      a: "Yes — Canvas gives pixel-precise drag-and-drop control over duration, resolution, aspect ratio, and style.",
    },
    {
      q: "Is there a free trial?",
      a: "Yes — a free plan with a fixed credit quota. Upgrade when you need more.",
    },
    {
      q: "How do I start?",
      a: "Register a free account, type in the prompt box, pick settings, and hit create.",
    },
    {
      q: "Can I use generated videos commercially?",
      a: "Yes — all paid plans include full commercial rights.",
    },
  ],
  footerCols: [
    {
      head: "Create",
      links: [
        { label: "AI Agent", href: "/en/app" },
        { label: "AI Canvas", href: "/en/app?tool=canvas" },
        { label: "AI Editor", href: "/en/app?tool=editor" },
        { label: "Text to Speech", href: "/en/app?tool=audio" },
      ],
    },
    {
      head: "Generate",
      links: [
        { label: "Image to Video", href: "/en/app?tool=video" },
        { label: "Text to Video", href: "/en/app?tool=video" },
        { label: "More", href: "/#features" },
      ],
    },
    {
      head: "Company",
      links: [
        { label: "Contact", href: "/en/app" },
        { label: "Pricing", href: "/en/app" },
        { label: "Terms", href: "/en/app" },
        { label: "Privacy", href: "/en/app" },
      ],
    },
  ],
  h1a: "From Idea to Publish,",
  h1b: "By Your AI Creative Team.",
  composerLabel: "What do you want to create?",
  t2vEyebrow: "Creation tools",
  t2vTitle: "Text to Video AI",
  t2vBody: "Instant creation: type text, get a full video in minutes.",
  t2vExtraTitle: "The most realistic results from a prompt",
  t2vExtraBody: "Lifelike animation, smooth transitions, and natural motion.",
  t2vFastTitle: "Fast and scalable",
  t2vFastBody: "One video or hundreds — always fast and cost-efficient.",
  imgEyebrow: "Creation tools",
  imgTitle: "Image to Video",
  imgBody: "Upload a photo, get motion in seconds.",
  imgSteps: [
    { t: "Upload a photo", b: "Common formats, picked locally." },
    { t: "Describe motion", b: "Camera, expression, mood." },
    { t: "Get a clip", b: "Demo shows a placeholder result." },
  ],
  priceEyebrow: "Pricing",
  priceTitle: "Pick the plan that fits",
  priceNote: "Layout replica with placeholder prices. See ai.vutu.cc for real plans.",
  tiers: [
    {
      name: "Free",
      price: "$0",
      period: "/ forever",
      features: ["Daily limited credits", "720P exports", "Watermarked", "Community support"],
      cta: "Start free",
      hot: false,
    },
    {
      name: "Pro",
      price: "$XX",
      period: "/ mo (demo)",
      features: ["Higher resolution", "No watermark", "Priority queue", "Full Canvas"],
      cta: "Choose Pro",
      hot: true,
    },
    {
      name: "Business",
      price: "Contact us",
      period: "",
      features: ["Team workspace", "API & bulk", "Dedicated support", "Custom contract"],
      cta: "Contact sales",
      hot: false,
    },
  ],
  app: {
    promo: "50% off for new users!",
    promoPrice: "Only $7/mo + 200 credits",
    promoCta: "Subscribe",
    agentBtn: "Create with Agent",
    toolsHead: "AI tools",
    tools: ["AI Video", "AI Image", "AI Audio", "Canvas", "Editor"],
    studioHead: "AI studio",
    studios: [{ t: "Viral Studio", badge: "New" }, { t: "Talking Avatar" }, { t: "Video Translate" }],
    assets: "Assets",
    explore: "Explore",
    support: "Support",
    language: "Language",
    planName: "Free plan",
    upgrade: "Upgrade",
    heroA: "From idea to publish.",
    heroB: "Leave it to Vutu Agent.",
    heroSub: "All-in-one AI director for video, image, avatar, voice, and music.",
    composerPh: "Create anything with text, images, video, audio, files, or URLs.",
    chipAgent: "Agent",
    chipSkill: "Skills",
    chipAsk: "Ask",
    create: "Create",
    quickTitle: "Quick start",
    quick: [
      { t: "AI Drama", s: "Plan a full short-drama production", img: "/sites/vutu/showcase/row-01.png" },
      { t: "Character", img: "/sites/vutu/templates/tpl-3.jpg" },
      { t: "Comics", img: "/sites/vutu/showcase/row-05.jpg" },
      { t: "Product shots", s: "Consistent product images in bulk", img: "/sites/vutu/showcase/show-1.png" },
      { t: "UGC Ads", s: "Native creator ads per platform", img: "/sites/vutu/showcase/row-02.jpg" },
      { t: "URL to Video", img: "/sites/vutu/showcase/row-06.png" },
      { t: "PDF to Video", img: "/sites/vutu/showcase/row-07.png" },
    ],
    inspTitle: "Inspiration",
    backV1: "Vutu 1.0",
    audioPh: "Describe the sound, music, or voice-over…",
    canvasCap: "Canvas: unfold the process, tune each step",
    edCap: "Editor: timeline",
    edTrack: "Track",
    trTitle: "Video translate",
    trBtn: "Translate (demo)",
    supTitle: "Support",
    supBody: "Need help? The demo only replicates layout, no live support.",
    trial: "Free trial",
    works: {
      menu: "My Works",
      title: "My Works",
      tabAll: "All",
      tabVideo: "Video",
      tabImage: "Image",
      tabAudio: "Audio",
      tabInspire: "Inspire",
      notice:
        "Heads-up: works are kept on the server for a limited time (1–15 days depending on plan). Please download anything you want to keep.",
      pickDate: "Pick date",
      clearDate: "Clear",
      batch: "Batch",
      batchExit: "Exit batch",
      selectAll: "Select all",
      download: "Download",
      delete: "Delete",
      deleteConfirm: "Confirm delete?",
      deleteFailed: "This work is referenced by a creation record and cannot be deleted.",
      empty: "No works yet",
      loading: "Loading…",
      needLogin: "Sign in to see your works",
      selected: "{n} selected",
    },
  },
  recordTitle: "創作紀錄",
  filterAll: "全部",
  filterVideo: "影片",
  filterImage: "圖片",
  filterAudio: "音訊",
  imageLead: "一段文字或一張參考圖，生成你想要的畫面。",
  imageHero: "AI 圖像",
  imageComposerPh: "使用文字或圖片建立或編輯圖片",
  modelLabel: "Model",
  menus2: [
    [
    { head: "Resources", items: [
      { t: "Prompt library", d: "Browse and reuse strong prompts" },
      { t: "CLI & MCP", d: "Drive Vutu from your terminal" },
      { t: "Contact support", d: "Get help and answers" },
    ] },
    ],
    [
    { head: "Use cases", items: [
      { t: "Grow Your Channel", d: "" },
    ] },
    ],
    [
    { head: "Guide", items: [
      { t: "Viral Studio", d: "" },
    ] },
    ],
    [
    { head: "Pricing", items: [
      { t: "Free", d: "Daily credits to try it out" },
      { t: "Pro", d: "Higher resolution, no watermark" },
      { t: "Business", d: "Team workspace and API" },
    ] },
    ],
  ],
  mega: [
    { head: "Tools", items: [
      { t: "AI Agent", d: "Plan, create, and refine with AI" },
      { t: "Scripts", d: "Start from a ready workflow" },
      { t: "Canvas", d: "Organize ideas and reuse workflows" },
      { t: "Timeline editor", d: "Cut, subtitle, and finish" },
    ] },
    { head: "AI Video", items: [
      { t: "Image to video", d: "Turn images into motion" },
      { t: "Text to video", d: "Generate video from a prompt" },
      { t: "URL to video", d: "Convert a web page into video" },
      { t: "Video to video", d: "Redesign or enhance footage" },
      { t: "Content to video", d: "Start from script, file, or media" },
      { t: "Video depth map", d: "Turn video into depth" },
    ] },
    { head: "AI Image", items: [
      { t: "Text to image", d: "Create images from text" },
      { t: "Image to image", d: "Redesign or convert" },
      { t: "Background remover", d: "Remove any background" },
      { t: "Image upscaler", d: "Raise the resolution" },
    ] },
    { head: "AI Audio", items: [
      { t: "AI Music", d: "Generate original music" },
      { t: "Text to speech", d: "Turn text into natural voice" },
    ] },
    { head: "AI Studio", items: [
      { t: "Viral studio", d: "Create and remix trending video" },
      { t: "AI Drama", d: "Build a short drama" },
      { t: "Talking avatar", d: "Make an avatar speak" },
      { t: "Video translate", d: "Voice, subs, and lip sync" },
    ] },
  ],
};

export const siteContent: Record<Locale, SiteDictionary> = {
  en,
  "zh-TW": zhTW,
  "zh-CN": zhCN,
  ja,
  ko,
  es,
  fr,
  de,
  it,
  pt,
  ru,
};
