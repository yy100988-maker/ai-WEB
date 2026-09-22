/**
 * LingkeProvider —— LK888（灵客 AI / 墨然 AI）适配器。
 *
 * ⚠️ **本期不启用**：仅当 `MOCK_PROVIDER=false` 时由 `ProviderRegistry.getActiveProvider()`
 * 选中。默认部署配置为 `MOCK_PROVIDER=true`，因此这条路径在 CI/staging 不会被走到。
 * 生产启用前必须完成 `tests/contract/lingke.contract.test.ts` 全绿 + 真实 POC 对账。
 *
 * 上游真实报文以 `docs/lk888-capabilities.md` 为准；以下"为什么"是踩坑总结（PRD 附录 D）：
 *
 * 1. **成功判定不一致**：`POST /v1/media/generate` 必须判 `code === 200`，
 *    **不能看 HTTP 状态码**——平台会用 200 返回业务失败，也可能用非 200 返回成功体。
 * 2. **终态判定必须看 `is_final=true`**：`status` 是中文文本（"已完成"/"生成失败"），
 *    `status_group` 是另一套中文分组，都不可靠（且可能本地化变更）。只有 `is_final`
 *    是布尔契约。
 * 3. **不传 `notify_url`**：首期纯轮询（详细设计 §3.3）。传了回调会引入"回调与轮询
 *    双写终态"的竞态，收益不足以抵消风险。
 * 4. **不传 `channel_group`**：请求体字段与 `X-Channel-Group` 头**均被平台忽略**，
 *    传了只会造成"以为能控制分组"的误解。分组 fallback 必须靠多把 Key。
 * 5. **不重提任务**：`result_url` 是稳定直链，下载失败只能重试下载。
 *    重提会重复扣费（任务已在上游结算）。
 */

import { request } from 'undici';
import type {
  Capability,
  ChannelCreds,
  GenerationProvider,
  GenerationRequest,
  MappedError,
  ModelDescriptor,
  PollOutput,
  PollResult,
  SubmitResult,
  ValidationResult,
} from '../../core/types.js';
import { CAPABILITIES } from '../../core/types.js';
import { maskSecret, getConfig } from '../../core/config.js';
import { childLogger } from '../../core/logger.js';
import { validateRequest, mapParamsToUpstream } from './validate.js';
import { loadModelsForChannel } from './registry.js';

const log = childLogger({ mod: 'lingke-provider' });

// ---------------------------------------------------------------- 报文收窄

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function asString(v: unknown): string | undefined {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return undefined;
}

function asNumber(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function asBoolean(v: unknown): boolean | undefined {
  if (typeof v === 'boolean') return v;
  return undefined;
}

// ---------------------------------------------------------------- 错误类型

/** LK888 错误 type（§8 错误码表） */
export type LingkeErrorType =
  | 'invalid_request_error'
  | 'authentication_error'
  | 'insufficient_balance'
  | 'not_found'
  | 'rate_limit_exceeded'
  | 'upstream_error'
  | 'server_error';

/** `/v1/skills/*` 的统一错误体：`{ error: { type, message } }` */
interface LingkeErrorBody {
  type: string;
  message: string;
}

/**
 * 判断载荷是否为**传输层**错误体（`{ error: { type, message } }`）。
 *
 * ⚠️ 关键区分（真实踩坑）：
 * task-status 的**成功**响应里也有一个 `error` 字段 —— 任务失败时它是
 * `{ type: 'upstream_error', message: '...' }`，任务成功时是 `null`。
 * 如果只看"有没有 error 对象"，就会把**任务级失败**误判成**接口级错误**并抛异常，
 * 导致 Worker 把"任务失败（应走终态 + 退费）"错当成"轮询失败（应继续重试）"。
 *
 * 因此这里要求错误体**同时**满足：
 * - 有 `error.type`（字符串）
 * - **且不是任务状态报文** —— 任务状态报文一定带 `task_id` 或 `is_final`。
 */
function extractErrorBody(payload: unknown): LingkeErrorBody | null {
  const obj = asRecord(payload);
  const e = obj['error'];
  if (e === undefined || e === null) return null;

  const er = asRecord(e);
  const type = asString(er['type']);
  if (!type) return null;

  // 任务状态报文里的 error 是"这个任务失败了"，不是"这次接口调用失败了"
  const looksLikeTaskStatus = obj['task_id'] !== undefined || obj['is_final'] !== undefined;
  if (looksLikeTaskStatus) return null;

  const message = asString(er['message']) ?? asString(obj['msg']) ?? 'unknown upstream error';
  return { type, message };
}

/**
 * 通用传输层错误体提取（**不区分**是否任务状态报文）。
 * `POST /v1/media/generate` 的失败路径用它 —— 生成响应里不可能有 `task_id` 语义的 error。
 */
function extractTransportError(payload: unknown): LingkeErrorBody | null {
  const obj = asRecord(payload);
  const e = obj['error'];
  const er = asRecord(e);
  const type = asString(er['type']) ?? asString(er['code']);
  if (!type) return null;
  const message = asString(er['message']) ?? asString(obj['msg']) ?? 'unknown upstream error';
  return { type, message };
}

/** 任务状态报文里的 `error` 字段（任务级失败原因），与传输层错误区分开 */
function taskLevelError(body: Record<string, unknown>): { type?: string; message?: string } | null {
  const e = body['error'];
  if (e === undefined || e === null) return null;
  const er = asRecord(e);
  return { type: asString(er['type']), message: asString(er['message']) };
}

/**
 * 上游错误 → Provider 无关的统一错误（详细设计 §4.2 错误映射表）。
 *
 * | 上游 type | 我方 code | retryable |
 * |---|---|---|
 * | `invalid_request_error` | `INVALID_PARAMS` | false（参数类重试无效） |
 * | `insufficient_balance` | `PLATFORM_BALANCE` | false（触发 P0 告警，需充值） |
 * | `rate_limit_exceeded` | `RATE_LIMITED` | true（退避重试） |
 * | `upstream_error` | `PROVIDER_ERROR` | true（余额已退，5~30s 可原样重提） |
 * | 其他 | `PROVIDER_ERROR` | true |
 */
export function mapLingkeErrorType(type: string): MappedError {
  switch (type) {
    case 'invalid_request_error':
      return {
        code: 'INVALID_PARAMS',
        retryable: false,
        userMessage: '生成参数不被上游接受，请调整参数后重试',
      };
    case 'insufficient_balance':
      return {
        code: 'PLATFORM_BALANCE',
        retryable: false,
        userMessage: '平台算力不足，请稍后重试或联系客服',
      };
    case 'authentication_error':
      return {
        code: 'PLATFORM_BALANCE',
        retryable: false,
        userMessage: '渠道凭据异常，请联系客服',
      };
    case 'rate_limit_exceeded':
      return {
        code: 'RATE_LIMITED',
        retryable: true,
        userMessage: '请求过于频繁，请稍后重试',
      };
    case 'upstream_error':
      return {
        code: 'PROVIDER_ERROR',
        retryable: true,
        userMessage: '上游临时故障，请稍后重试',
      };
    case 'not_found':
      return { code: 'NOT_FOUND', retryable: false, userMessage: '模型或任务不存在' };
    case 'server_error':
    default:
      return { code: 'PROVIDER_ERROR', retryable: true, userMessage: '上游服务异常，请稍后重试' };
  }
}

/** 内容政策类关键字（PRD：内容政策类失败应改提示词，重试无效） */
const CONTENT_KEYWORDS = ['content', 'policy', 'sensitive', 'violat', 'safety', '审核', '违规', '敏感'];

function looksLikeContentRejection(message: string): boolean {
  const m = message.toLowerCase();
  return CONTENT_KEYWORDS.some((k) => m.includes(k));
}

// ---------------------------------------------------------------- Mock 模式硬保险

/**
 * **运行时硬保险**（防止误接线真的打上游）。
 *
 * 正常路径下 `ProviderRegistry.getActiveProvider()` 在 `MOCK_PROVIDER=true` 时
 * 直接返回 MockProvider，`LingkeProvider` **根本不会被实例化**。
 * 但"不会被实例化"是调用方的约定，不是这个类自身的保证 ——
 * 一旦将来有人直接 `new LingkeProvider()`（测试、脚本、重构失误），
 * Mock 模式的"零上游费用"保证就破了。
 *
 * 所以在**发请求的唯一出口**上再拦一道：Mock 模式下拒绝出网。
 * 这样即使接线错了，也只是抛一个明确的错，而不是悄悄产生真实费用。
 */
export class MockModeViolationError extends Error {
  constructor(operation: string) {
    super(
      `LingkeProvider.${operation}() refused: MOCK_PROVIDER=true ` +
        '(use MockProvider; live upstream calls are disabled in mock mode)',
    );
    this.name = 'MockModeViolationError';
  }
}

function assertNotMockMode(operation: string): void {
  if (getConfig().MOCK_PROVIDER) {
    log.error({ operation }, 'lingke provider invoked while MOCK_PROVIDER=true (refused)');
    throw new MockModeViolationError(operation);
  }
}

// ---------------------------------------------------------------- 路径拼接

/**
 * 拼接上游 URL。
 *
 * ⚠️ `LK_BASE_URL` 默认是 `https://api.lk888.ai/api`（**已含 `/api`**），
 * 而端点常量以 `/v1/...` 开头，所以这里只需去掉重复斜杠，**不能**再补 `/api`。
 */
export function joinUrl(baseUrl: string, path: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${base}${p}`;
}

// ---------------------------------------------------------------- LingkeProvider

/** 提交端点（base 已含 /api） */
const PATH_GENERATE = '/v1/media/generate';
/** 任务状态端点（主推） */
const PATH_TASK_STATUS = '/v1/skills/task-status';
/** 模型目录端点 */
const PATH_MODELS = '/v1/skills/models';
/** 余额端点（PRD 附录 D：提交前预检） */
const PATH_BALANCE = '/v1/skills/balance';

export interface LingkeProviderOptions {
  /** 覆盖 baseUrl（测试用；默认从 creds 取） */
  baseUrl?: string;
  /** 覆盖超时（测试用） */
  timeoutMs?: number;
}

export class LingkeProvider implements GenerationProvider {
  readonly channelCode = 'lk888';
  readonly supportedCapabilities: Capability[] = [...CAPABILITIES];

  private readonly opts: LingkeProviderOptions;

  constructor(opts: LingkeProviderOptions = {}) {
    this.opts = opts;
  }

  private baseUrl(creds: ChannelCreds): string {
    return this.opts.baseUrl ?? creds.baseUrl;
  }

  private timeout(creds: ChannelCreds): number {
    return this.opts.timeoutMs ?? creds.timeoutMs;
  }

  // -------------------------------------------------------------- 请求辅助

  /**
   * 统一发请求。
   * - `Authorization: Bearer <apiKey>`（明文只在内存与 header 中流转）
   * - `X-Request-Id`：全链路追踪（详细设计 §6.1）
   * - 日志**只用 maskSecret 脱敏后的 Key**
   *
   * 这是本类**唯一的出网出口**，所以 Mock 模式硬保险也放在这里。
   */
  private async call(input: {
    method: 'GET' | 'POST';
    url: string;
    creds: ChannelCreds;
    requestId: string;
    body?: unknown;
    query?: Record<string, string>;
  }): Promise<{ statusCode: number; payload: unknown }> {
    // Mock 模式下绝不发出任何上游请求（硬保险，见 assertNotMockMode 注释）
    assertNotMockMode(`${input.method} ${new URL(input.url).pathname}`);

    const url = new URL(input.url);
    if (input.query) {
      for (const [k, v] of Object.entries(input.query)) url.searchParams.set(k, v);
    }

    const res = await request(url.toString(), {
      method: input.method,
      headers: {
        Authorization: `Bearer ${input.creds.apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-Request-Id': input.requestId,
      },
      ...(input.body !== undefined ? { body: JSON.stringify(input.body) } : {}),
      headersTimeout: this.timeout(input.creds),
      bodyTimeout: this.timeout(input.creds),
    });

    const text = await res.body.text();
    let payload: unknown = null;
    if (text.length > 0) {
      try {
        payload = JSON.parse(text) as unknown;
      } catch {
        payload = { raw: text.slice(0, 500) };
      }
    }

    log.debug(
      {
        method: input.method,
        path: url.pathname,
        statusCode: res.statusCode,
        apiKey: maskSecret(input.creds.apiKey),
        requestId: input.requestId,
      },
      'lingke upstream call',
    );

    return { statusCode: res.statusCode, payload };
  }

  // -------------------------------------------------------------- validate

  validate(req: GenerationRequest, model: ModelDescriptor): ValidationResult {
    return validateRequest(req, model);
  }

  async listModels(): Promise<ModelDescriptor[]> {
    // 渠道模型目录以 DB 为准（价格同步任务会写回 models 表）；
    // 上游 /v1/skills/models 只用于人工核对，失败不影响运行。
    try {
      return await loadModelsForChannel(this.channelCode);
    } catch (e) {
      log.warn({ err: e }, 'listModels fallback failed');
      return [];
    }
  }

  // -------------------------------------------------------------- submit

  /**
   * 提交生成任务。
   *
   * 成功判定：**`code === 200`**（不是 HTTP 状态码！平台会用 200 返回业务错误）。
   * 任务 ID：读 `data.task_id`。中文兼容字段（`任务ids`/`对话组ID`/`成功数量`）即将下线，
   * 这里**完全不读它们**，只把它们原样留在 raw 里 —— 上游删掉这些字段也不会让解析炸掉。
   */
  async submit(
    req: GenerationRequest,
    model: ModelDescriptor,
    creds: ChannelCreds,
  ): Promise<SubmitResult> {
    const mapped = mapParamsToUpstream(req, model);

    const body: Record<string, unknown> = {
      model: model.code,
      prompt: req.prompt,
      params: mapped,
      // 不传 notify_url：首期纯轮询（详细设计 §3.3）
      // 不传 channel_group：平台忽略该字段（PRD 附录 D）
    };
    if (req.negativePrompt) body['negative_prompt'] = req.negativePrompt;

    const url = joinUrl(this.baseUrl(creds), PATH_GENERATE);
    const { statusCode, payload } = await this.call({
      method: 'POST',
      url,
      creds,
      requestId: `gen-${req.taskId}`,
      body,
    });

    const obj = asRecord(payload);
    const code = asNumber(obj['code']);

    // ---- 成功判定只看 code === 200 ----
    if (code !== 200) {
      const errBody = extractTransportError(payload);
      const msg = errBody?.message ?? asString(obj['msg']) ?? `upstream code=${String(code)}`;
      const type = errBody?.type ?? 'server_error';
      log.error(
        { model: model.code, statusCode, code, type, apiKey: maskSecret(creds.apiKey) },
        'lingke submit rejected (code != 200)',
      );
      const e = new Error(`lingke submit failed: ${type}: ${msg}`) as Error & {
        lingkeType?: string;
        httpStatus?: number;
      };
      e.lingkeType = type;
      e.httpStatus = statusCode;
      throw e;
    }

    const data = asRecord(obj['data']);
    const taskId = asString(data['task_id']);

    if (!taskId) {
      // code=200 但没有 task_id：平台异常。绝不能猜字段（中文兼容字段即将下线）。
      const e = new Error('lingke submit: code=200 but data.task_id missing') as Error & {
        lingkeType?: string;
      };
      e.lingkeType = 'server_error';
      log.error({ model: model.code, keys: Object.keys(data) }, 'lingke submit missing task_id');
      throw e;
    }

    log.info(
      { model: model.code, externalJobId: taskId, channelGroup: model.channelCode },
      'lingke submitted',
    );

    return { externalJobId: String(taskId), raw: payload };
  }

  // -------------------------------------------------------------- poll

  /**
   * 查询任务状态。
   *
   * - 成功判定：`/v1/skills/*` 判**有无 `error` 对象**（不是 code=200）
   * - 终态判定：**必须 `is_final === true`**。`status`("已完成") 与 `status_group`
   *   是中文文本且可能变更，`state` 只有 success/failed 两值 —— 都不能单独当终态依据。
   * - `refunded=true` 的失败：上游已退费，可原样重提（5~30s 间隔）。
   */
  async poll(
    externalJobId: string,
    model: ModelDescriptor,
    creds: ChannelCreds,
  ): Promise<PollResult> {
    const url = joinUrl(this.baseUrl(creds), PATH_TASK_STATUS);
    const { statusCode, payload } = await this.call({
      method: 'GET',
      url,
      creds,
      requestId: `poll-${externalJobId}`,
      query: { task_id: externalJobId },
    });

    // ---- 成功判定：有无**传输层** error 对象 ----
    // （任务级 error 由下面的 taskLevelError 处理，不能在这里抛错）
    const errBody = extractErrorBody(payload);
    if (errBody) {
      log.warn(
        { externalJobId, type: errBody.type, statusCode, model: model.code },
        'lingke poll returned transport error',
      );
      const e = new Error(`lingke poll failed: ${errBody.type}: ${errBody.message}`) as Error & {
        lingkeType?: string;
      };
      e.lingkeType = errBody.type;
      throw e;
    }

    // 平台把任务体直接放在顶层（实测），也兼容 { data: {...} } 包装
    const obj = asRecord(payload);
    const data = asRecord(obj['data']);
    const body: Record<string, unknown> = Object.keys(data).length > 0 ? data : obj;

    const isFinal = asBoolean(body['is_final']) === true;
    const stateText = asString(body['state']) ?? '';
    const statusText = asString(body['status']) ?? '';
    const progressRaw = asNumber(body['progress']);
    /**
     * 实际命中的渠道分组（如 `TX-Y3` / `火山官方`）。
     * 平台字段名是 `channel_group`（**只读**记录，请求侧无法指定 —— 附录 D）。
     * `status_group` 是中文任务分组（等待中/进行中/已完成），与渠道分组无关，不可混用。
     */
    const channelGroup = asString(body['channel_group']);
    const refunded = asBoolean(body['refunded']);
    const cost = asNumber(body['cost']);
    const resultUrl = asString(body['result_url']);
    const resultUrls = Array.isArray(body['result_urls'])
      ? body['result_urls'].filter((x): x is string => typeof x === 'string')
      : [];
    const resultType = asString(body['result_type']);

    // ---- 未终态：继续轮询 ----
    // 注意：即使 state=success 但 is_final=false，也必须判**未**终态（平台可能仍在写结果）
    if (!isFinal) {
      const progress = progressRaw !== undefined ? clampProgress(progressRaw) : undefined;
      return {
        state: stateText === 'success' ? 'running' : 'running',
        ...(progress !== undefined ? { progress } : {}),
        isFinal: false,
        raw: payload,
      };
    }

    // ---- 终态：state 映射 success → succeeded ----
    const succeeded = stateText === 'success' || (!stateText && !!resultUrl);
    const urls = resultUrls.length > 0 ? resultUrls : resultUrl ? [resultUrl] : [];

    if (succeeded) {
      const outputs: PollOutput[] = urls.map((u) => ({
        mimeType: mimeFromResultType(resultType, model.code),
        remoteUrl: u,
        meta: metaFromStatus(body),
      }));

      return {
        state: 'succeeded',
        progress: 100,
        isFinal: true,
        outputs,
        ...(cost !== undefined ? { costUnits: cost } : {}),
        ...(refunded !== undefined ? { refunded } : {}),
        ...(channelGroup !== undefined ? { channelGroup } : {}),
        raw: payload,
      };
    }

    // ---- 终态失败：任务级 error（不是传输层错误） ----
    const platformError = taskLevelError(body);
    const errMsg = platformError?.message ?? statusText ?? 'upstream generation failed';
    const errType = platformError?.type ?? 'upstream_error';

    /**
     * `refunded=true` 的失败（上游超时/内部错误）余额已退回，可用原参数安全重提；
     * 内容政策类被拒应调整提示词；参数不合法类重试无效（PRD §8 / 附录 D）。
     */
    const retryable = refunded === true || errType === 'upstream_error';
    const code = looksLikeContentRejection(errMsg) ? 'CONTENT_REJECTED' : 'PROVIDER_ERROR';

    log.warn(
      { externalJobId, model: model.code, errType, refunded, retryable },
      'lingke task failed at upstream',
    );

    return {
      state: 'failed',
      isFinal: true,
      error: { code, message: errMsg, retryable },
      ...(refunded !== undefined ? { refunded } : {}),
      ...(cost !== undefined ? { costUnits: cost } : {}),
      ...(channelGroup !== undefined ? { channelGroup } : {}),
      raw: payload,
    };
  }

  // -------------------------------------------------------------- cancel

  /**
   * 取消任务。
   *
   * LK888 **未提供**任务取消端点（docs 只有 task-status 查询）。
   * 按契约"平台不支持则静默成功"，让调用方走本地终态 + 全额返还 —— 
   * 否则用户会卡在一个永远取消不掉的任务上。
   */
  async cancel(externalJobId: string, model: ModelDescriptor, creds: ChannelCreds): Promise<void> {
    log.info(
      { externalJobId, model: model.code, apiKey: maskSecret(creds.apiKey) },
      'lingke cancel unsupported by upstream; local terminal state only',
    );
    // 静默成功：不抛错，调用方据此本地置 cancelled 并返还积分
  }

  // -------------------------------------------------------------- mapError

  /** 统一错误映射：优先用上游 type，回落消息关键字判断，最后兜底 PROVIDER_ERROR */
  mapError(error: unknown): MappedError {
    const t = error as { lingkeType?: string; statusCode?: number; httpStatus?: number };

    if (t && typeof t.lingkeType === 'string') {
      return mapLingkeErrorType(t.lingkeType);
    }

    // undici 网络层错误（超时/连接失败）→ 可重试
    if (error instanceof Error) {
      const name = error.name;
      if (
        name === 'HeadersTimeoutError' ||
        name === 'BodyTimeoutError' ||
        name === 'ConnectTimeoutError' ||
        name === 'RequestAbortedError'
      ) {
        return { code: 'PROVIDER_ERROR', retryable: true, userMessage: '上游响应超时，请稍后重试' };
      }
      if (looksLikeContentRejection(error.message)) {
        return {
          code: 'CONTENT_REJECTED',
          retryable: false,
          userMessage: '提示词包含违规内容，请调整后重试',
        };
      }
    }

    const status = t?.statusCode ?? t?.httpStatus;
    if (status === 429) return mapLingkeErrorType('rate_limit_exceeded');
    if (status === 402) return mapLingkeErrorType('insufficient_balance');
    if (status === 401 || status === 403) return mapLingkeErrorType('authentication_error');
    if (status === 400) return mapLingkeErrorType('invalid_request_error');

    log.error({ err: error }, 'lingke unmapped error');
    return { code: 'PROVIDER_ERROR', retryable: true, userMessage: '上游服务异常，请稍后重试' };
  }

  /** 余额预检（PRD 附录 D：平台余额耗尽会导致全站不可用 → P0 告警） */
  async balance(creds: ChannelCreds): Promise<number | null> {
    try {
      const url = joinUrl(this.baseUrl(creds), PATH_BALANCE);
      const { payload } = await this.call({
        method: 'GET',
        url,
        creds,
        requestId: 'balance-check',
      });
      if (extractErrorBody(payload)) return null;
      const obj = asRecord(payload);
      const data = asRecord(obj['data']);
      const body = Object.keys(data).length > 0 ? data : obj;
      return asNumber(body['balance']) ?? asNumber(body['remain']) ?? null;
    } catch (e) {
      log.warn({ err: e }, 'balance check failed');
      return null;
    }
  }

  /** 模型目录（可选 / 排障用；失败返回 [] 不抛） */
  async remoteModels(creds: ChannelCreds, type?: string): Promise<unknown[]> {
    try {
      const url = joinUrl(this.baseUrl(creds), PATH_MODELS);
      const { payload } = await this.call({
        method: 'GET',
        url,
        creds,
        requestId: 'models-list',
        ...(type ? { query: { type } } : {}),
      });
      if (extractErrorBody(payload)) return [];
      const obj = asRecord(payload);
      const data = obj['data'];
      if (Array.isArray(data)) return data;
      if (Array.isArray(obj['models'])) return obj['models'] as unknown[];
      return [];
    } catch (e) {
      log.warn({ err: e }, 'remote models list failed');
      return [];
    }
  }
}

// ---------------------------------------------------------------- 辅助

function clampProgress(v: number): number {
  return Math.min(100, Math.max(0, Math.round(v)));
}

/**
 * 产物 mimeType。
 * 优先看 `result_type`；缺失时按模型能力猜测 —— 但**不猜视频/图片的具体编码**，
 * 统一给 `video/mp4`/`image/png`/`audio/mpeg` 中与 result_type 最接近的默认值。
 * transfer 队列还会做魔数校验，所以这里错了也不会污染对象存储。
 */
function mimeFromResultType(resultType: string | undefined, modelCode: string): string {
  switch (resultType) {
    case 'video':
      return 'video/mp4';
    case 'image':
      return 'image/png';
    case 'audio':
      return 'audio/mpeg';
    default:
      break;
  }
  // TTS / 音乐类模型 → 音频
  if (/tts|music|speech|suno|voice/i.test(modelCode)) return 'audio/mpeg';
  if (/image|seedream|banana|mj_|qwen-image|wan.*image/i.test(modelCode)) return 'image/png';
  return 'video/mp4';
}

/**
 * 从状态报文里挖尺寸/时长元信息。
 * 平台只稳定给 `duration_seconds`（任务耗时，**不是成片时长**），
 * 而 `assets.duration_sec` 语义是成片时长 —— 所以这里**不写 durationSec**，
 * 交给 transfer 阶段用 ffprobe 或产物元数据补。宽高由 `width`/`height` 可选提供。
 */
function metaFromStatus(body: Record<string, unknown>): PollOutput['meta'] {
  const width = asNumber(body['width']) ?? asNumber(body['video_width']) ?? 0;
  const height = asNumber(body['height']) ?? asNumber(body['video_height']) ?? 0;
  return { width: Math.round(width), height: Math.round(height) };
}
