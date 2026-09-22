/**
 * Vutu 后端 API 类型（与后端响应 1:1 对应）。
 *
 * 后端统一包络：成功 `{ ok: true, data, requestId }`，
 * 失败 `{ ok: false, error: { code, message, details? }, requestId }`。
 * ⚠️ 本文件是冻结契约，改字段前先确认后端实现。
 */

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

export type ApiEnvelope<T> = ApiSuccess<T> | ApiFailure;

// ---------------------------------------------------------------- 认证

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface AuthUser {
  id: string;
  publicId: string;
  email: string | null;
  phone: string | null;
  displayName: string | null;
  avatarAssetId: string | null;
  locale: string;
  timezone?: string;
  planId?: string;
  status?: string;
  createdAt?: string;
}

export interface PlanView {
  code: string;
  nameI18n: Record<string, string>;
  listPriceUsd?: number;
  monthlyCredits: number;
  maxConcurrency: number;
  checkinCredits?: number;
  planDiscount?: number | null;
  features?: string[];
}

export interface MeData {
  user: AuthUser & { plan: PlanView };
  balance: { credits: number; expiringSoon: number };
}

export interface VerifyData extends TokenPair {
  user: AuthUser;
  isNewUser: boolean;
}

/**
 * 注册 verify 新语义：已存在 → exists:true（去登录/找回）；
 * 不存在 → verifiedToken（一次性，5min，拿去 set-password 建号）。
 */
export type VerifyResult =
  | { exists: true }
  | { exists: false; verifiedToken: string; expiresInSec: number };

export interface RegisterData {
  verificationId: string;
  expiresInSec: number;
}

// ---------------------------------------------------------------- 目录 / 定价

export interface CatalogCapability {
  code: string;
  nameI18n: Record<string, string>;
  icon?: string;
}

export interface CatalogModel {
  id: string;
  displayName: string;
  resolutions: string[];
  durations: string[];
  aspectRatios: string[];
  features?: string[];
}

export interface ModelParamOption {
  type: "select" | "int" | "bool" | "text" | "asset";
  options?: Array<string | number>;
  min?: number;
  max?: number;
  default?: string | number | boolean;
  required?: boolean;
  multiple?: boolean;
  maxItems?: number;
  labelKey?: string;
}

export interface ModelDetail {
  id: string;
  displayName: string;
  params: Record<string, ModelParamOption>;
  pricing: Array<{ spec: Record<string, unknown>; credits: number }>;
}

export interface CatalogTemplate {
  id: string;
  title: string;
  sub?: string;
  img: string;
  prompt: string;
  refImgUrl?: string;
  capability: string;
  modelId?: string;
  params?: Record<string, string | number | boolean | string[]>;
}

export interface QuoteData {
  sku: string;
  modelId: string;
  model: string;
  displayName?: string;
  capability: string;
  credits: number;
  breakdown?: {
    costUnits: number;
    markup: number;
    standardCredits: number;
    discounts: Array<{ kind: string; ref: string; factor?: number; amountOff?: number; label?: string }>;
    credits: number;
  };
  balance?: { credits: number; sufficient: boolean };
  estimated: boolean;
}

export interface SkuSpec {
  spec: Record<string, unknown>;
  credits: number;
  costUnits?: number;
}

export interface SkuModel {
  modelId: string;
  displayName: string;
  capability: string;
  specs: SkuSpec[];
}

export interface CreditPack {
  code: string;
  priceUsdCents?: number;
  priceUsd?: number;
  credits: number;
}

// ---------------------------------------------------------------- 任务

export type TaskStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "timeout";

export interface TaskModelRef {
  id: string;
  displayName: string;
}

export interface TaskResultItem {
  assetId: string;
  url?: string;
  mimeType: string;
  width?: number | null;
  height?: number | null;
  durationSec?: number | null;
  sizeBytes?: number;
}

export interface TaskDetail {
  id: string;
  status: TaskStatus;
  progress: number;
  capability: string;
  model: TaskModelRef;
  params?: Record<string, unknown>;
  inputAssetIds?: string[];
  quotedCredits: number;
  settledCredits: number;
  refunded?: boolean;
  error?: { code: string; message: string } | null;
  results: TaskResultItem[];
  createdAt: string;
  startedAt?: string | null;
  finishedAt?: string | null;
}

export interface TaskListItem {
  id: string;
  status: TaskStatus;
  progress: number;
  capability: string;
  model: TaskModelRef;
  quotedCredits: number;
  settledCredits: number;
  refunded?: boolean;
  resultAssetIds?: string[];
  error?: unknown;
  createdAt: string;
  finishedAt?: string | null;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

// ---------------------------------------------------------------- 资产

export interface AssetItem {
  id: string;
  kind: "upload" | "output";
  mimeType: string;
  sizeBytes: number;
  width?: number | null;
  height?: number | null;
  durationSec?: number | null;
  createdAt: string;
}

export interface UploadUrlData {
  assetId: string;
  uploadUrl: string;
  requiredHeaders: Record<string, string>;
  expiresInSec: number;
}

export interface AssetDetailData {
  asset: AssetItem;
  viewUrl: string;
}

export interface ImportUrlData {
  assetId: string;
  status: "ready" | "fetching";
  mimeType: string;
  sizeBytes: number;
}

// ---------------------------------------------------------------- 计费

export interface BalanceData {
  credits: number;
  expiringSoon: number;
}

export interface SubscriptionData {
  plan: string;
  planName: string;
  status: string;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  monthlyCredits: number;
  maxConcurrency: number;
}

export interface LedgerEntry {
  id: string;
  delta: number;
  type: string;
  balanceAfter: number;
  taskId?: string | null;
  orderId?: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------- 签到 / 通知 / 提示词库

export interface CheckinData {
  credits: number;
  balance: number;
}

export interface CheckinToday {
  checked_in: boolean;
  credits?: number;
}

export interface CheckinRecord {
  date: string;
  credits: number;
}

export interface NotificationItem {
  id: string;
  type: string;
  titleI18n: Record<string, string>;
  bodyI18n: Record<string, string>;
  readAt?: string | null;
  createdAt: string;
}

export interface PromptTab {
  id: string;
  labelI18n: Record<string, string>;
}

export interface PromptCard {
  id: string;
  title: string;
  img: string;
  cat: string;
  views: number;
  likes: number;
  copies?: number;
}
