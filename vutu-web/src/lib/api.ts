/**
 * Vutu 后端 API 客户端
 * ------------------------------------------------------------------
 * 严格对齐 `server/CONTRACT.md` §2 响应契约：
 *   成功 200/201 → { ok: true, data, requestId }
 *   失败 4xx/5xx → { ok: false, error: { code, message, details? }, requestId }
 */

/**
 * 后端基地址。
 *
 * 生产：`/api`（同域反代）—— nginx 把 `/api/v1/xxx` 剥成 `/v1/xxx` 转发到 127.0.0.1:8080。
 * 开发：留空 → 走 vite proxy（`/v1` → 127.0.0.1:3000）。
 */
const BASE = (import.meta.env.VITE_API_BASE ?? '').replace(/\/$/, '');

/** 后端统一错误体 */
interface ApiErrorBody {
  code: string;
  message: string;
  details?: unknown;
}

interface ApiEnvelope<T> {
  ok: boolean;
  data?: T;
  error?: ApiErrorBody;
  requestId?: string;
}

/** 业务错误：携带后端 code，便于 UI 分支处理 */
export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: unknown;

  constructor(code: string, message: string, status: number, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

/** 是否处于「后端未接入」状态（开发期无 server 时降级到演示数据） */
export let offlineMode = false;
export function setOfflineMode(v: boolean): void {
  offlineMode = v;
}

const LS_ACCESS = 'vutu_access_token';
const LS_REFRESH = 'vutu_refresh_token';

let accessToken: string | null = null;
let refreshToken: string | null = null;
let refreshInFlight: Promise<void> | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

/** 从 localStorage 恢复会话（应用启动时调用一次） */
export function restoreSession(): boolean {
  try {
    const a = localStorage.getItem(LS_ACCESS);
    const r = localStorage.getItem(LS_REFRESH);
    if (a) accessToken = a;
    if (r) refreshToken = r;
    return Boolean(a);
  } catch {
    return false;
  }
}

/** 保存 token 对（登录/注册/刷新成功后调用） */
export function saveSession(tokens: { accessToken: string; refreshToken: string }): void {
  accessToken = tokens.accessToken;
  refreshToken = tokens.refreshToken;
  try {
    localStorage.setItem(LS_ACCESS, tokens.accessToken);
    localStorage.setItem(LS_REFRESH, tokens.refreshToken);
  } catch {
    /* 隐私模式忽略 */
  }
}

/** 清除会话（登出时调用） */
export function clearSession(): void {
  accessToken = null;
  refreshToken = null;
  try {
    localStorage.removeItem(LS_ACCESS);
    localStorage.removeItem(LS_REFRESH);
  } catch {
    /* 忽略 */
  }
}

export function isLoggedIn(): boolean {
  return accessToken !== null;
}

/** 用 refreshToken 轮换一次 token 对；并发请求共用同一个 in-flight promise */
async function refreshSession(): Promise<void> {
  if (!refreshToken) throw new ApiError('UNAUTHORIZED', '请先登录', 401);
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      const data = await rawRequest<{ accessToken: string; refreshToken: string }>(
        '/v1/auth/refresh',
        { method: 'POST', body: JSON.stringify({ refreshToken }) },
      );
      saveSession(data);
    })();
    try {
      await refreshInFlight;
    } finally {
      refreshInFlight = null;
    }
  } else {
    await refreshInFlight;
  }
}

/**
 * 底层请求（无 401 重试）。失败时抛 ApiError（含后端 code），
 * 网络异常抛 ApiError('NETWORK_ERROR')。返回裸 data 字段（已剥掉 envelope）。
 */
async function rawRequest<T>(
  path: string,
  init: RequestInit & { query?: Record<string, string | number | undefined> } = {},
): Promise<T> {
  const { query, ...rest } = init;

  let url = `${BASE}${path}`;
  if (query) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== '') qs.set(k, String(v));
    }
    const s = qs.toString();
    if (s) url += `?${s}`;
  }

  const headers = new Headers(rest.headers);
  if (rest.body !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);

  let res: Response;
  try {
    res = await fetch(url, { ...rest, headers });
  } catch (e) {
    setOfflineMode(true);
    throw new ApiError('NETWORK_ERROR', '无法连接后端服务', 0, e);
  }

  let body: ApiEnvelope<T> | null = null;
  try {
    body = (await res.json()) as ApiEnvelope<T>;
  } catch {
    body = null;
  }

  if (!res.ok || !body?.ok) {
    const errBody = body?.error;
    throw new ApiError(
      errBody?.code ?? 'HTTP_' + res.status,
      errBody?.message ?? `请求失败（HTTP ${res.status}）`,
      res.status,
      errBody?.details,
    );
  }

  setOfflineMode(false);
  return body.data as T;
}

/**
 * 统一请求：rawRequest + 401 时自动 refresh 重试一次。
 * 刷新路径自身（/v1/auth/refresh）不重试，避免死循环。
 */
async function request<T>(
  path: string,
  init: RequestInit & { query?: Record<string, string | number | undefined> } = {},
): Promise<T> {
  try {
    return await rawRequest<T>(path, init);
  } catch (e) {
    const unauthorized = e instanceof ApiError && (e.code === 'UNAUTHORIZED' || e.status === 401);
    if (!unauthorized || path === '/v1/auth/refresh' || !refreshToken) throw e;
    try {
      await refreshSession();
    } catch {
      clearSession();
      throw e;
    }
    return rawRequest<T>(path, init);
  }
}

// ------------------------------------------------------------------ 类型

/** 能力码（对齐 core/types.ts CAPABILITIES 子集） */
export type Capability =
  | 'text_to_image'
  | 'image_to_image'
  | 'text_to_video'
  | 'image_to_video'
  | 'text_to_audio'
  | 'avatar_talk';

export type TaskStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'timeout';

/**
 * GET /v1/catalog/models 返回项。
 *
 * ⚠️ 列表接口**不返回** `capability` / `capabilities`，只给
 * `resolutions / durations / aspectRatios / features`。
 * 而 `durations` 并不能可靠区分图片与视频（实测 `GK Video 3.5` 的 durations 为空），
 * 因此**判定类型必须调详情接口**（见 `api.model()` + `capabilityKind`）。
 */
export interface CatalogModel {
  id: string;
  displayName: string;
  resolutions?: string[];
  durations?: string[];
  aspectRatios?: string[];
  features?: string[];
  /** 仅详情接口返回；列表接口没有 */
  capabilities?: Capability[];
  pricing?: ModelPricing[];
  qualityScore?: number;
}

export interface ModelPricing {
  /** ⚠️ 线上是对象（如 `{resolution:"1K"}` 或 `{background:"transparent",resolution:"2K"}`），不是字符串 */
  spec: Record<string, string>;
  credits: number;
  capability: Capability;
}

/** GET /v1/catalog/models/:id 返回项（带 params + pricing） */
export interface ModelDetail {
  id: string;
  displayName: string;
  code: string;
  capability: Capability;
  capabilityKind: string;
  capabilities: Capability[];
  /** ⚠️ 线上是 **对象映射**（键=参数名），不是数组 */
  params: Record<string, RawParam>;
  constraints: Record<string, unknown> | null;
  pricing: ModelPricing[];
}

/**
 * UI 内部使用的模型详情：`params` 已归一化成数组。
 * 与接口的 `ModelDetail` 区分开，避免两种形状互相污染。
 */
export interface ResolvedModelDetail extends Omit<ModelDetail, 'params'> {
  params: ParamOption[];
}

/** 详情接口里的单个参数定义（原始形状） */
export interface RawParam {
  type: 'text' | 'select' | 'asset' | 'number' | 'boolean' | string;
  labelKey?: string;
  options?: string[];
  default?: string | number | boolean;
  required?: boolean;
  multiple?: boolean;
  maxItems?: number;
}

/** 参数面板用的归一化选项 */
export interface ParamOption {
  key: string;
  label?: string;
  type?: 'enum' | 'string' | 'number' | 'boolean';
  options?: ParamOptionValue[];
  default?: string | number | boolean;
  min?: number;
  max?: number;
  step?: number;
}

export interface ParamOptionValue {
  value: string;
  label?: string;
  credits?: number;
}

/** GET /v1/tasks 列表项 / 详情 */
export interface TaskSummary {
  id: string;
  status: TaskStatus;
  progress: number;
  capability: Capability;
  prompt?: string;
  negativePrompt?: string | null;
  model: { id: string; displayName: string };
  params?: Record<string, unknown>;
  results?: TaskResultAsset[];
  quotedCredits?: number;
  settledCredits?: number;
  refundedCredits?: number;
  remainingCredits?: number;
  error?: { code: string; message: string } | null;
  createdAt: string;
  completedAt?: string | null;
  estimatedSec?: number;
}

export interface TaskResultAsset {
  assetId: string;
  url: string;
  mimeType: string;
  width?: number;
  height?: number;
  durationSec?: number;
}

/** POST /v1/pricing/quote 返回 */
export interface QuoteResult {
  credits: number;
  lines?: Array<{ label: string; credits: number }>;
  discountLines?: Array<{ label: string; amount: number }>;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface AssetItem {
  id: string;
  kind: 'upload' | 'output';
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
  viewUrl?: string;
}

// ------------------------------------------------------------------ 接口

export const api = {
  /** 能力列表（无 active 模型的能力自动隐藏） */
  capabilities: () =>
    request<Array<{ code: Capability; nameI18n: Record<string, string>; icon: string }>>(
      '/v1/catalog/capabilities',
    ),

  /** 可用模型列表 */
  models: (capability?: Capability) =>
    request<CatalogModel[]>('/v1/catalog/models', {
      query: capability ? { capability } : {},
    }),

  /** 模型详情（驱动参数 chip 联动与实时报价） */
  model: (id: string) => request<ModelDetail>(`/v1/catalog/models/${encodeURIComponent(id)}`),

  /** 快速开始模板 */
  templates: () =>
    request<
      Array<{
        id: string;
        titleI18n: Record<string, string>;
        prompt: string;
        capability: Capability;
        modelId?: string;
        params?: Record<string, unknown>;
      }>
    >('/v1/catalog/templates'),

  /** 实时报价 */
  quote: (body: {
    capability: Capability;
    modelId?: string;
    params: Record<string, unknown>;
  }) =>
    request<QuoteResult>('/v1/pricing/quote', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  /** 提交生成任务 */
  createTask: (body: {
    capability: Capability;
    modelId?: string;
    prompt: string;
    negativePrompt?: string;
    inputAssetIds?: string[];
    params?: Record<string, unknown>;
    idempotencyKey: string;
    /** F5 批量分组键（方案 §7）：`b_...`，可选；仅展示/分组语义，不参与计费 */
    batchId?: string;
  }) =>
    request<{ task: TaskSummary }>('/v1/tasks', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Idempotency-Key': body.idempotencyKey },
    }),

  /** F1 提示词优化（决议 D1：charge-after 扣积分；键每次点击独立，网络重试不重复扣） */
  optimizePrompt: (prompt: string) =>
    request<{ optimized: string; credits: number; latencyMs: number }>('/v1/prompts/optimize', {
      method: 'POST',
      body: JSON.stringify({ prompt }),
      headers: { 'Idempotency-Key': newIdempotencyKey() },
    }),

  /** F2 反推提示词（图片 → 提示词；charge-after 同 F1） */
  reversePrompt: (assetId: string) =>
    request<{ prompt: string; assetId: string; credits: number; latencyMs: number }>(
      '/v1/prompts/reverse',
      {
        method: 'POST',
        body: JSON.stringify({ assetId }),
        headers: { 'Idempotency-Key': newIdempotencyKey() },
      },
    ),

  /** F3 兑换码（条件更新防双花 → grant type=promo） */
  redeemKey: (code: string) =>
    request<{ credits: number; balanceAfter: number }>('/v1/billing/redeem', {
      method: 'POST',
      body: JSON.stringify({ code }),
    }),

  /** 提示词库列表（F4 发布时选 tab；匿名可读） */
  promptLibrary: () =>
    request<{ tabs: Array<{ id: string; labelI18n?: Record<string, string> }>; cards: unknown[] }>(
      '/v1/prompt-library',
    ),

  /** F4 发布到灵感广场（决议 D3：PROMPT_AUTO_APPROVE 缺省 true 即 published） */
  publishPost: (body: { tabCode: string; title: string; assetId: string }) =>
    request<{ publicId: string; status: string }>('/v1/prompt-library', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  /** 创作记录 */
  tasks: (q: { type?: 'image' | 'video' | 'audio'; cursor?: string; limit?: number } = {}) =>
    request<Page<TaskSummary>>('/v1/tasks', { query: q }),

  /** 任务详情（SSE 降级方案） */
  task: (id: string) => request<TaskSummary>(`/v1/tasks/${encodeURIComponent(id)}`),

  /** 取消任务 */
  cancelTask: (id: string) =>
    request<{ cancelled: boolean }>(`/v1/tasks/${encodeURIComponent(id)}/cancel`, {
      method: 'POST',
    }),

  /** 重试任务 */
  retryTask: (id: string, idempotencyKey: string) =>
    request<{ task: TaskSummary }>(`/v1/tasks/${encodeURIComponent(id)}/retry`, {
      method: 'POST',
      body: JSON.stringify({ idempotencyKey }),
    }),

  /** 素材列表 */
  assets: (q: { mediaType?: 'image' | 'video' | 'audio'; cursor?: string; limit?: number } = {}) =>
    request<Page<AssetItem>>('/v1/assets', { query: q }),

  /** 素材详情（含 viewUrl） */
  asset: (id: string) => request<{ asset: AssetItem; viewUrl: string }>(`/v1/assets/${id}`),

  /** 软删除素材 */
  deleteAsset: (id: string) =>
    request<{ deleted: boolean }>(`/v1/assets/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  /** 我的余额与并发 */
  me: () =>
    request<{
      user: {
        publicId: string;
        email: string | null;
        phone: string | null;
        displayName: string | null;
        planCode: string;
        plan: { code: string; maxConcurrency: number };
      };
      balance: { credits: number; expiringSoon: number };
    }>('/v1/auth/me'),

  /** 注册第一步：发验证码 → { verificationId, expiresInSec } */
  register: (body: { email: string }) =>
    request<{ verificationId: string; expiresInSec: number }>('/v1/auth/register', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  /** 注册第二步：校验码 → { exists } 或 { verifiedToken, expiresInSec } */
  verify: (body: { verificationId: string; code: string }) =>
    request<{ exists: boolean; verifiedToken?: string; expiresInSec?: number }>(
      '/v1/auth/verify',
      { method: 'POST', body: JSON.stringify(body) },
    ),

  /** 注册第三步：凭 verifiedToken 设密码 → 建号 + token 对 */
  setPassword: (body: { verifiedToken: string; password: string }) =>
    request<{ user: unknown; accessToken: string; refreshToken: string }>(
      '/v1/auth/set-password',
      { method: 'POST', body: JSON.stringify(body) },
    ),

  /** 密码登录 → { user, accessToken, refreshToken } */
  login: (body: { email: string; password: string }) =>
    request<{ user: unknown; accessToken: string; refreshToken: string }>('/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  /** 登出（幂等，需登录态保存的 refreshToken） */
  logout: () => {
    const body = refreshToken ? { refreshToken } : { refreshToken: 'none' };
    clearSession();
    if (body.refreshToken === 'none') return Promise.resolve({ revoked: true });
    return rawRequest<{ revoked: boolean }>('/v1/auth/logout', {
      method: 'POST',
      body: JSON.stringify(body),
    }).catch(() => ({ revoked: true }));
  },

  /** 申请直传 URL → { assetId, uploadUrl, requiredHeaders, expiresInSec } */
  requestUploadUrl: (body: { mimeType: string; sizeBytes: number; filename?: string }) =>
    request<{
      assetId: string;
      uploadUrl: string;
      requiredHeaders: Record<string, string>;
      expiresInSec: number;
    }>('/v1/assets/upload-url', {
      method: 'POST',
      body: JSON.stringify({ ...body, kind: 'upload' }),
    }),

  /** 确认直传完成 → { asset }（后端 headObject + 异步魔数校验） */
  confirmAsset: (assetId: string) =>
    request<{ asset: AssetItem }>('/v1/assets', {
      method: 'POST',
      body: JSON.stringify({ assetId }),
    }),

  /** 以链接导入参考图（服务端拉取，SSRF 防护） */
  importAssetUrl: (url: string) =>
    request<{ asset?: AssetItem; assetId?: string; status?: string }>('/v1/assets/import-url', {
      method: 'POST',
      body: JSON.stringify({ url, kind: 'upload', mediaType: 'image' }),
    }),
};

/**
 * 把详情接口的 `params` 对象映射归一化成参数面板用的数组。
 * 只保留可在 UI 上渲染的 `select` / `number` 类型（`asset` = 参考图，已由 composer 处理）。
 */
export function toParamOptions(params: Record<string, RawParam> | undefined): ParamOption[] {
  if (!params) return [];
  const out: ParamOption[] = [];

  for (const [key, p] of Object.entries(params)) {
    if (p.type === 'select' && p.options?.length) {
      out.push({
        key,
        label: p.labelKey,
        type: 'enum',
        options: p.options.map((v) => ({ value: v, label: v })),
        ...(p.default !== undefined ? { default: p.default } : {}),
      });
    } else if (p.type === 'number') {
      out.push({
        key,
        label: p.labelKey,
        type: 'number',
        ...(p.default !== undefined ? { default: p.default } : {}),
      });
    }
  }

  return out;
}

/**
 * 按当前参数匹配价目行。
 *
 * 线上 `spec` 是对象（如 `{resolution:"1K"}`）。匹配规则：spec 的每个键值
 * 都要与当前选择一致，取满足条件的**最贵**一行（规格越具体通常越贵），
 * 无匹配则回退到最便宜的一行。
 */
export function matchPrice(
  pricing: ModelPricing[] | undefined,
  current: Record<string, string>,
  kind: 'image' = 'image',
): number {
  void kind;
  if (!pricing?.length) return 0.03;

  const usable = pricing.filter((p) => p.capability === 'text_to_image');
  const rows = usable.length ? usable : pricing;

  const matched = rows.filter((row) =>
    Object.entries(row.spec ?? {}).every(([k, v]) => current[k] === v),
  );

  if (matched.length) {
    return Math.max(...matched.map((r) => r.credits));
  }

  const loose = rows.filter((row) => Object.keys(row.spec ?? {}).length === 0);
  const pool = loose.length ? loose : rows;
  return Math.min(...pool.map((r) => r.credits));
}

/** 生成幂等键（≥8 字符，契约要求） */export function newIdempotencyKey(): string {
  const rand = crypto.getRandomValues(new Uint8Array(16));
  const hex = Array.from(rand, (b) => b.toString(16).padStart(2, '0')).join('');
  return `idem_${hex}`;
}

/**
 * 直传一张参考图：申请 upload-url → PUT 到对象存储 → 确认。
 * 返回后端 assetId（图生图的 inputAssetIds 就用它）。
 *  image/gif 不在白名单也由后端 validateUploadRequest 拒绝，这里只做大小兜底（100MB）。
 */
export async function uploadImageFile(file: File): Promise<{ assetId: string }> {
  if (file.size > 100 * 1024 * 1024) {
    throw new ApiError('FILE_TOO_LARGE', '图片超过 100MB', 0);
  }
  const { assetId, uploadUrl, requiredHeaders } = await api.requestUploadUrl({
    mimeType: file.type || 'application/octet-stream',
    sizeBytes: file.size,
    filename: file.name,
  });
  let put: Response;
  try {
    put = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': file.type || 'application/octet-stream', ...requiredHeaders },
      body: file,
    });
  } catch (e) {
    throw new ApiError('NETWORK_ERROR', '直传失败，请重试', 0, e);
  }
  if (!put.ok) throw new ApiError('UPLOAD_FAILED', `直传失败（HTTP ${put.status}）`, put.status);
  await api.confirmAsset(assetId);
  return { assetId };
}

/**
 * 订阅任务 SSE 进度流。
 * 契约：GET /v1/tasks/:id/stream → event: progress | succeeded | failed | ...
 * 返回取消函数。
 */
export function streamTask(
  taskId: string,
  onEvent: (event: string, data: unknown) => void,
): () => void {
  const url = `${BASE}/v1/tasks/${encodeURIComponent(taskId)}/stream`;
  const es = new EventSource(url);

  const handle = (name: string) => (ev: MessageEvent<string>) => {
    let parsed: unknown = ev.data;
    try {
      parsed = JSON.parse(ev.data);
    } catch {
      /* 保留原始字符串 */
    }
    onEvent(name, parsed);
  };

  es.addEventListener('progress', handle('progress'));
  es.addEventListener('succeeded', handle('succeeded'));
  es.addEventListener('failed', handle('failed'));
  es.addEventListener('cancelled', handle('cancelled'));
  es.addEventListener('timeout', handle('timeout'));
  es.onerror = () => onEvent('error', null);

  return () => es.close();
}
