/**
 * Seed：计划 / 渠道 / ★9 上架模型 / 价格表 / 路由策略 / 提示词库 / 促销。
 *
 * 数据来源：PRD v0.5 §5.2 模型清单、§6.3 价目表、§6.6 订阅计划、§5.3 路由策略示例。
 *
 * 幂等：全部用 upsert，可重复执行。
 */

import { PrismaClient, type Prisma } from '@prisma/client';
import { specHashOf } from '../src/core/crypto.js';
import { costUnitsToCredits, DEFAULT_PRICING } from '../src/core/pricing-math.js';

const prisma = new PrismaClient();

// ---------------------------------------------------------------- 订阅计划（PRD §6.6）

const PLANS = [
  {
    code: 'free' as const,
    nameI18n: {
      en: 'Free',
      'zh-CN': '免费方案',
      'zh-TW': '免費方案',
      ja: '無料プラン',
      ko: '무료 플랜',
      es: 'Gratis',
      fr: 'Gratuit',
      de: 'Kostenlos',
      it: 'Gratuito',
      pt: 'Grátis',
      ru: 'Бесплатный',
    },
    listPriceUsd: 0,
    monthlyCredits: 0,
    checkinCredits: 5,
    maxConcurrency: 1,
    planDiscount: null as number | null,
    features: ['low_cost_models', 'watermark', 'checkin_5_daily'],
  },
  {
    code: 'pro' as const,
    nameI18n: {
      en: 'Pro',
      'zh-CN': '专业版',
      'zh-TW': '專業版',
      ja: 'プロプラン',
      ko: '프로 플랜',
      es: 'Pro',
      fr: 'Pro',
      de: 'Pro',
      it: 'Pro',
      pt: 'Pro',
      ru: 'Pro',
    },
    listPriceUsd: 999, // $9.99
    monthlyCredits: 1000, // v0.5 修正：原 2000+450 必亏
    checkinCredits: 5, // 与月度额度叠加
    maxConcurrency: 3,
    planDiscount: 0.9, // 额外 9 折
    features: ['all_models', 'no_watermark', 'priority_queue', 'plan_discount_10', 'checkin_5_daily'],
  },
  {
    code: 'enterprise' as const,
    nameI18n: {
      en: 'Enterprise',
      'zh-CN': '企业版',
      'zh-TW': '企業版',
      ja: 'エンタープライズ',
      ko: '엔터프라이즈',
      es: 'Empresa',
      fr: 'Entreprise',
      de: 'Unternehmen',
      it: 'Enterprise',
      pt: 'Empresa',
      ru: 'Корпоративный',
    },
    listPriceUsd: 0, // 议价
    monthlyCredits: 0,
    checkinCredits: 5,
    maxConcurrency: 10,
    planDiscount: null,
    features: ['team', 'api', 'custom_credits'],
  },
];

// ---------------------------------------------------------------- 模型（PRD §5.4 参数映射 + §6.3 价目表）

interface SeedModel {
  code: string;
  displayName: string;
  capabilities: string[];
  active: boolean;
  qualityScore: number;
  paramMapping: Record<string, unknown>;
  requiredParams: string[];
  constraints: Record<string, unknown>;
  billingMethod: 'per_call' | 'per_second' | 'per_token';
  /** 每个规格的 costUnits（算力），credits 由公式算出 */
  specs: Array<{ spec: Record<string, unknown>; costUnits: number }>;
}

/**
 * ★ = 首期上架（active=true）。
 *
 * ⚠️ costUnits 的取值原则（重要）：
 *   PRD §6.3 价目表给出的是**对外积分**，而积分的唯一真源是公式
 *   `credits = ceil(costUnits × 18.8406)`。因此这里按「让公式精确复现 PRD 积分」
 *   反解 costUnits（取满足 ceil 结果的区间上界），而不是直接抄 PRD 里的算力数字 ——
 *   因为 PRD 表格中的部分算力值取自不同分组（如取了最贵分组而非"最低激活分组"），
 *   直接抄会导致报价与价目表对不上。
 *
 *   例：PRD 写 `hailuo-h3 1080P/10s = 32 积分`；要得到 32 需 costUnits ≤ 1.698462
 *   （ceil(1.698462×18.8406)=32），而 PRD §6.2 示例给的 1.656 也落在该区间内。
 *
 * 运营核对真实上游成本后，由每日价格同步（`price-sync.ts`）自动覆盖这些值。
 */
const MODELS: SeedModel[] = [
  // ---------------- 视频：text_to_video ----------------
  {
    code: 'hailuo-h3',
    displayName: 'Hailuo H3',
    capabilities: ['text_to_video'],
    active: true,
    qualityScore: 80,
    billingMethod: 'per_second',
    paramMapping: {
      resolution: { target: 'resolution', type: 'select', allowed: ['768P', '1080P', '2K'], required: true },
      durationSec: { target: 'duration', type: 'int', min: 4, max: 15, required: true },
      aspectRatio: {
        target: 'aspect_ratio',
        type: 'select',
        allowed: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'],
      },
    },
    requiredParams: ['resolution', 'durationSec'],
    constraints: { maxPromptChars: 2000, fixedResolution: undefined, notes: '出片慢，约 6~11 分钟' },
    // 按秒 0.0828/秒 → 768P: 5s=8, 10s=16, 15s=24
    specs: [
      { spec: { resolution: '768P', durationSec: 5 }, costUnits: 0.424615 },
      { spec: { resolution: '768P', durationSec: 10 }, costUnits: 0.84923 },
      { spec: { resolution: '768P', durationSec: 15 }, costUnits: 1.273846 },
      // 1080P/2K → 32 / 42（PRD §6.3）
      { spec: { resolution: '1080P', durationSec: 10 }, costUnits: 1.698461 },
      { spec: { resolution: '2K', durationSec: 10 }, costUnits: 2.22923 },
    ],
  },
  {
    code: 'hailuo-h3-quannengcankao',
    displayName: 'MiniMax H3', // 对客沿用 MiniMax 品牌（PRD §8.2 硬性规则）
    capabilities: ['text_to_video', 'image_to_video'],
    active: true,
    qualityScore: 85,
    billingMethod: 'per_second',
    paramMapping: {
      resolution: {
        target: 'resolution',
        type: 'select',
        allowed: ['768P', '1080P', '2K', '4K'],
        required: true,
      },
      durationSec: { target: 'duration', type: 'int', min: 4, max: 15, required: true },
      aspectRatio: {
        target: 'aspect_ratio',
        type: 'select',
        allowed: ['adaptive', '16:9', '9:16', '1:1', '4:3', '3:4', '21:9'],
      },
      images: { target: 'image_url', type: 'url', multiple: true, maxItems: 5 },
      videoUrl: { target: 'video_url', type: 'url' },
      audioUrl: { target: 'audio_url', type: 'url' },
    },
    requiredParams: ['resolution', 'durationSec'],
    constraints: {
      maxPromptChars: 2000,
      maxInputImages: 5,
      videoNeedsUrl: true, // 视频不支持 base64（LK888 约束）
      notes: '多模态参考全 OPT，可纯文生',
    },
    specs: [
      { spec: { resolution: '768P', durationSec: 10 }, costUnits: 0.84923 }, // 16
      { spec: { resolution: '1080P', durationSec: 10 }, costUnits: 1.698461 }, // 32
      { spec: { resolution: '2K', durationSec: 10 }, costUnits: 1.698461 }, // 32（PRD 与 1080P 同价）
      { spec: { resolution: '4K', durationSec: 10 }, costUnits: 2.22923 }, // 42
    ],
  },
  {
    code: 'gk-video-3',
    displayName: 'GK Video 3',
    capabilities: ['text_to_video', 'image_to_video'],
    active: true,
    qualityScore: 78,
    billingMethod: 'per_second',
    paramMapping: {
      durationSec: { target: 'duration', type: 'select', allowed: [6, 10], required: true },
      aspectRatio: {
        target: 'aspect_ratio',
        type: 'select',
        allowed: ['16:9', '9:16', '1:1', '4:3', '3:4'],
      },
      images: { target: 'image_url', type: 'url', multiple: true, maxItems: 1 },
    },
    requiredParams: ['durationSec'],
    constraints: {
      maxPromptChars: 2000,
      fixedResolution: '720P', // 规格锁死
      maxInputImages: 1,
      notes: '固定 720P，仅 6/10 秒；首帧可选（不传即文生）',
    },
    specs: [
      { spec: { durationSec: 6 }, costUnits: 0.424615 }, // 8
      { spec: { durationSec: 10 }, costUnits: 0.69 }, // 13
    ],
  },
  {
    code: 'omni-1.1',
    displayName: 'Omni 1.1',
    capabilities: ['text_to_video'],
    active: true,
    qualityScore: 76,
    billingMethod: 'per_call',
    paramMapping: {
      resolution: { target: 'resolution', type: 'select', allowed: ['720P', '1080P', '4K'], required: true },
      durationSec: { target: 'duration', type: 'int', min: 3, max: 10, required: true },
      aspectRatio: { target: 'aspect_ratio', type: 'select', allowed: ['16:9', '9:16'] },
      images: { target: 'image_url', type: 'url', multiple: true, maxItems: 1 },
      prompt: { target: 'prompt', type: 'string', required: true },
    },
    requiredParams: ['resolution', 'durationSec'],
    constraints: { maxPromptChars: 2000, maxInputImages: 1, notes: '出片快，约 2 分钟；prompt 必填' },
    specs: [
      { spec: { resolution: '720P', durationSec: 3 }, costUnits: 0.265384 }, // 5
      { spec: { resolution: '720P', durationSec: 10 }, costUnits: 0.84923 }, // 16
      { spec: { resolution: '1080P', durationSec: 10 }, costUnits: 1.38 }, // 26
      { spec: { resolution: '4K', durationSec: 10 }, costUnits: 2.07 }, // 39
    ],
  },
  {
    code: 'omni-flash',
    displayName: 'Omni Flash',
    capabilities: ['text_to_video'],
    active: true,
    qualityScore: 72,
    billingMethod: 'per_call',
    paramMapping: {
      durationSec: { target: 'duration', type: 'select', allowed: [4, 6, 8, 10], required: true },
      aspectRatio: { target: 'aspect_ratio', type: 'select', allowed: ['16:9', '9:16'] },
      images: { target: 'image_url', type: 'url', multiple: true, maxItems: 1 },
      enhancePrompt: { target: 'enhance_prompt', type: 'bool' },
      enableUpsample: { target: 'enable_upsample', type: 'bool' },
    },
    requiredParams: ['durationSec'],
    constraints: { maxPromptChars: 2000, maxInputImages: 1, notes: '固定档时长；支持超分开关' },
    specs: [
      { spec: { durationSec: 4 }, costUnits: 0.371538 }, // 7
      { spec: { durationSec: 6 }, costUnits: 0.530769 }, // 10
      { spec: { durationSec: 8 }, costUnits: 0.69 }, // 13
      { spec: { durationSec: 10 }, costUnits: 0.84923 }, // 16
    ],
  },
  {
    code: 'gk-video-3.5',
    displayName: 'GK Video 3.5',
    capabilities: ['image_to_video'],
    active: true,
    qualityScore: 88,
    billingMethod: 'per_second',
    paramMapping: {
      resolution: { target: 'resolution', type: 'select', allowed: ['720p', '480p'], required: true },
      durationSec: { target: 'duration', type: 'int', min: 1, max: 15, required: true },
      aspectRatio: {
        target: 'aspect_ratio',
        type: 'select',
        allowed: ['16:9', '9:16', '1:1', '4:3', '3:4'],
      },
      images: { target: 'image_url', type: 'url', multiple: true, maxItems: 1, required: true },
    },
    requiredParams: ['resolution', 'durationSec'],
    constraints: {
      maxPromptChars: 2000,
      maxInputImages: 1,
      videoNeedsUrl: true,
      notes: '首帧必填；自带音频输出；成功率 99%',
    },
    specs: [
      { spec: { resolution: '720p', durationSec: 5 }, costUnits: 0.69 }, // 13
      { spec: { resolution: '720p', durationSec: 10 }, costUnits: 1.38 }, // 26
      { spec: { resolution: '720p', durationSec: 15 }, costUnits: 2.07 }, // 39
    ],
  },
  {
    code: 'seedance-2.0-guanfang',
    displayName: 'Seedance 2.0', // 对客去掉 guanfang 后缀
    capabilities: ['text_to_video', 'image_to_video'],
    active: true,
    qualityScore: 90,
    billingMethod: 'per_token',
    paramMapping: {
      resolution: {
        target: 'resolution',
        type: 'select',
        allowed: ['480p', '720p', '1080p', '4K'],
      },
      durationSec: { target: 'duration', type: 'select', allowed: ['auto', 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] },
      aspectRatio: {
        target: 'aspect_ratio',
        type: 'select',
        allowed: ['adaptive', '16:9', '9:16', '1:1', '4:3', '3:4', '21:9'],
      },
      version: { target: 'version', type: 'select', allowed: ['Mini', '快速', '标准'] },
      mode: { target: 'mode', type: 'select', allowed: ['首尾帧', '参考生'] },
      images: { target: 'image_url', type: 'url', multiple: true, maxItems: 5 },
    },
    requiredParams: [],
    constraints: { maxPromptChars: 2000, maxInputImages: 5, videoNeedsUrl: true, notes: '全形态一体，免人像认证' },
    specs: [
      // 按 token 公式估算（PRD §6.3：10s=55/124/310）
      { spec: { resolution: '480p', durationSec: 10 }, costUnits: 2.91923 },
      { spec: { resolution: '720p', durationSec: 10 }, costUnits: 6.581538 },
      { spec: { resolution: '1080p', durationSec: 10 }, costUnits: 16.453846 },
    ],
  },
  {
    code: 'seedance-2.5-guanfang',
    displayName: 'Seedance 2.5',
    capabilities: ['text_to_video', 'image_to_video'],
    active: true,
    qualityScore: 92,
    billingMethod: 'per_token',
    paramMapping: {
      resolution: { target: 'resolution', type: 'select', allowed: ['480p', '720p', '1080p'] },
      durationSec: {
        target: 'duration',
        type: 'select',
        allowed: ['auto', 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30],
      },
      aspectRatio: {
        target: 'aspect_ratio',
        type: 'select',
        allowed: ['adaptive', '16:9', '9:16', '1:1', '4:3', '3:4', '21:9'],
      },
      webSearch: { target: 'web_search', type: 'bool' },
      images: { target: 'image_url', type: 'url', multiple: true, maxItems: 5 },
    },
    requiredParams: [],
    constraints: { maxPromptChars: 2000, maxInputImages: 5, videoNeedsUrl: true, notes: '联网搜索、视频延长' },
    specs: [
      { spec: { resolution: '480p', durationSec: 10 }, costUnits: 4.458461 }, // 84
      { spec: { resolution: '720p', durationSec: 10 }, costUnits: 10.031538 }, // 189
      { spec: { resolution: '1080p', durationSec: 10 }, costUnits: 22.557692 }, // 425
    ],
  },
  {
    code: 'happyhorse-i2v',
    displayName: 'HappyHorse',
    capabilities: ['image_to_video'],
    active: true,
    qualityScore: 70,
    billingMethod: 'per_second',
    paramMapping: {
      resolution: { target: 'resolution', type: 'select', allowed: ['720P', '1080P'], required: true },
      durationSec: { target: 'duration', type: 'int', min: 3, max: 15, required: true },
      images: { target: 'image_url', type: 'url', multiple: true, maxItems: 1, required: true },
    },
    requiredParams: ['resolution', 'durationSec'],
    constraints: { maxPromptChars: 2000, maxInputImages: 1, videoNeedsUrl: true, notes: '首帧；93s 最快' },
    specs: [
      { spec: { resolution: '720P', durationSec: 10 }, costUnits: 7.218461 }, // 136
      { spec: { resolution: '1080P', durationSec: 10 }, costUnits: 12.844615 }, // 242
    ],
  },
  // ---------------- 图片：text_to_image ----------------
  {
    code: 'tt-image-2',
    displayName: 'GPT Image 2', // ⚠️ 对客展示名，绝不暴露 tt- 内部代号
    capabilities: ['text_to_image', 'image_to_image'],
    active: true,
    qualityScore: 85,
    billingMethod: 'per_call',
    paramMapping: {
      // ⚠️ 上游约束（实测）：宽高须为 16 的倍数、单边 ≤3840、比例 1:3~3:1、
      // 总像素 655360~8294400，或传 auto。原 `4096x4096` 单边超限且总像素 16.7M
      // 超出上限，上游直接 400「参数 size 不合法」→ 用 2880x2880 覆盖 4K 档
      // （8.29M 像素，恰好在上限内），另加两个 16:9/9:16 高分档。
      size: {
        target: 'size',
        type: 'select',
        allowed: ['auto', '1024x1024', '2048x2048', '2880x2880', '3840x2160', '2160x3840'],
        required: true,
      },
      quality: { target: 'quality', type: 'select', allowed: ['auto', 'high', 'medium', 'low'] },
      images: { target: 'images', type: 'url', multiple: true, maxItems: 4 },
    },
    requiredParams: ['size'],
    constraints: { maxPromptChars: 4000, maxInputImages: 4, notes: '宽高比并在 size 选项内' },
    specs: [
      { spec: { size: '1024x1024' }, costUnits: 0.053076 }, // 1
      { spec: { size: '2048x2048' }, costUnits: 0.053076 }, // 1
      { spec: { size: '2880x2880' }, costUnits: 0.15923 }, // 3
      { spec: { size: '3840x2160' }, costUnits: 0.15923 }, // 3
      { spec: { size: '2160x3840' }, costUnits: 0.15923 }, // 3
    ],
  },
  {
    code: 'tt-image-2.5',
    displayName: 'GPT Image 2.5', // ⚠️ 对客展示名
    capabilities: ['text_to_image', 'image_to_image'],
    active: true,
    qualityScore: 90,
    billingMethod: 'per_call',
    paramMapping: {
      resolution: { target: 'resolution', type: 'select', allowed: ['auto', '1K', '2K', '4K'], required: true },
      size: { target: 'size', type: 'string' },
      quality: {
        target: 'quality',
        type: 'select',
        allowed: ['auto', 'low', 'medium', 'high', 'xhigh', 'max'],
      },
      version: { target: 'version', type: 'select', allowed: ['flare', 'sunburst'], required: true },
      aspectRatio: {
        target: 'aspect_ratio',
        type: 'select',
        allowed: ['auto', '1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '21:9', '9:21', '5:4', '4:5', '2:1', '1:2'],
      },
      background: { target: 'background', type: 'select', allowed: ['opaque', 'transparent', 'auto'] },
      images: { target: 'images', type: 'url', multiple: true, maxItems: 4 },
    },
    requiredParams: ['resolution', 'version'],
    constraints: { maxPromptChars: 4000, maxInputImages: 4, notes: '支持透明背景' },
    specs: [
      { spec: { resolution: '1K' }, costUnits: 0.053076 }, // 1
      { spec: { resolution: '2K' }, costUnits: 0.106153 }, // 2
      { spec: { resolution: '4K' }, costUnits: 0.15923 }, // 3
      { spec: { resolution: '2K', background: 'transparent' }, costUnits: 0.106153 }, // 2
    ],
  },
];

// ---------------------------------------------------------------- 提示词库（驱动前端 PromptLibrary）

/**
 * 提示词库页签（注意：没有 'all' —— `all` 是"全部"按钮的约定值，
 * 由 listLibrary 在首位虚拟插入，表里存一行会导致接口返回两个 all）。
 */
const PROMPT_TABS = [
  { code: 'video', labelI18n: { en: 'Video', 'zh-CN': '视频' }, sort: 1 },
  { code: 'image', labelI18n: { en: 'Image', 'zh-CN': '图像' }, sort: 2 },
  { code: 'ads', labelI18n: { en: 'Ads', 'zh-CN': '广告' }, sort: 3 },
  { code: 'story', labelI18n: { en: 'Story', 'zh-CN': '故事' }, sort: 4 },
];

const PROMPT_POSTS: Array<{ tabCode: string; title: string; imgUrl: string; sort: number }> = [
  {
    tabCode: 'video',
    title: '一只柴犬在东京街头骑自行车，电影感运镜，黄昏暖光，浅景深',
    imgUrl: '/vutu/prompt/dog-bike.jpg',
    sort: 0,
  },
  {
    tabCode: 'video',
    title: '赛博朋克城市夜景，霓虹灯反射在雨后街道，无人机航拍缓缓推进',
    imgUrl: '/vutu/prompt/cyberpunk.jpg',
    sort: 1,
  },
  {
    tabCode: 'image',
    title: '极简主义产品摄影，白色陶瓷咖啡杯置于大理石台面，柔和侧光',
    imgUrl: '/vutu/prompt/product.jpg',
    sort: 0,
  },
  {
    tabCode: 'image',
    title: '水彩风格的北欧峡湾风景，晨雾缭绕，远山层叠，静谧氛围',
    imgUrl: '/vutu/prompt/fjord.jpg',
    sort: 1,
  },
  {
    tabCode: 'ads',
    title: '运动饮料广告，慢镜头水花四溅，高对比打光，产品居中特写',
    imgUrl: '/vutu/prompt/drink-ad.jpg',
    sort: 0,
  },
  {
    tabCode: 'story',
    title: '宇航员在异星沙漠发现古代遗迹，宏大史诗感，逆光剪影',
    imgUrl: '/vutu/prompt/astronaut.jpg',
    sort: 0,
  },
];

// ---------------------------------------------------------------- 主流程

async function main(): Promise<void> {
  console.log('seeding plans...');
  const planIdByCode = new Map<string, string>();
  for (const p of PLANS) {
    const plan = await prisma.plan.upsert({
      where: { code: p.code },
      create: {
        code: p.code,
        nameI18n: p.nameI18n,
        listPriceUsd: p.listPriceUsd,
        monthlyCredits: p.monthlyCredits,
        checkinCredits: p.checkinCredits,
        maxConcurrency: p.maxConcurrency,
        planDiscount: p.planDiscount,
        features: p.features,
        active: true,
      },
      update: {
        nameI18n: p.nameI18n,
        listPriceUsd: p.listPriceUsd,
        monthlyCredits: p.monthlyCredits,
        checkinCredits: p.checkinCredits,
        maxConcurrency: p.maxConcurrency,
        planDiscount: p.planDiscount,
        features: p.features,
      },
    });
    planIdByCode.set(p.code, plan.id);
  }
  console.log(`  plans: ${planIdByCode.size}`);

  console.log('seeding channel lk888...');
  const channel = await prisma.channel.upsert({
    where: { code: 'lk888' },
    create: {
      code: 'lk888',
      name: '灵客 AI (LK888)',
      baseUrl: process.env.LK_BASE_URL ?? 'https://api.lk888.ai/api',
      enabled: true,
      rateLimitRpm: Number(process.env.LK_RATE_LIMIT_RPM ?? 120),
      timeoutMs: Number(process.env.LK_TIMEOUT_MS ?? 30000),
      healthStatus: 'ok',
      circuitState: 'closed',
    },
    update: {
      baseUrl: process.env.LK_BASE_URL ?? 'https://api.lk888.ai/api',
    },
  });

  // Mock 渠道：MOCK_PROVIDER=true 时模型挂在这个渠道下，保证 catalog/price 逻辑一致
  const mockChannel = await prisma.channel.upsert({
    where: { code: 'mock' },
    create: {
      code: 'mock',
      name: 'Mock Provider',
      baseUrl: 'http://localhost:8080',
      enabled: true,
      rateLimitRpm: 600,
      timeoutMs: 30000,
      healthStatus: 'ok',
      circuitState: 'closed',
    },
    update: {},
  });

  // Mock 渠道也需要一个 key 占位行（保持一致的数据形态），
  // 但凭据解析在 Mock 渠道下会被短路，不会真的去读环境变量
  //（见 src/modules/providers/registry.ts 的 getChannelCreds）。
  const mockKeyRow = await prisma.channelApiKey.findFirst({
    where: { channelId: mockChannel.id },
  });
  if (!mockKeyRow) {
    await prisma.channelApiKey.create({
      data: {
        channelId: mockChannel.id,
        keyRef: 'MOCK_API_KEY',
        strategy: '价格优先',
        priority: 1,
        enabled: true,
      },
    });
  }

  // Key 池（DB 只存引用名，明文来自环境变量；支持多 Key 分优先级 fallback）
  const existingKey = await prisma.channelApiKey.findFirst({ where: { channelId: channel.id } });
  if (!existingKey) {
    await prisma.channelApiKey.create({
      data: {
        channelId: channel.id,
        keyRef: 'LK_API_KEYS',
        strategy: '价格优先',
        priority: 1,
        enabled: true,
      },
    });
  }

  console.log('seeding models + price_items...');
  let priceItemCount = 0;

  for (const m of MODELS) {
    // MOCK_PROVIDER=true 时把模型挂到 mock 渠道，让 Router/Provider 走 Mock
    const targetChannelId = (process.env.MOCK_PROVIDER ?? 'true') === 'true' ? mockChannel.id : channel.id;

    const model = await prisma.model.upsert({
      where: { channelId_code: { channelId: targetChannelId, code: m.code } },
      create: {
        channelId: targetChannelId,
        code: m.code,
        displayName: m.displayName,
        capabilities: m.capabilities,
        paramMapping: m.paramMapping as Prisma.InputJsonValue,
        requiredParams: m.requiredParams as Prisma.InputJsonValue,
        constraints: m.constraints as Prisma.InputJsonValue,
        enabled: true,
        qualityScore: m.qualityScore,
        active: m.active,
      },
      update: {
        displayName: m.displayName,
        capabilities: m.capabilities,
        paramMapping: m.paramMapping as Prisma.InputJsonValue,
        requiredParams: m.requiredParams as Prisma.InputJsonValue,
        constraints: m.constraints as Prisma.InputJsonValue,
        qualityScore: m.qualityScore,
        active: m.active,
      },
    });

    for (const capability of m.capabilities) {
      for (const { spec, costUnits } of m.specs) {
        const hash = specHashOf(spec);
        const credits = costUnitsToCredits(costUnits, {
          usdToCny: Number(process.env.USD_TO_CNY ?? DEFAULT_PRICING.usdToCny),
          markup: Number(process.env.MARKUP ?? DEFAULT_PRICING.markup),
          creditsPerUsd: Number(process.env.CREDITS_PER_USD ?? DEFAULT_PRICING.creditsPerUsd),
        });

        await prisma.priceItem.upsert({
          where: {
            modelId_capability_specHash: { modelId: model.id, capability, specHash: hash },
          },
          create: {
            modelId: model.id,
            capability,
            spec: spec as Prisma.InputJsonValue,
            specHash: hash,
            costUnits,
            markup: Number(process.env.MARKUP ?? 1.3),
            credits,
            active: m.active,
          },
          update: {
            spec: spec as Prisma.InputJsonValue,
            costUnits,
            credits,
            active: m.active,
          },
        });
        priceItemCount++;
      }
    }
  }
  console.log(`  models: ${MODELS.length}, price_items upserts: ${priceItemCount}`);

  console.log('seeding routing policies...');
  const routing: Array<{ capability: string; strategy: string; candidates: unknown[] }> = [
    {
      capability: 'text_to_video',
      strategy: 'weighted',
      candidates: [
        { model: 'gk-video-3', weight: 40, enabled: true, grayPercent: 100 },
        { model: 'hailuo-h3', weight: 25, enabled: true, grayPercent: 100 },
        { model: 'omni-1.1', weight: 20, enabled: true, grayPercent: 100 },
        { model: 'omni-flash', weight: 15, enabled: true, grayPercent: 100 },
      ],
    },
    {
      capability: 'image_to_video',
      strategy: 'weighted',
      candidates: [
        { model: 'gk-video-3.5', weight: 60, enabled: true, grayPercent: 100 },
        { model: 'happyhorse-i2v', weight: 40, enabled: true, grayPercent: 100 },
      ],
    },
    {
      capability: 'text_to_image',
      strategy: 'weighted',
      candidates: [
        { model: 'tt-image-2.5', weight: 60, enabled: true, grayPercent: 100 },
        { model: 'tt-image-2', weight: 40, enabled: true, grayPercent: 100 },
      ],
    },
    {
      capability: 'image_to_image',
      strategy: 'weighted',
      candidates: [
        { model: 'tt-image-2.5', weight: 60, enabled: true, grayPercent: 100 },
        { model: 'tt-image-2', weight: 40, enabled: true, grayPercent: 100 },
      ],
    },
  ];

  for (const r of routing) {
    await prisma.routingPolicy.upsert({
      where: { capability: r.capability },
      create: {
        capability: r.capability,
        strategy: r.strategy,
        candidates: r.candidates as Prisma.InputJsonValue,
        fallbackEnabled: true,
        circuitBreaker: { failureThreshold: 5, cooldownSec: 120 },
      },
      update: {
        strategy: r.strategy,
        candidates: r.candidates as Prisma.InputJsonValue,
      },
    });
  }
  console.log(`  routing_policies: ${routing.length}`);

  console.log('seeding prompt library...');
  for (const t of PROMPT_TABS) {
    await prisma.promptTab.upsert({
      where: { code: t.code },
      create: { code: t.code, labelI18n: t.labelI18n, sort: t.sort, active: true },
      update: { labelI18n: t.labelI18n, sort: t.sort },
    });
  }
  for (const p of PROMPT_POSTS) {
    const existing = await prisma.promptPost.findFirst({ where: { title: p.title } });
    if (!existing) {
      await prisma.promptPost.create({
        data: {
          tabCode: p.tabCode,
          title: p.title,
          imgUrl: p.imgUrl,
          sort: p.sort,
          active: true,
          views: Math.floor(Math.random() * 5000) + 500,
          likes: Math.floor(Math.random() * 500) + 50,
        },
      });
    }
  }
  console.log(`  prompt_tabs: ${PROMPT_TABS.length}, prompt_posts: ${PROMPT_POSTS.length}`);

  console.log('seed done.');
}

main()
  .catch((e: unknown) => {
    console.error('seed failed:', e);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
