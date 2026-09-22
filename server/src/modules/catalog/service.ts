/**
 * 目录服务的纯逻辑层（PRD §8.2 / 详细设计 §2.3）。
 *
 * ⚠️ 本文件最重要的规则：**内部 ID vs 对客展示名必须分离**（PRD §8.2）。
 * 上游模型 ID（`tt-image-2` / `seedance-2.0-guanfang` / `hailuo-h3-quannengcankao` …）
 * 是渠道侧代号，**禁止出现在任何对客字段里**。`models.display_name` 是唯一对客真源。
 *
 * 这里把"是否泄露内部代号"做成**可执行的断言函数**（`findInternalCodenameLeaks`），
 * 既供单元测试（§13 #10 / PRD §7.2 的 catalog 单测）使用，也在路由层作为**运行时兜底**：
 * 一旦运营把 display_name 误填成内部代号，接口会剔除该模型并告警，而不是把代号发给前端。
 */

import type { Model } from '@prisma/client';
import type { Capability, ModelParamOptions, ParamMappingEntry } from '../../core/types.js';
import { CAPABILITY_KIND, isCapability } from '../../core/types.js';

// ---------------------------------------------------------------- 内部代号黑名单

/**
 * 上游渠道代号片段（PRD §8.2 明确列出 + LK888 目录里的其它内部命名习惯）。
 *
 * 判定是**大小写无关的子串包含**：只要对客展示名里出现这些片段，就认为是泄露。
 * 例：`GPT Image 2` 合法（不含 tt-）；`tt-image-2` 非法。
 *
 * ⚠️ 两条容易搞错、必须用整词边界的规则（否则会误杀合法品牌名）：
 *  1. `omni-1.1` / `omni-flash` 是内部代号，但 **`Omni` 本身可以是品牌展示名**；
 *     所以用 `omni[-_]\w` 而不是裸 `omni`，且必须要求它不出现在词尾跟随大写字母的品牌写法里；
 *  2. `happyhorse` 是内部代号，而 PRD §8.2 的对客映射表里**没有**给它独立品牌名
 *     （它属于 HappyHorse 系列，对客统一叫 **HappyHorse**）。因此 `HappyHorse` 是**合法**的，
 *     要拦的是连字符写法 `happyhorse-i2v` / `happyhorse-t2v`。
 *
 * 结论：判定"内部代号"看的是**内部命名格式**（连字符 + 版本后缀 + 数字尾），
 * 不是品牌词根本身。
 */
export const INTERNAL_CODENAME_PATTERNS: readonly RegExp[] = [
  /tt-/i,
  /guanfang/i,
  /kling/i,
  /hailuo-/i,
  /seedance-/i,
  /gk-/i,
  /doubao-/i,
  /gem-/i,
  /speech-\d/i,
  /music-\d/i,
  // omni 后跟连字符/下划线再跟单词字符（omni-1.1 / omni-flash），但 `Omni 1.1` 也会被这条拦下
  /\bomni[-_]\w/i,
  // happyhorse 必须带连字符后缀才算内部代号（happyhorse-i2v / happyhorse-t2v）
  /happyhorse-/i,
  /wan\d/i,
  /wan-\d/i,
  /\bquannengcankao\b/i,
  /\bshouweizhen\b/i,
  /\banmiao\b/i,
  /-\d{6,}/, // 日期后缀如 -260628
];

/**
 * 检查一个**对客展示名**是否泄露上游内部代号。
 * 返回命中的模式描述（全部命中都返回，便于排障）；空数组 = 干净。
 */
export function findInternalCodenameLeaks(displayName: string): string[] {
  const hits: string[] = [];
  for (const re of INTERNAL_CODENAME_PATTERNS) {
    if (re.test(displayName)) hits.push(re.source);
  }
  return hits;
}

/** 展示名是否可作为对客文案（非空 + 不含内部代号） */
export function isSafeDisplayName(displayName: unknown): displayName is string {
  return (
    typeof displayName === 'string' &&
    displayName.trim().length > 0 &&
    displayName.length <= 64 &&
    findInternalCodenameLeaks(displayName).length === 0
  );
}

// ---------------------------------------------------------------- 参数派生

/**
 * 由 `models.param_mapping` 派生对客 `params` 定义（驱动 PRD §8.4.1 的"参数 chip 动态渲染"）。
 *
 * 优先复用 C 模块的 `buildParamOptions()`（`src/modules/providers/validate.ts`，
 * 单一真源）；该模块由 C 模块并行开发，若其签名/行为变化，本地实现作为等价兜底。
 * 两者语义一致：**key 用内部参数名**（params 的键，如 `durationSec`），
 * **绝不出现 `target`（上游字段名）**。
 *
 * 本地实现比 C 模块版多做两件事（都在注释里标注为什么）：
 *  1. `type: 'url' | 'base64'` 的入参语义是**用户素材**，对客应呈现为 `asset` 而非 `text`
 *     —— 前端据此渲染上传控件而不是文本框；
 *  2. 内部键（count/seed/__mockFail）一律过滤，它们不是模型参数而是平台控制项。
 */
const INTERNAL_PARAM_KEYS = new Set(['count', 'seed', '__mockFail', '__mockFailMode']);

export function deriveParamOptions(
  paramMapping: unknown,
  constraints?: unknown,
): ModelParamOptions {
  const mapping = isRecord(paramMapping) ? (paramMapping as Record<string, ParamMappingEntry>) : {};
  const cons = isRecord(constraints) ? (constraints as { fixedResolution?: string }) : {};

  const out: ModelParamOptions = {};

  for (const [key, entry] of Object.entries(mapping)) {
    if (INTERNAL_PARAM_KEYS.has(key)) continue;
    if (!isRecord(entry)) continue;

    const type = entry.type;
    const option: ModelParamOptions[string] = {
      type: mapUiType(type),
      labelKey: `model.param.${key}`,
    };

    if (Array.isArray(entry.allowed) && entry.allowed.length > 0) {
      option.options = [...entry.allowed];
      option.default = entry.allowed[0];
    }
    if (typeof entry.min === 'number') option.min = entry.min;
    if (typeof entry.max === 'number') option.max = entry.max;
    if (entry.required === true) option.required = true;
    if (entry.multiple === true) option.multiple = true;
    if (typeof entry.maxItems === 'number') option.maxItems = entry.maxItems;

    out[key] = option;
  }

  // 固定分辨率（如 gk-video-3 锁 720P）：对客只暴露唯一取值，防止前端给出无法提交的选项
  const fixed = cons.fixedResolution;
  if (typeof fixed === 'string' && fixed.length > 0 && out['resolution'] === undefined) {
    out['resolution'] = {
      type: 'select',
      options: [fixed],
      default: fixed,
      labelKey: 'model.param.resolution',
    };
  }

  return out;
}

function mapUiType(t: unknown): ModelParamOptions[string]['type'] {
  switch (t) {
    case 'select':
      return 'select';
    case 'int':
      return 'int';
    case 'bool':
      return 'bool';
    case 'url':
    case 'base64':
      return 'asset'; // 用户素材 → 前端渲染上传控件
    case 'string':
    default:
      return 'text';
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// ---------------------------------------------------------------- 列表投影

/** `GET /v1/catalog/models` 的单行（详细设计 §2.3 冻结形状） */
export interface CatalogModelRow {
  id: string;
  displayName: string;
  resolutions: string[];
  durations: string[];
  aspectRatios: string[];
  features: string[];
}

/**
 * 从 `param_mapping` 提取"规格维度"（前端旧 UI 直接读这三个数组）。
 *
 * 为什么保留这三个扁平数组而不是只给 `params`：
 * 前端"模型 chip → 参数 chip"的过渡期实现（§10 改造清单）依赖它们快速渲染，
 * 而 `params` 是给新版动态渲染用的完整定义 —— 两者共存，字段不冲突。
 *
 * 取值来源只认**内部参数名**，绝不下发上游字段名。
 */
export function extractSpecDimensions(paramMapping: unknown): {
  resolutions: string[];
  durations: string[];
  aspectRatios: string[];
} {
  const mapping = isRecord(paramMapping) ? (paramMapping as Record<string, ParamMappingEntry>) : {};

  const pick = (...keys: string[]): string[] => {
    for (const k of keys) {
      const entry = mapping[k];
      if (entry && Array.isArray(entry.allowed) && entry.allowed.length > 0) {
        return entry.allowed.map((v) => String(v));
      }
    }
    return [];
  };

  return {
    // 注意：resolutions 只认 resolution 系键。绝不能回退到 quality——
    // 生图模型（如 GPT Image 2 用 size 选尺寸、quality 另行计价维度）一旦回退，
    // 前端会把 high/medium/low 当成分辨率 chip 展示并提交，导致报价失配。
    resolutions: pick('resolution', 'resolutions'),
    durations: pick('durationSec', 'duration', 'seconds'),
    aspectRatios: pick('aspectRatio', 'aspect_ratio', 'ratio'),
  };
}

/** 能力 → 对客特性标签（features[]）。同样是 i18n key，由前端本地化。 */
export function featuresOf(capability: string): string[] {
  const base = ['hd', 'fast'];
  switch (capability) {
    case 'text_to_video':
      return [...base, 'camera_control'];
    case 'image_to_video':
      return [...base, 'first_frame'];
    case 'text_to_image':
      return [...base, 'high_res'];
    case 'image_to_image':
      return [...base, 'style_ref'];
    case 'tts':
      return ['multi_voice', 'fast'];
    case 'text_to_music':
      return ['instrumental', 'vocals'];
    case 'text_to_audio':
      return ['sound_effect'];
    default:
      return base;
  }
}

/** DB Model 行 → 对客列表行。返回 null 表示该行**不可对客展示**（调用方应过滤并告警）。 */
export function toCatalogModelRow(model: Pick<Model, 'id' | 'displayName' | 'paramMapping'>): CatalogModelRow | null {
  if (!isSafeDisplayName(model.displayName)) return null;

  const caps = (model as { capabilities?: unknown }).capabilities;
  const primary = Array.isArray(caps) ? caps.find((c): c is string => typeof c === 'string') : undefined;
  const dims = extractSpecDimensions(model.paramMapping);

  return {
    id: model.id,
    displayName: model.displayName,
    resolutions: dims.resolutions,
    durations: dims.durations,
    aspectRatios: dims.aspectRatios,
    features: featuresOf(primary ?? ''),
  };
}

/** 模型详情里的能力归类（供前端 Filter 用） */
export function capabilityKind(capability: string): 'video' | 'image' | 'audio' | 'other' {
  return isCapability(capability) ? CAPABILITY_KIND[capability as Capability] : 'other';
}
