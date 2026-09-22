/**
 * 参数映射与校验（PRD §5.4）—— MockProvider 与 LingkeProvider **共用**同一份逻辑。
 *
 * 设计要点：
 * - 校验与映射都由 `model.paramMapping`（声明式映射表）驱动，新增模型不改业务代码。
 * - `validateRequest()` 在**提交上游之前**拦截非法组合（如 gk-video-3 要 30 秒），
 *   返回 400 INVALID_PARAMS 并给出该模型支持的取值。
 * - `mapParamsToUpstream()` 只输出**上游认识的字段**，内部键（count/seed/__mockFail）一律丢弃。
 * - `buildParamOptions()` 反向派生对客 `params.options`（驱动前端 chip 渲染），
 *   里面**绝不能出现上游内部代号**（上游字段名只存在于 target）。
 */

import type {
  AssetRef,
  ModelDescriptor,
  ModelParamOptions,
  ParamMappingEntry,
  ValidationResult,
} from '../../core/types.js';

/** 内部参数键（不属于任何模型的映射表，映射时必须忽略） */
const INTERNAL_PARAM_KEYS = new Set(['count', 'seed', '__mockFail', '__mockFailMode']);

/** 校验过程中的最小请求画像（Service 层在校验时还没有 inputs，只传 params） */
export interface ValidatableRequest {
  /** 任务 ID；Service 层在校验阶段尚未生成时传占位值（校验逻辑不使用） */
  taskId?: string;
  /** 能力标识（校验逻辑不使用，仅便于日志/断链排查） */
  capability?: string;
  /** 幂等键（校验逻辑不使用，仅便于日志/断链排查） */
  idempotencyKey?: string;
  /** 模型 code（校验逻辑不使用，仅便于日志/断链排查） */
  modelCode?: string;
  /** 渠道 code（校验逻辑不使用，仅便于日志/断链排查） */
  channelCode?: string;
  prompt: string;
  negativePrompt?: string;
  params: Record<string, string | number | boolean | string[]>;
  inputs?: AssetRef[];
}

// ---------------------------------------------------------------- 类型判别

/** 媒体分类：用于 maxInputImages / maxInputVideos / maxInputAudios 计数 */
type AssetKind = 'image' | 'video' | 'audio';

function classifyMime(mimeType: string): AssetKind | null {
  const m = mimeType.toLowerCase().split(';')[0]?.trim() ?? '';
  if (m.startsWith('image/')) return 'image';
  if (m.startsWith('video/')) return 'video';
  if (m.startsWith('audio/')) return 'audio';
  return null;
}

function isUrl(v: string): boolean {
  if (!v) return false;
  try {
    const u = new URL(v);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/** data: URI 判定 —— 视频输入**禁止** base64（LK888 平台约束） */
function isBase64DataUri(v: string): boolean {
  return /^data:[^;,]*;base64,/i.test(v);
}

function isIntegerValue(v: number): boolean {
  return Number.isInteger(v);
}

// ---------------------------------------------------------------- 单值校验

interface FieldError {
  param: string;
  message: string;
  allowed?: Array<string | number>;
}

/**
 * 校验单个参数值。
 * 返回错误数组（空数组表示通过）。
 *
 * 注意 `select` 的 allowed 里数字可能是 number 型（如 duration: [6, 10]），
 * 而前端/DB 过来的值可能是字符串 '6' —— 两边都做宽松匹配，避免"6" 与 6 打架。
 */
function checkScalar(
  key: string,
  value: string | number | boolean | string[],
  entry: ParamMappingEntry,
): FieldError[] {
  const errors: FieldError[] = [];
  const type = entry.type;

  // 数组型参数（multiple: true）：长度 + 逐元素校验
  if (Array.isArray(value)) {
    if (entry.multiple !== true) {
      errors.push({ param: key, message: `参数 ${key} 不接受数组` });
      return errors;
    }
    const maxItems = entry.maxItems;
    if (maxItems !== undefined && value.length > maxItems) {
      errors.push({
        param: key,
        message: `参数 ${key} 最多 ${maxItems} 项，收到 ${value.length} 项`,
      });
    }
    for (const item of value) {
      errors.push(...checkScalar(key, item, { ...entry, multiple: false }));
    }
    return errors;
  }

  switch (type) {
    case 'select': {
      if (entry.allowed && entry.allowed.length > 0) {
        const hit = entry.allowed.some((a) => looseEquals(a, value));
        if (!hit) {
          errors.push({
            param: key,
            message: `参数 ${key} 取值非法，仅支持：${entry.allowed.join(' / ')}`,
            allowed: entry.allowed,
          });
        }
      }
      break;
    }

    case 'int': {
      const num = typeof value === 'number' ? value : Number(value);
      if (!Number.isFinite(num) || !isIntegerValue(num)) {
        errors.push({ param: key, message: `参数 ${key} 必须是整数` });
        break;
      }
      if (entry.min !== undefined && num < entry.min) {
        errors.push({ param: key, message: `参数 ${key} 不能小于 ${entry.min}` });
      }
      if (entry.max !== undefined && num > entry.max) {
        errors.push({ param: key, message: `参数 ${key} 不能大于 ${entry.max}` });
      }
      break;
    }

    case 'bool': {
      if (typeof value === 'boolean') break;
      if (value === 'true' || value === 'false') break;
      errors.push({ param: key, message: `参数 ${key} 必须是布尔值` });
      break;
    }

    case 'url': {
      if (typeof value !== 'string' || !isUrl(value)) {
        errors.push({ param: key, message: `参数 ${key} 必须是 http/https URL` });
      }
      break;
    }

    case 'base64': {
      if (typeof value !== 'string' || !isBase64DataUri(value)) {
        errors.push({ param: key, message: `参数 ${key} 必须是 data:<mime>;base64, 格式` });
      }
      break;
    }

    case 'string': {
      if (typeof value !== 'string') {
        errors.push({ param: key, message: `参数 ${key} 必须是字符串` });
      }
      break;
    }

    default: {
      // 防御：新增 type 时这里会暴露出来
      const never: never = type;
      errors.push({ param: key, message: `未知参数类型 ${String(never)}` });
    }
  }

  return errors;
}

/** 宽松相等：数字 6 与字符串 '6' 视为相同（select allowed 常为数字） */
function looseEquals(a: string | number, b: string | number | boolean): boolean {
  if (typeof b === 'boolean') return String(a) === String(b);
  if (a === b) return true;
  return String(a) === String(b);
}

// ---------------------------------------------------------------- validateRequest

/**
 * 校验请求参数（PRD §5.4）。
 *
 * 规则：
 * 1. 遍历 `model.paramMapping`，对 `req.params` 里**出现**的键按 type 校验；
 * 2. `model.requiredParams` 中的键必须存在（LK888 平台对 required=true 不填默认值，会直接报错）；
 * 3. constraints：maxPromptChars / maxInputImages|Videos|Audios / videoNeedsUrl / fixedResolution。
 *
 * 未出现在 paramMapping 里的参数**不报错也不透传**（向上兼容上游新增字段）；
 * 显式传了上游不认识的参数（如 hailuo-h3 传 mode）由 mapParamsToUpstream 静默丢弃。
 */
export function validateRequest(req: ValidatableRequest, model: ModelDescriptor): ValidationResult {
  const errors: FieldError[] = [];
  const params = req.params ?? {};
  const mapping = model.paramMapping ?? {};

  // ---- 1. 逐参数类型/取值校验 ----
  for (const [key, entry] of Object.entries(mapping)) {
    const value = params[key];
    if (value === undefined || value === null) continue;
    if (typeof value === 'string' && value === '') continue; // 空串视同未传
    errors.push(...checkScalar(key, value, entry));
  }

  // ---- 2. 必填参数（上游 required=true 不补默认值） ----
  for (const key of model.requiredParams ?? []) {
    const value = params[key];
    const missing =
      value === undefined ||
      value === null ||
      (typeof value === 'string' && value === '') ||
      (Array.isArray(value) && value.length === 0);
    if (missing) {
      const entry = mapping[key];
      errors.push({
        param: key,
        message: `缺少必填参数 ${key}${entry?.allowed ? `（可选值：${entry.allowed.join(' / ')}）` : ''}`,
        ...(entry?.allowed ? { allowed: entry.allowed } : {}),
      });
    }
  }

  // ---- 3. 约束 ----
  const c = model.constraints ?? {};

  if (c.maxPromptChars !== undefined && req.prompt.length > c.maxPromptChars) {
    errors.push({
      param: 'prompt',
      message: `提示词超长：最多 ${c.maxPromptChars} 字符，当前 ${req.prompt.length} 字符`,
    });
  }

  const inputs = req.inputs ?? [];
  if (inputs.length > 0) {
    const counts: Record<AssetKind, number> = { image: 0, video: 0, audio: 0 };
    for (const input of inputs) {
      const kind = classifyMime(input.mimeType);
      if (kind) counts[kind] += 1;
    }

    if (c.maxInputImages !== undefined && counts.image > c.maxInputImages) {
      errors.push({
        param: 'inputs',
        message: `输入图片最多 ${c.maxInputImages} 张，收到 ${counts.image} 张`,
      });
    }
    if (c.maxInputVideos !== undefined && counts.video > c.maxInputVideos) {
      errors.push({
        param: 'inputs',
        message: `输入视频最多 ${c.maxInputVideos} 个，收到 ${counts.video} 个`,
      });
    }
    if (c.maxInputAudios !== undefined && counts.audio > c.maxInputAudios) {
      errors.push({
        param: 'inputs',
        message: `输入音频最多 ${c.maxInputAudios} 个，收到 ${counts.audio} 个`,
      });
    }

    /**
     * 视频输入必须公网 URL —— **LK888 不支持 base64 视频**（PRD 附录 D）。
     * 这里同时拦截 deliveryUrl 为空、非 http(s)、以及误用 data: URI 三种情况。
     */
    if (c.videoNeedsUrl) {
      for (const input of inputs) {
        if (classifyMime(input.mimeType) !== 'video') continue;
        const url = input.deliveryUrl ?? '';
        if (isBase64DataUri(url)) {
          errors.push({
            param: 'inputs',
            message: '视频输入不支持 base64，必须提供公网 URL（平台限制）',
          });
        } else if (!isUrl(url)) {
          errors.push({
            param: 'inputs',
            message: '视频输入必须提供可公网访问的 http/https URL（平台限制）',
          });
        }
      }
    }
  }

  // ---- 4. 固定分辨率（如 gk-video-3 锁死 720P，params 里给了别的值要拦） ----
  if (c.fixedResolution !== undefined) {
    const res = params['resolution'];
    if (res !== undefined && res !== null && res !== '' && String(res) !== c.fixedResolution) {
      errors.push({
        param: 'resolution',
        message: `该模型分辨率固定为 ${c.fixedResolution}，不支持 ${String(res)}`,
        allowed: [c.fixedResolution],
      });
    }
  }

  return errors.length > 0 ? { valid: false, errors } : { valid: true };
}

// ---------------------------------------------------------------- mapParamsToUpstream

/**
 * 内部 params → 上游字段名（按 `target`），并按 `coerce` 转换类型。
 *
 * - **只输出上游认识的字段**：内部键（count/seed/`__mockFail`）与映射表外的键一律丢弃。
 *   （例：hailuo-h3 没有 mode 映射，则传 mode 被静默忽略 —— 与"平台不认这个字段"一致）
 * - 布尔值按 coerce 转 `'true'`/`'false'` 字符串（LK888 的 switch 参数是字符串）。
 * - 数组保持数组（如 images 多图）。
 */
export function mapParamsToUpstream(
  req: ValidatableRequest,
  model: ModelDescriptor,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const params = req.params ?? {};
  const mapping = model.paramMapping ?? {};

  for (const [key, entry] of Object.entries(mapping)) {
    if (INTERNAL_PARAM_KEYS.has(key)) continue;

    const value = params[key];
    if (value === undefined || value === null) continue;
    if (typeof value === 'string' && value === '') continue;

    const target = entry.target;
    const isArray = Array.isArray(value);

    if (isArray) {
      if (entry.multiple !== true) continue;
      out[target] = value.map((v) => coerceValue(v, entry));
      continue;
    }

    out[target] = coerceValue(value, entry);
  }

  return out;
}

/**
 * 类型转换。
 * 上游 switch 参数要 `'true'`/`'false'` 字符串 → coerce: 'string'；
 * 上游 select 的时长要数字 → coerce: 'number'。
 */
function coerceValue(
  value: string | number | boolean,
  entry: ParamMappingEntry,
): string | number | boolean {
  switch (entry.coerce) {
    case 'string':
      return typeof value === 'boolean' ? String(value) : String(value);
    case 'number': {
      const n = typeof value === 'number' ? value : Number(value);
      return Number.isFinite(n) ? n : value;
    }
    case 'boolean': {
      if (typeof value === 'boolean') return value;
      return value === 'true' || value === 1 || value === '1';
    }
    default:
      return value;
  }
}

// ---------------------------------------------------------------- buildParamOptions

/**
 * 由 `paramMapping` 反向派生**对客**参数定义（驱动前端 chip 动态渲染，PRD §8.4.1）。
 *
 * ⚠️ 契约断言点（§13 #10 / §7.2 catalog 单测）：
 * 对客 options
 * - key 必须是**内部参数名**（params 的键，如 `durationSec`），不是上游字段名；
 * - 里面**绝不能出现** `target`（上游内部代号，如 `aspect_ratio`、`image_url`）。
 *
 * `type` 映射：select→select、int→int、bool→bool、string/url/base64→text。url 型参数本质是
 * 交付 URL / 资产引用，前端 chip 用 `asset` 呈现更贴切，但只有当 required 且语义是输入素材
 * 时才是 asset —— 这里保守用 `text`，由 `asset` 语义交给 worker 侧的 inputs 处理。
 */
export function buildParamOptions(model: ModelDescriptor): ModelParamOptions {
  const options: ModelParamOptions = {};
  const mapping = model.paramMapping ?? {};

  for (const [key, entry] of Object.entries(mapping)) {
    if (INTERNAL_PARAM_KEYS.has(key)) continue;

    const uiType: ModelParamOptions[string]['type'] = mapUiType(entry.type);

    const option: ModelParamOptions[string] = {
      type: uiType,
      // 对客展示名 i18n key：model.{code}.param.{key}
      labelKey: `model.${model.code}.param.${key}`,
    };

    // allowed 是**内部取值**（与上游取值一致时才下发；不一致的场景本期不存在）
    if (entry.allowed && entry.allowed.length > 0) option.options = [...entry.allowed];
    if (entry.min !== undefined) option.min = entry.min;
    if (entry.max !== undefined) option.max = entry.max;
    if (entry.required === true) option.required = true;
    if (entry.multiple === true) option.multiple = true;
    if (entry.maxItems !== undefined) option.maxItems = entry.maxItems;
    if (entry.allowed && entry.allowed.length > 0) option.default = entry.allowed[0];

    options[key] = option;
  }

  // 固定分辨率：对客只暴露唯一取值
  const fixed = model.constraints?.fixedResolution;
  if (fixed !== undefined && options['resolution'] === undefined) {
    options['resolution'] = {
      type: 'select',
      options: [fixed],
      default: fixed,
      labelKey: `model.${model.code}.param.resolution`,
    };
  }

  return options;
}

function mapUiType(t: ParamMappingEntry['type']): ModelParamOptions[string]['type'] {
  switch (t) {
    case 'select':
      return 'select';
    case 'int':
      return 'int';
    case 'bool':
      return 'bool';
    case 'string':
    case 'url':
    case 'base64':
      return 'text';
    default:
      return 'text';
  }
}

/** 供测试/调试：内部键集合（映射时必须忽略） */
export function isInternalParamKey(key: string): boolean {
  return INTERNAL_PARAM_KEYS.has(key);
}
