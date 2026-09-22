/**
 * ProviderRegistry —— 渠道码 → Provider 实例，以及 DB 模型/凭据的装载。
 *
 * 关键约束（CONTRACT §5）：
 * **`MOCK_PROVIDER=true` 时 `getActiveProvider()` 必须返回 MockProvider，
 * 绝不实例化 LingkeProvider** —— 保证 CI/staging/压测零上游费用，
 * 且从代码层面杜绝误打 `api.lk888.ai`。
 *
 * 缓存策略：
 * - Provider 实例：进程内单例（无状态，可长期持有）
 * - 凭据：内存缓存 5min（PRD §5.5，避免每次 poll 都查库）
 */

import type {
  BillingMethod,
  Capability,
  ChannelCreds,
  GenerationProvider,
  ModelConstraints,
  ModelDescriptor,
  ParamMappingEntry,
} from '../../core/types.js';
import { isCapability } from '../../core/types.js';
import { db } from '../../core/db.js';
import { err } from '../../core/errors.js';
import { getConfig, maskSecret } from '../../core/config.js';
import { childLogger } from '../../core/logger.js';
import { MockProvider, MOCK_CHANNEL_CODE } from './mock.js';
import { LingkeProvider } from './lingke.js';
import { buildParamOptions } from './validate.js';

const log = childLogger({ mod: 'provider-registry' });

// ---------------------------------------------------------------- Provider 实例

/**
 * Provider 实例是**无状态**的（凭据每次调用传入），所以进程内单例即可。
 *
 * ⚠️ 注意 `LingkeProvider` 是**静态 import**：它只是构造一个类实例，
 * 构造期不读 Key、不发请求，所以 `MOCK_PROVIDER=true` 时也没有任何副作用。
 * 真正的"绝不打上游"由 `getActiveProvider()` 的分支保证。
 */
let mockSingleton: MockProvider | null = null;
let lingkeSingleton: LingkeProvider | null = null;

function mockProvider(): MockProvider {
  if (!mockSingleton) mockSingleton = new MockProvider();
  return mockSingleton;
}

function lingkeProvider(): LingkeProvider {
  if (!lingkeSingleton) lingkeSingleton = new LingkeProvider();
  return lingkeSingleton;
}

/**
 * 按渠道码取 Provider（CONTRACT §4 冻结的同步签名）。
 *
 * - `mock` 渠道 → MockProvider（**无论 `MOCK_PROVIDER` 取值**：
 *   DB 里显式挂了 mock 渠道的模型时，就该用 Mock 生成，与全局开关无关）
 * - 其他渠道 + `MOCK_PROVIDER=true` → 仍然 Mock（本项目部署配置：绝不打真实上游）
 * - 其他渠道 + `MOCK_PROVIDER=false` → LingkeProvider
 */
export function getProvider(channelCode: string): GenerationProvider {
  if (channelCode === MOCK_CHANNEL_CODE) return mockProvider();
  if (getConfig().MOCK_PROVIDER) return mockProvider();
  return lingkeProvider();
}

/** 取当前生效的 Provider（与 getProvider 同语义，语义更清晰） */
export function getActiveProvider(): GenerationProvider {
  if (getConfig().MOCK_PROVIDER) return mockProvider();
  return lingkeProvider();
}

/** 测试用：清空 Provider 单例与凭据/模型缓存 */
export function resetProviders(): void {
  mockSingleton = null;
  lingkeSingleton = null;
  credsCache.clear();
  modelsCache.clear();
}

// ---------------------------------------------------------------- Json → 强类型

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

const PARAM_TYPES = ['select', 'int', 'string', 'bool', 'url', 'base64'] as const;

/**
 * 把 DB `models.param_mapping` (Json) 收窄为 `Record<string, ParamMappingEntry>`。
 *
 * 为什么必须逐字段收窄：Json 列里可能是任意脏数据（运营后台手改过），
 * 直接 `as` 会让脏数据在运行期以难以定位的方式炸掉。这里做**保守丢弃**：
 * 认不出的字段略过，认不出的 type 整条略过。
 */
export function parseParamMapping(raw: unknown): Record<string, ParamMappingEntry> {
  const out: Record<string, ParamMappingEntry> = {};
  const obj = asRecord(raw);

  for (const [key, value] of Object.entries(obj)) {
    const e = asRecord(value);
    const target = typeof e['target'] === 'string' ? e['target'] : key;
    const type = e['type'];
    if (typeof type !== 'string' || !(PARAM_TYPES as readonly string[]).includes(type)) continue;

    const entry: ParamMappingEntry = { target, type: type as ParamMappingEntry['type'] };

    if (Array.isArray(e['allowed'])) {
      entry.allowed = e['allowed'].filter(
        (x): x is string | number => typeof x === 'string' || typeof x === 'number',
      );
    }
    if (typeof e['min'] === 'number') entry.min = e['min'];
    if (typeof e['max'] === 'number') entry.max = e['max'];
    if (typeof e['required'] === 'boolean') entry.required = e['required'];
    if (typeof e['multiple'] === 'boolean') entry.multiple = e['multiple'];
    if (typeof e['maxItems'] === 'number') entry.maxItems = e['maxItems'];
    if (e['coerce'] === 'string' || e['coerce'] === 'number' || e['coerce'] === 'boolean') {
      entry.coerce = e['coerce'];
    }

    out[key] = entry;
  }

  return out;
}

export function parseRequiredParams(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.filter((x): x is string => typeof x === 'string');
  return [];
}

export function parseConstraints(raw: unknown): ModelConstraints {
  const c = asRecord(raw);
  const out: ModelConstraints = {};
  if (typeof c['maxPromptChars'] === 'number') out.maxPromptChars = c['maxPromptChars'];
  if (typeof c['maxInputImages'] === 'number') out.maxInputImages = c['maxInputImages'];
  if (typeof c['maxInputVideos'] === 'number') out.maxInputVideos = c['maxInputVideos'];
  if (typeof c['maxInputAudios'] === 'number') out.maxInputAudios = c['maxInputAudios'];
  if (typeof c['videoNeedsUrl'] === 'boolean') out.videoNeedsUrl = c['videoNeedsUrl'];
  if (typeof c['fixedResolution'] === 'string') out.fixedResolution = c['fixedResolution'];
  if (typeof c['notes'] === 'string') out.notes = c['notes'];
  return out;
}

export function parseCapabilities(raw: unknown): Capability[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is Capability => isCapability(x));
}

/** DB Model + Channel 行 → ModelDescriptor（含派生 params） */
function toDescriptor(
  row: {
    id: string;
    code: string;
    displayName: string;
    channelId: string;
    capabilities: string[];
    paramMapping: unknown;
    requiredParams: unknown;
    constraints: unknown;
    enabled: boolean;
    active: boolean;
    qualityScore: number | null;
  },
  channelCode: string,
): ModelDescriptor {
  const paramMapping = parseParamMapping(row.paramMapping);
  const descriptor: ModelDescriptor = {
    id: row.id,
    code: row.code,
    displayName: row.displayName,
    channelId: row.channelId,
    channelCode,
    capabilities: parseCapabilities(row.capabilities),
    paramMapping,
    requiredParams: parseRequiredParams(row.requiredParams),
    constraints: parseConstraints(row.constraints),
    enabled: row.enabled,
    active: row.active,
    qualityScore: row.qualityScore,
  };

  // params 派生对客 options（catalog 下发给前端渲染 chip）
  descriptor.params = buildParamOptions(descriptor);
  return descriptor;
}

// ---------------------------------------------------------------- 模型装载

/** 模型描述符缓存（30s）——避免同一任务在 submit/poll 里反复查库 */
const MODELS_CACHE_TTL_MS = 30_000;
const modelsCache = new Map<string, { at: number; value: ModelDescriptor }>();

export async function loadModelDescriptor(modelId: string): Promise<ModelDescriptor> {
  const cached = modelsCache.get(modelId);
  if (cached && Date.now() - cached.at < MODELS_CACHE_TTL_MS) return cached.value;

  const row = await db().model.findUnique({
    where: { id: modelId },
    include: { channel: true },
  });
  if (!row) throw err.notFound({ modelId });

  const descriptor = toDescriptor(row, row.channel.code);
  modelsCache.set(modelId, { at: Date.now(), value: descriptor });
  return descriptor;
}

export async function loadModelByCode(
  channelId: string,
  code: string,
): Promise<ModelDescriptor | null> {
  const row = await db().model.findUnique({
    where: { channelId_code: { channelId, code } },
    include: { channel: true },
  });
  if (!row) return null;
  const descriptor = toDescriptor(row, row.channel.code);
  modelsCache.set(row.id, { at: Date.now(), value: descriptor });
  return descriptor;
}

/** MockProvider.listModels() 用：按渠道码列出模型（不做 enabled/active 过滤） */
export async function loadModelsForChannel(channelCode: string): Promise<ModelDescriptor[]> {
  const channel = await db().channel.findUnique({ where: { code: channelCode } });
  if (!channel) return [];

  const rows = await db().model.findMany({
    where: { channelId: channel.id },
    orderBy: { code: 'asc' },
  });
  return rows.map((row) => toDescriptor(row, channel.code));
}

/** 所有 active 模型（可选按 capability 过滤）—— 供 Router/catalog 使用 */
export async function allActiveModels(capability?: Capability): Promise<ModelDescriptor[]> {
  const rows = await db().model.findMany({
    where: {
      active: true,
      enabled: true,
      ...(capability ? { capabilities: { has: capability } } : {}),
    },
    include: { channel: true },
    orderBy: { code: 'asc' },
  });
  return rows.map((row) => toDescriptor(row, row.channel.code));
}

/**
 * 全量模型（含 active=false）—— Router 需要它来做"显式指定但未上线"的区分，
 * 以及给 409 提供 alternatives 建议。
 */
export async function allModels(): Promise<ModelDescriptor[]> {
  const rows = await db().model.findMany({
    include: { channel: true },
    orderBy: { code: 'asc' },
  });
  return rows.map((row) => toDescriptor(row, row.channel.code));
}

// ---------------------------------------------------------------- 凭据

const CREDS_CACHE_TTL_MS = 5 * 60 * 1000; // 5min（PRD §5.5）
const credsCache = new Map<string, { at: number; value: ChannelCreds }>();

/** 测试用：清空凭据缓存 */
export function resetCredsCache(): void {
  credsCache.clear();
}

/**
 * 取渠道凭据（Key 池中 `enabled=true` 且 `priority` 最小的一条）。
 *
 * Key 明文来源（**DB 绝不存明文**，PRD §5.5）：
 * 1. `key_ref` 以 `LK_API_KEYS` 开头 → 从 `getConfig().lkApiKeys` 按序取（能表达"第几把 Key"）
 * 2. 否则把 `key_ref` 当环境变量名，读 `process.env[keyRef]`
 *
 * 取不到 Key → `err.noHealthyProvider(300, 'no_credentials')`（503）。
 * 日志**只记脱敏后的 Key**（maskSecret），绝不打印明文。
 */
export async function getChannelCreds(channelId: string): Promise<ChannelCreds> {
  const cached = credsCache.get(channelId);
  if (cached && Date.now() - cached.at < CREDS_CACHE_TTL_MS) return cached.value;

  const cfg = getConfig();
  const channel = await db().channel.findUnique({ where: { id: channelId } });
  if (!channel) throw err.notFound({ channelId });

  // Mock 渠道不需要真实凭据：它根本不出网（`LingkeProvider` 在 MOCK_PROVIDER=true 时
  // 还有 `assertNotMockMode()` 硬保险）。若在此处强制要求 Key，Mock 模式下所有任务都会
  // 以 NO_HEALTHY_PROVIDER 失败 —— 本地联调、CI、压测将全部瘫痪（详细设计 §7.8 要求
  // CI 一律 MOCK_PROVIDER=true）。
  if (channel.code === MOCK_CHANNEL_CODE) {
    const mockCreds: ChannelCreds = {
      apiKey: 'mock-api-key-not-a-secret',
      apiKeyId: 'mock-key',
      baseUrl: channel.baseUrl || 'http://localhost:8080',
      timeoutMs: channel.timeoutMs || cfg.LK_TIMEOUT_MS,
    };
    credsCache.set(channelId, { at: Date.now(), value: mockCreds });
    return mockCreds;
  }

  const keyRow = await db().channelApiKey.findFirst({
    where: { channelId, enabled: true },
    orderBy: { priority: 'asc' },
  });

  if (!keyRow) {
    log.error({ channelId, channel: channel.code }, 'no enabled api key for channel');
    throw err.noHealthyProvider(300, 'no_credentials');
  }

  const apiKey = resolveApiKey(keyRow.keyRef);
  if (!apiKey) {
    log.error(
      { channelId, channel: channel.code, keyRef: keyRow.keyRef },
      'api key reference resolved to empty (check env var / LK_API_KEYS)',
    );
    throw err.noHealthyProvider(300, 'no_credentials');
  }

  const creds: ChannelCreds = {
    apiKey,
    apiKeyId: keyRow.id,
    baseUrl: channel.baseUrl || cfg.LK_BASE_URL,
    timeoutMs: channel.timeoutMs || cfg.LK_TIMEOUT_MS,
  };

  log.debug({ channel: channel.code, apiKey: maskSecret(apiKey), apiKeyId: keyRow.id }, 'channel creds loaded');

  credsCache.set(channelId, { at: Date.now(), value: creds });
  return creds;
}

/**
 * `key_ref` → 明文。
 * `LK_API_KEYS:0` 表示多 Key 池里第 0 把（PRD §5.3 分组级 fallback 需要多把 Key 各配策略）。
 */
export function resolveApiKey(keyRef: string): string {
  if (!keyRef) return '';

  if (keyRef.startsWith('LK_API_KEYS')) {
    const keys = getConfig().lkApiKeys;
    const idxPart = keyRef.includes(':') ? keyRef.split(':')[1] : '0';
    const idx = Number.parseInt(idxPart ?? '0', 10);
    return keys[Number.isFinite(idx) && idx >= 0 ? idx : 0] ?? keys[0] ?? '';
  }

  if (keyRef.startsWith('env:')) {
    return process.env[keyRef.slice(4)] ?? '';
  }

  // 直接当环境变量名
  return process.env[keyRef] ?? '';
}

/** 供 catalog/计费：读模型的最新定价快照（返回 null 表示尚无快照） */
export async function latestPricingSnapshot(
  modelId: string,
): Promise<{
  billingMethod: BillingMethod;
  basePrice: number;
  minPrice: number;
  outputTokenPrice: number | null;
  avgResponseSeconds: number | null;
  successRate24h: number | null;
} | null> {
  const row = await db().modelPricingSnapshot.findFirst({
    where: { modelId },
    orderBy: { capturedAt: 'desc' },
  });
  if (!row) return null;
  return {
    billingMethod: row.billingMethod,
    basePrice: Number(row.basePrice),
    minPrice: Number(row.minPrice),
    outputTokenPrice: row.outputTokenPrice === null ? null : Number(row.outputTokenPrice),
    avgResponseSeconds: row.avgResponseSeconds,
    successRate24h: row.successRate24h,
  };
}

export type { GenerationProvider };
