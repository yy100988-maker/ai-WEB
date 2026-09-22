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

let accessToken: string | null = null;
export function setAccessToken(token: string | null): void {
  accessToken = token;
}

/**
 * 统一请求。失败时抛 ApiError（含后端 code），网络异常抛 ApiError('NETWORK_ERROR')。
 * 返回裸 data 字段（已剥掉 envelope）。
 */
async function request<T>(
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
  }) =>
    request<{ task: TaskSummary }>('/v1/tasks', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Idempotency-Key': body.idempotencyKey },
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
      publicId: string;
      email: string;
      planCode: string;
      credits: number;
      maxConcurrency: number;
    }>('/v1/users/me'),
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
