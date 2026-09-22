/**
 * 快速开始模板（PRD §8.2 `GET /v1/catalog/templates`）。
 *
 * 背景：前端 `app.quick[]` 目前硬编码 7 个模板（`AppHomePage.tsx` / locale 字典），
 * PRD §10 要求改为由后端下发。本期先由**后端常量**返回，字段结构与前端深链预填完全兼容：
 *
 * ```
 * { id, title, sub, img, prompt, refImgUrl, capability, modelId?, params? }
 * ```
 *
 * 深链闭环（PRD §8.8）：点击卡片 → `/app?prompt={title}&img={imgUrl}` →
 * 前端预填 prompt + refImg 预览 → 提交时若 img 非站内资产，先调
 * `POST /v1/assets/import-url` 转 assetId 再进入任务链路。
 * 所以 `prompt` 必须是**真实可用**的中文提示词，`refImgUrl` 必须是公网可达图片。
 *
 * ⚠️ 约束：
 *  - `modelId` 只填**会对客展示**的模型（`active=true && enabled=true`），
 *    这里留空或填 code，routes.ts 会在返回前校验该模型确实上架，否则剔除该字段；
 *  - 不在模板里写任何上游内部代号（`tt-` / `guanfang` / `kling` 等，PRD §8.2 硬性规则）。
 */

import type { Capability } from '../../core/types.js';

export interface CatalogTemplate {
  id: string;
  title: string;
  sub: string;
  img: string;
  prompt: string;
  refImgUrl: string;
  capability: Capability;
  modelId?: string;
  params?: Record<string, string | number | boolean>;
}

/**
 * 7 个内置模板，与前端 `app.quick[]` 的 7 项一一对应
 * （AI 短剧 / 角色设计 / 漫画 / 商品图设计 / UGC 广告 / URL 转视频 / PDF 转视频）。
 *
 * img / refImgUrl 沿用前端站点静态资源路径（Next `/public/sites/vutu/...`），
 * 保证前端不改 UI 即可直接渲染；生产环境应替换为对象存储 CDN 基址（配置项留待 Phase）。
 */
export const BUILTIN_TEMPLATES: readonly CatalogTemplate[] = [
  {
    id: 'tpl_ai_short_drama',
    title: 'AI 短剧',
    sub: '制定完整的短剧制作计划',
    img: '/sites/vutu/showcase/row-01.png',
    refImgUrl: '/sites/vutu/showcase/row-01.png',
    capability: 'text_to_video',
    prompt:
      '电影感短剧镜头：一位穿深色风衣的年轻侦探在雨夜的老城区巷子里快步前行，霓虹灯牌在湿滑地面上反射出冷暖交错的光斑，镜头从中景缓慢推近至面部特写，浅景深，35mm 胶片质感，低饱和蓝橙对比色调，雨滴与雾气清晰可见，缓慢推轨运镜，无背景音乐',
  },
  {
    id: 'tpl_character_design',
    title: '角色设计',
    sub: '生成统一风格的角色三视图',
    img: '/sites/vutu/templates/tpl-3.jpg',
    refImgUrl: '/sites/vutu/templates/tpl-3.jpg',
    capability: 'text_to_image',
    prompt:
      '角色设计三视图：一位银白色短发的年轻女剑士，身穿深蓝色中式立领战袍配金属护肩，腰间挂着细长佩剑，正面、侧面、背面三个视角并排展示，纯白背景，均匀布光，游戏原画风格，线条干净，色彩扁平，全身完整可见，细节清晰',
  },
  {
    id: 'tpl_comic_panel',
    title: '漫画',
    sub: '生成日式黑白漫画分镜',
    img: '/sites/vutu/showcase/row-05.jpg',
    refImgUrl: '/sites/vutu/showcase/row-05.jpg',
    capability: 'text_to_image',
    prompt:
      '日式黑白漫画分镜页：一个少年站在天台边缘，风吹起他的校服外套，远处是黄昏下的城市天际线，画面用大面积网点纸表现天空，人物表情坚毅，粗细分明的墨线，动感速度线从右下向左上延伸，对话气泡留空，整页四格布局',
  },
  {
    id: 'tpl_product_shot',
    title: '商品图设计',
    sub: '批量建立一致的产品图像',
    img: '/sites/vutu/showcase/show-1.png',
    refImgUrl: '/sites/vutu/showcase/show-1.png',
    capability: 'text_to_image',
    prompt:
      '电商产品主图：一瓶磨砂质感的透明护肤精华液放置在浅灰色大理石台面上，瓶身有柔和的高光反射，背景是渐变的米白色，旁边点缀两片新鲜绿叶与几滴水珠，柔光箱布光，45 度俯视视角，商业静物摄影风格，画面干净，主体居中，高清细节',
  },
  {
    id: 'tpl_ugc_ad',
    title: 'UGC 广告',
    sub: '建立平台原生创作者广告',
    img: '/sites/vutu/showcase/row-02.jpg',
    refImgUrl: '/sites/vutu/showcase/row-02.jpg',
    capability: 'text_to_video',
    prompt:
      '竖屏 UGC 风格广告：一位年轻女生坐在明亮的居家客厅里，手持一杯冒热气的冷萃咖啡对着镜头自然微笑说话，手机自拍固定机位，室内自然光，画面轻微手持晃动，真实生活感，暖色调，背景有绿植与书架，口型自然，运镜几乎静止',
  },
  {
    id: 'tpl_url_to_video',
    title: 'URL 转视频',
    sub: '把网页内容转成宣传短片',
    img: '/sites/vutu/showcase/row-06.png',
    refImgUrl: '/sites/vutu/showcase/row-06.png',
    capability: 'text_to_video',
    prompt:
      '科技产品宣传短片：镜头从深色背景中缓缓拉出，一台银灰色轻薄笔记本电脑悬浮在画面中央缓慢旋转，表面流动着细密的蓝色数据光带，随后屏幕亮起显示简洁的产品界面，背景有缓慢流动的粒子光点，冷色调，科技感强烈，平滑运镜，商业广告质感',
  },
  {
    id: 'tpl_pdf_to_video',
    title: 'PDF 转视频',
    sub: '把文档内容转成讲解视频',
    img: '/sites/vutu/showcase/row-07.png',
    refImgUrl: '/sites/vutu/showcase/row-07.png',
    capability: 'text_to_video',
    prompt:
      '知识讲解视频背景动画：干净的浅色工作台上摆放着摊开的笔记本与一支钢笔，旁边有一杯咖啡，镜头以极缓慢的速度从左上向右下平移，纸张边缘有柔和的光影变化，暖白平衡，极简风格，画面安静，适合叠加文字讲解，无人物出现',
  },
];

/**
 * 能力 → 前端图标名 + i18n key（`GET /v1/catalog/capabilities`）。
 *
 * `nameI18n` 是**完整的 11 语种对象**（与通知的 titleI18n/bodyI18n 同构），
 * 前端按当前 locale 取，缺失回落 en —— 这样能力名不必再由前端硬编码。
 */
export interface CapabilityMeta {
  icon: string;
  nameI18n: Record<string, string>;
  /** 前端工作台归类（video/image/audio），驱动 `?type=` Filter */
  kind: 'video' | 'image' | 'audio' | 'other';
}

export const CAPABILITY_META: Record<Capability, CapabilityMeta> = {
  text_to_video: {
    icon: 'video',
    kind: 'video',
    nameI18n: {
      en: 'Text to Video',
      'zh-CN': '文生视频',
      'zh-TW': '文生影片',
      ja: 'テキストから動画',
      ko: '텍스트로 비디오',
      es: 'Texto a vídeo',
      fr: 'Texte en vidéo',
      de: 'Text zu Video',
      it: 'Testo in video',
      pt: 'Texto para vídeo',
      ru: 'Текст в видео',
    },
  },
  image_to_video: {
    icon: 'image-play',
    kind: 'video',
    nameI18n: {
      en: 'Image to Video',
      'zh-CN': '图生视频',
      'zh-TW': '圖生影片',
      ja: '画像から動画',
      ko: '이미지로 비디오',
      es: 'Imagen a vídeo',
      fr: 'Image en vidéo',
      de: 'Bild zu Video',
      it: 'Immagine in video',
      pt: 'Imagem para vídeo',
      ru: 'Изображение в видео',
    },
  },
  text_to_image: {
    icon: 'image',
    kind: 'image',
    nameI18n: {
      en: 'Text to Image',
      'zh-CN': '文生图',
      'zh-TW': '文生圖',
      ja: 'テキストから画像',
      ko: '텍스트로 이미지',
      es: 'Texto a imagen',
      fr: 'Texte en image',
      de: 'Text zu Bild',
      it: 'Testo in immagine',
      pt: 'Texto para imagem',
      ru: 'Текст в изображение',
    },
  },
  image_to_image: {
    icon: 'images',
    kind: 'image',
    nameI18n: {
      en: 'Image to Image',
      'zh-CN': '图生图',
      'zh-TW': '圖生圖',
      ja: '画像から画像',
      ko: '이미지로 이미지',
      es: 'Imagen a imagen',
      fr: 'Image en image',
      de: 'Bild zu Bild',
      it: 'Immagine in immagine',
      pt: 'Imagem para imagem',
      ru: 'Изображение в изображение',
    },
  },
  text_to_audio: {
    icon: 'audio-lines',
    kind: 'audio',
    nameI18n: {
      en: 'Text to Audio',
      'zh-CN': '文生音频',
      'zh-TW': '文生音訊',
      ja: 'テキストから音声',
      ko: '텍스트로 오디오',
      es: 'Texto a audio',
      fr: 'Texte en audio',
      de: 'Text zu Audio',
      it: 'Testo in audio',
      pt: 'Texto para áudio',
      ru: 'Текст в аудио',
    },
  },
  tts: {
    icon: 'mic',
    kind: 'audio',
    nameI18n: {
      en: 'Text to Speech',
      'zh-CN': '语音合成',
      'zh-TW': '語音合成',
      ja: '音声合成',
      ko: '음성 합성',
      es: 'Texto a voz',
      fr: 'Synthèse vocale',
      de: 'Sprachausgabe',
      it: 'Sintesi vocale',
      pt: 'Texto para fala',
      ru: 'Синтез речи',
    },
  },
  text_to_music: {
    icon: 'music',
    kind: 'audio',
    nameI18n: {
      en: 'Text to Music',
      'zh-CN': '文生音乐',
      'zh-TW': '文生音樂',
      ja: 'テキストから音楽',
      ko: '텍스트로 음악',
      es: 'Texto a música',
      fr: 'Texte en musique',
      de: 'Text zu Musik',
      it: 'Testo in musica',
      pt: 'Texto para música',
      ru: 'Текст в музыку',
    },
  },
  avatar_talk: {
    icon: 'user-round',
    kind: 'video',
    nameI18n: {
      en: 'Talking Avatar',
      'zh-CN': '数字人口播',
      'zh-TW': '數位人口播',
      ja: 'アバター口パク',
      ko: '아바타 토킹',
      es: 'Avatar parlante',
      fr: 'Avatar parlant',
      de: 'Sprechender Avatar',
      it: 'Avatar parlante',
      pt: 'Avatar falante',
      ru: 'Говорящий аватар',
    },
  },
  video_translate: {
    icon: 'languages',
    kind: 'video',
    nameI18n: {
      en: 'Video Translation',
      'zh-CN': '视频翻译',
      'zh-TW': '影片翻譯',
      ja: '動画翻訳',
      ko: '비디오 번역',
      es: 'Traducción de vídeo',
      fr: 'Traduction vidéo',
      de: 'Videoübersetzung',
      it: 'Traduzione video',
      pt: 'Tradução de vídeo',
      ru: 'Перевод видео',
    },
  },
  viral_remix: {
    icon: 'repeat',
    kind: 'video',
    nameI18n: {
      en: 'Viral Remix',
      'zh-CN': '爆款再造',
      'zh-TW': '爆款再造',
      ja: 'バイラルリミックス',
      ko: '바이럴 리믹스',
      es: 'Remix viral',
      fr: 'Remix viral',
      de: 'Viraler Remix',
      it: 'Remix virale',
      pt: 'Remix viral',
      ru: 'Вирусный ремикс',
    },
  },
};
