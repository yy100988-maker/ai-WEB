/**
 * 领域类型与统一契约（PRD §2 术语 / §5 Provider 接口）。
 *
 * ⚠️ 本文件是跨模块冻结契约：所有模块（billing / tasks / providers / routes）
 * 一律从此处导入，禁止各自重复定义。修改需评审。
 */

// ---------------------------------------------------------------- 能力

export const CAPABILITIES = [
  'text_to_video',
  'image_to_video',
  'text_to_image',
  'image_to_image',
  'text_to_audio',
  'tts',
  'text_to_music',
  'avatar_talk',
  'video_translate',
  'viral_remix',
] as const;

export type Capability = (typeof CAPABILITIES)[number];

/** 能力 → 前端创作记录 Filter 归类（PRD §8.4 `?type=video|image|audio`） */
export const CAPABILITY_KIND: Record<Capability, 'video' | 'image' | 'audio' | 'other'> = {
  text_to_video: 'video',
  image_to_video: 'video',
  video_translate: 'video',
  viral_remix: 'video',
  text_to_image: 'image',
  image_to_image: 'image',
  text_to_audio: 'audio',
  tts: 'audio',
  text_to_music: 'audio',
  avatar_talk: 'video',
};

export const KIND_TO_CAPABILITIES: Record<string, Capability[]> = {
  video: ['text_to_video', 'image_to_video'],
  image: ['text_to_image', 'image_to_image'],
  audio: ['text_to_audio', 'tts', 'text_to_music'],
};

export function isCapability(v: unknown): v is Capability {
  return typeof v === 'string' && (CAPABILITIES as readonly string[]).includes(v);
}

// ---------------------------------------------------------------- 渠道 / 模型

export type BillingMethod = 'per_call' | 'per_token' | 'per_second';
export type ChannelGroup = 'price_first' | 'success_first' | 'custom';

export interface ChannelCreds {
  /** 已解密的 API Key 明文；仅在内存中流转，禁止落库/落日志 */
  apiKey: string;
  /** 由 ChannelApiKey.id 派生，用于成本归集与配额累加 */
  apiKeyId: string;
  baseUrl: string;
  timeoutMs: number;
}

/**
 * 参数映射项（PRD §5.4 声明式映射表）。
 * `target` = 上游字段名；`type` 决定 validate() 的校验方式。
 */
export interface ParamMappingEntry {
  target: string;
  type: 'select' | 'int' | 'string' | 'bool' | 'url' | 'base64';
  allowed?: Array<string | number>;
  min?: number;
  max?: number;
  /** 上游是否必传（required=true 时平台不会补默认值，必须我方传） */
  required?: boolean;
  /** 是否允许数组（如 images 多图） */
  multiple?: boolean;
  maxItems?: number;
  /** 参数值转换：如 durationSec 数字 → 上游字符串 */
  coerce?: 'string' | 'number' | 'boolean';
}

export interface ModelConstraints {
  maxPromptChars?: number;
  maxInputImages?: number;
  maxInputVideos?: number;
  maxInputAudios?: number;
  /** 视频输入必须公网 URL，不支持 base64（LK888 平台约束） */
  videoNeedsUrl?: boolean;
  /** 固定分辨率（如 gk-video-3 锁定 720P） */
  fixedResolution?: string;
  /** 参数不支持时的提示 */
  notes?: string;
}

export interface ModelDescriptor {
  id: string;
  code: string;
  displayName: string;
  channelId: string;
  channelCode: string;
  capabilities: Capability[];
  paramMapping: Record<string, ParamMappingEntry>;
  requiredParams: string[];
  constraints: ModelConstraints;
  enabled: boolean;
  active: boolean;
  qualityScore: number | null;
  /** 由 param_mapping 派生的对客参数定义（catalog 下发给前端渲染 chip） */
  params?: ModelParamOptions;
}

/** 对客参数定义：驱动 PRD §8.4.1 "参数 chip 随模型动态渲染" */
export interface ModelParamOptions {
  [paramKey: string]: {
    type: 'select' | 'int' | 'bool' | 'text' | 'asset';
    options?: Array<string | number>;
    min?: number;
    max?: number;
    default?: string | number | boolean;
    required?: boolean;
    multiple?: boolean;
    maxItems?: number;
    /** 对客展示名 i18n key，前端负责本地化 */
    labelKey?: string;
  };
}

// ---------------------------------------------------------------- 生成请求

export interface AssetRef {
  assetId: string;
  publicId: string;
  mimeType: string;
  /** 由 Worker 在 submit 前置换为 4h 交付 URL（PRD §8.3 三权分立） */
  deliveryUrl: string;
  sizeBytes: number;
}

export interface GenerationRequest {
  taskId: string;
  capability: Capability;
  prompt: string;
  negativePrompt?: string;
  inputs: AssetRef[];
  /** 开放键值，合法取值以 catalog 下发的 options 为准（PRD §5.1） */
  params: Record<string, string | number | boolean | string[]>;
  callbackUrl?: string;
  idempotencyKey: string;
  /** 关联的模型/渠道（Worker 已由 Router 落库，无需再选） */
  modelCode: string;
  channelCode: string;
}

export interface ValidationResult {
  valid: boolean;
  errors?: Array<{ param: string; message: string; allowed?: Array<string | number> }>;
}

export interface SubmitResult {
  externalJobId: string;
  estimatedSec?: number;
  raw?: unknown;
}

export type PollState = 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export interface PollOutput {
  mimeType: string;
  remoteUrl?: string;
  base64?: string;
  meta?: { width: number; height: number; durationSec?: number; sizeBytes?: number };
}

export interface PollResult {
  state: PollState;
  /** 0-100；渠道不给则按时间估算 */
  progress?: number;
  outputs?: PollOutput[];
  error?: { code: string; message: string; retryable: boolean };
  /** 上游是否已退款（影响成本口径，不影响用户侧返还） */
  refunded?: boolean;
  /** 上游实际计费（算力），写入 task_costs */
  costUnits?: number;
  channelGroup?: string;
  isFinal?: boolean;
  raw?: unknown;
}

export interface MappedError {
  code: string;
  retryable: boolean;
  userMessage: string;
}

export interface GenerationProvider {
  readonly channelCode: string;
  readonly supportedCapabilities: Capability[];
  listModels(): Promise<ModelDescriptor[]>;
  validate(req: GenerationRequest, model: ModelDescriptor): ValidationResult;
  submit(req: GenerationRequest, model: ModelDescriptor, creds: ChannelCreds): Promise<SubmitResult>;
  poll(externalJobId: string, model: ModelDescriptor, creds: ChannelCreds): Promise<PollResult>;
  cancel?(externalJobId: string, model: ModelDescriptor, creds: ChannelCreds): Promise<void>;
  mapError(err: unknown): MappedError;
}

// ---------------------------------------------------------------- 任务

export const TASK_STATUSES = ['queued', 'running', 'succeeded', 'failed', 'cancelled', 'timeout'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TERMINAL_STATUSES: readonly TaskStatus[] = ['succeeded', 'failed', 'cancelled', 'timeout'];

export function isTerminal(s: TaskStatus): boolean {
  return TERMINAL_STATUSES.includes(s);
}

/** 合法状态迁移（详细设计 §3.2）。非法迁移一律拒绝并记日志。 */
export const ALLOWED_TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  queued: ['running', 'cancelled', 'failed', 'timeout'],
  running: ['succeeded', 'failed', 'cancelled', 'timeout'],
  succeeded: [],
  failed: [],
  cancelled: [],
  timeout: [],
};

export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

// ---------------------------------------------------------------- 账本

export const LEDGER_TYPES = [
  'grant_signup',
  'grant_checkin',
  'purchase',
  'task_deduct',
  'task_refund',
  'refund',
  'admin_adjust',
  'promo',
  // R1 修订（docs/xiaoye-adoption-design.md §9，决议 D1，2026-09-23，加法扩展）：
  // LLM 服务扣费（提示词优化/反推），由 ledger.spend() 写入，delta = -amount。
  'service_deduct',
  'expire',
] as const;
export type LedgerType = (typeof LEDGER_TYPES)[number];

// ---------------------------------------------------------------- 折扣 / 报价

export interface DiscountLine {
  kind: 'promotion' | 'plan' | 'coupon';
  ref: string;
  /** 比例折扣（0.75 = 75 折）；与 amountOff 二选一 */
  factor?: number;
  /** 直接减免积分数 */
  amountOff?: number;
  label?: string;
}

export interface QuoteBreakdown {
  costUnits: number;
  markup: number;
  /** 标准价（未打折，= ceil(costUnits × markup × creditsPerUsd / usdToCny)） */
  standardCredits: number;
  discounts: DiscountLine[];
  /** 实付积分（≥ 1） */
  credits: number;
}

export interface QuoteResult {
  sku: string;
  modelId: string;
  modelCode: string;
  displayName: string;
  capability: Capability;
  credits: number;
  breakdown: QuoteBreakdown;
  estimated: boolean;
}

// ---------------------------------------------------------------- 统一响应

export interface ApiSuccess<T> {
  ok: true;
  data: T;
  requestId: string;
  idempotentReplay?: boolean;
}

export interface ApiFailure {
  ok: false;
  error: { code: string; message: string; details?: Record<string, unknown> };
  requestId: string;
}

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

// ---------------------------------------------------------------- 语言

export const LOCALES = ['en', 'zh-TW', 'zh-CN', 'ja', 'ko', 'es', 'fr', 'de', 'it', 'pt', 'ru'] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'en';

/** 11 语种 → 默认时区（详细设计 §1.6 签到规则 4） */
export const LOCALE_TIMEZONE: Record<Locale, string> = {
  en: 'America/New_York',
  'zh-TW': 'Asia/Taipei',
  'zh-CN': 'Asia/Shanghai',
  ja: 'Asia/Tokyo',
  ko: 'Asia/Seoul',
  es: 'Europe/Madrid',
  fr: 'Europe/Paris',
  de: 'Europe/Berlin',
  it: 'Europe/Rome',
  pt: 'Europe/Lisbon',
  ru: 'Europe/Moscow',
};

export const FALLBACK_TIMEZONE = 'Asia/Shanghai';

export function isLocale(v: unknown): v is Locale {
  return typeof v === 'string' && (LOCALES as readonly string[]).includes(v);
}

/** Accept-Language 解析：`zh-CN,zh;q=0.9,en;q=0.8` → `zh-CN` */
export function parseAcceptLanguage(header: string | undefined | null): Locale {
  if (!header) return DEFAULT_LOCALE;
  const parts = header
    .split(',')
    .map((p) => {
      const [tag, ...params] = p.trim().split(';');
      const qParam = params.find((x) => x.trim().startsWith('q='));
      const q = qParam ? Number.parseFloat(qParam.split('=')[1] ?? '1') : 1;
      return { tag: (tag ?? '').trim(), q: Number.isFinite(q) ? q : 1 };
    })
    .filter((p) => p.tag.length > 0)
    .sort((a, b) => b.q - a.q);

  for (const { tag } of parts) {
    if (isLocale(tag)) return tag;
    const lower = tag.toLowerCase();
    if (lower === 'zh' || lower.startsWith('zh-hans') || lower === 'zh-cn') return 'zh-CN';
    if (lower.startsWith('zh-hant') || lower === 'zh-tw' || lower === 'zh-hk') return 'zh-TW';
    const base = lower.split('-')[0];
    if (isLocale(base)) return base;
  }
  return DEFAULT_LOCALE;
}
