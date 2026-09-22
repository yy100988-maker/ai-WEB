/**
 * 目录模块单测（PRD §8.2 / 详细设计 §2.3）—— §13 #10 与 §7.2 catalog 单测的落地。
 *
 * 最重要的一组：**内部 ID vs 对客展示名分离的回归断言**（PRD §8.2 硬性规则）。
 * 断言 `tt-` / `guanfang` / `kling` / `hailuo-` / `seedance-` / `gk-` 等渠道代号
 * 只允许出现在 `id` / `code` 字段，**不得出现在 `displayName`**。
 */

import { describe, expect, it } from 'vitest';
import {
  INTERNAL_CODENAME_PATTERNS,
  capabilityKind,
  deriveParamOptions,
  extractSpecDimensions,
  featuresOf,
  findInternalCodenameLeaks,
  isSafeDisplayName,
  toCatalogModelRow,
} from './service.js';
import { BUILTIN_TEMPLATES, CAPABILITY_META } from './templates.js';
import { CAPABILITIES } from '../../core/types.js';

// ================================================================ 展示名泄露回归

describe('⚠️ 内部代号泄露回归（PRD §8.2 硬性规则）', () => {
  /** PRD §8.2 / §5.2 列出的真实上游内部代号 —— 一个都不许通过 */
  const LEAKY = [
    'tt-image-2',
    'tt-image-2.5',
    'seedance-2.0-guanfang',
    'seedance-2.5-guanfang',
    'hailuo-h3',
    'hailuo-h3-quannengcankao',
    'gk-video-3',
    'gk-video-3.5',
    'doubao-seedance-2-5-260628',
    'kling-avatar-image2video',
    'wan3.0-video',
    'wan2.7-shouweizhen',
    'happyhorse-i2v',
    'seedance-2.5-anmiao-shouweizhen',
    'omni-1.1',
    'omni-flash',
    'gem-3.1-tts',
    'speech-2.8',
    'music-2.5',
    'doubao-tts-2.0',
  ];

  it.each(LEAKY)('拒绝内部代号：%s', (name) => {
    expect(isSafeDisplayName(name)).toBe(false);
    expect(findInternalCodenameLeaks(name).length).toBeGreaterThan(0);
  });

  /** PRD §8.2 明确给出的对客映射 —— 必须全部通过 */
  const SAFE = [
    'GPT Image 2',
    'GPT Image 2.5',
    'Seedance 2.0',
    'Seedance 2.5',
    'MiniMax H3',
    'GK Video 3',
    'Hailuo H3',
    'Wan 3.0',
    'HappyHorse',
    'PixVerse',
    'Wan 2.7',
    'Hailuo Max',
    'Veo 3.1',
    'Sora 2',
    'Doubao TTS',
    'Speech 2.8',
  ];

  it.each(SAFE)('接受对客展示名：%s', (name) => {
    expect(isSafeDisplayName(name)).toBe(true);
    expect(findInternalCodenameLeaks(name)).toEqual([]);
  });

  /** 内部代号带连字符的写法（omni-1.1 / omni-flash / happyhorse-i2v）也必须拦下 */
  const LEAKY_HYPHENATED = ['omni-1.1', 'omni-flash', 'happyhorse-i2v', 'happyhorse-t2v'];

  it.each(LEAKY_HYPHENATED)('拒绝带连字符的内部代号：%s', (name) => {
    expect(isSafeDisplayName(name)).toBe(false);
  });

  it('空串 / 超长 / 非字符串一律拒绝', () => {
    expect(isSafeDisplayName('')).toBe(false);
    expect(isSafeDisplayName('   ')).toBe(false);
    expect(isSafeDisplayName('x'.repeat(65))).toBe(false);
    expect(isSafeDisplayName(null)).toBe(false);
    expect(isSafeDisplayName(123)).toBe(false);
  });

  it('黑名单模式覆盖 PRD 点名的全部前缀', () => {
    const sources = INTERNAL_CODENAME_PATTERNS.map((r) => r.source).join('|');
    for (const token of ['tt-', 'guanfang', 'kling', 'hailuo-', 'seedance-', 'gk-']) {
      expect(sources).toContain(token);
    }
  });

  it('toCatalogModelRow 对泄露展示名返回 null（调用方据此剔除）', () => {
    expect(
      toCatalogModelRow({ id: 'uuid-1', displayName: 'tt-image-2', paramMapping: {} }),
    ).toBeNull();
    expect(
      toCatalogModelRow({ id: 'uuid-2', displayName: 'GPT Image 2', paramMapping: {} }),
    ).not.toBeNull();
  });

  it('toCatalogModelRow 输出结构不含任何上游字段名', () => {
    const row = toCatalogModelRow({
      id: 'uuid-3',
      displayName: 'GK Video 3',
      paramMapping: {
        durationSec: { target: 'duration', type: 'select', allowed: [6, 10] },
        aspectRatio: { target: 'aspect_ratio', type: 'select', allowed: ['16:9'] },
      },
    });
    expect(row).not.toBeNull();
    const json = JSON.stringify(row);
    expect(json).not.toContain('aspect_ratio');
    expect(json).not.toContain('"target"');
    expect(json).not.toContain('"duration"');
  });
});

// ================================================================ 列表投影

describe('toCatalogModelRow', () => {
  it('从 param_mapping 派生 resolutions/durations/aspectRatios', () => {
    const row = toCatalogModelRow({
      id: 'm1',
      displayName: 'Hailuo H3',
      paramMapping: {
        resolution: { target: 'resolution', type: 'select', allowed: ['768P', '1080P', '2K'] },
        durationSec: { target: 'duration', type: 'select', allowed: [4, 6, 10] },
        aspectRatio: { target: 'aspect_ratio', type: 'select', allowed: ['16:9', '9:16'] },
      },
    });
    expect(row).toMatchObject({
      id: 'm1',
      displayName: 'Hailuo H3',
      resolutions: ['768P', '1080P', '2K'],
      durations: ['4', '6', '10'],
      aspectRatios: ['16:9', '9:16'],
    });
  });

  it('返回的 key 集合是冻结契约', () => {
    const row = toCatalogModelRow({ id: 'm2', displayName: 'Omni Flash', paramMapping: {} });
    expect(Object.keys(row ?? {}).sort()).toEqual(
      ['aspectRatios', 'durations', 'features', 'id', 'displayName', 'resolutions'].sort(),
    );
  });

  it('无参数映射时三个数组为空（前端显示"无参数项"）', () => {
    const row = toCatalogModelRow({ id: 'm3', displayName: 'Omni Flash', paramMapping: {} });
    expect(row?.resolutions).toEqual([]);
    expect(row?.durations).toEqual([]);
    expect(row?.aspectRatios).toEqual([]);
  });

  it('param_mapping 为脏数据（null/数组/字符串）不崩', () => {
    expect(toCatalogModelRow({ id: 'm4', displayName: 'X', paramMapping: null })?.resolutions).toEqual([]);
    expect(toCatalogModelRow({ id: 'm4', displayName: 'X', paramMapping: [] })?.resolutions).toEqual([]);
    expect(toCatalogModelRow({ id: 'm4', displayName: 'X', paramMapping: 'oops' })?.resolutions).toEqual([]);
  });

  it('数字型 allowed 转字符串（前端 chip 统一按字符串渲染）', () => {
    const row = toCatalogModelRow({
      id: 'm5',
      displayName: 'Y',
      paramMapping: { durationSec: { target: 'duration', type: 'select', allowed: [6, 10] } },
    });
    expect(row?.durations).toEqual(['6', '10']);
    expect(row?.durations.every((d) => typeof d === 'string')).toBe(true);
  });
});

describe('extractSpecDimensions 别名兜底', () => {
  it('duration 与 durationSec 都能识别', () => {
    expect(
      extractSpecDimensions({ duration: { target: 'd', type: 'select', allowed: [5] } }).durations,
    ).toEqual(['5']);
    expect(
      extractSpecDimensions({ durationSec: { target: 'd', type: 'select', allowed: [8] } }).durations,
    ).toEqual(['8']);
  });

  it('aspect_ratio / aspectRatio / ratio 三选一', () => {
    expect(
      extractSpecDimensions({ aspect_ratio: { target: 'a', type: 'select', allowed: ['1:1'] } }).aspectRatios,
    ).toEqual(['1:1']);
  });

  it('空 allowed 视为无该维度', () => {
    expect(
      extractSpecDimensions({ resolution: { target: 'r', type: 'select', allowed: [] } }).resolutions,
    ).toEqual([]);
  });

  it('quality 不回退进 resolutions（生图模型用 size 选尺寸）', () => {
    expect(
      extractSpecDimensions({
        size: { target: 'size', type: 'select', allowed: ['1024x1024', '2048x2048'] },
        quality: { target: 'quality', type: 'select', allowed: ['auto', 'high', 'medium', 'low'] },
      }).resolutions,
    ).toEqual([]);
  });
});

describe('featuresOf', () => {
  it('每个能力都有非空 feature 标签', () => {
    for (const c of CAPABILITIES) {
      expect(featuresOf(c).length).toBeGreaterThan(0);
    }
  });

  it('image_to_video 带首帧标记', () => {
    expect(featuresOf('image_to_video')).toContain('first_frame');
  });

  it('未知能力回落基础标签', () => {
    expect(featuresOf('unknown_cap')).toEqual(['hd', 'fast']);
  });
});

// ================================================================ 参数派生

describe('deriveParamOptions（驱动 PRD §8.4.1 参数 chip）', () => {
  it('派生 select/int/bool/asset 类型', () => {
    const opts = deriveParamOptions({
      resolution: { target: 'resolution', type: 'select', allowed: ['720P', '1080P'] },
      durationSec: { target: 'duration', type: 'int', min: 4, max: 15 },
      audio: { target: 'with_audio', type: 'bool' },
      imageUrl: { target: 'image_url', type: 'url' },
      prompt: { target: 'prompt', type: 'string' },
    });

    expect(opts['resolution']).toMatchObject({ type: 'select', options: ['720P', '1080P'], default: '720P' });
    expect(opts['durationSec']).toMatchObject({ type: 'int', min: 4, max: 15 });
    expect(opts['audio']).toMatchObject({ type: 'bool' });
    expect(opts['imageUrl']).toMatchObject({ type: 'asset' }); // url 型 = 用户素材
    expect(opts['prompt']).toMatchObject({ type: 'text' });
  });

  it('⚠️ 绝不把 target（上游字段名）下发前端', () => {
    const opts = deriveParamOptions({
      durationSec: { target: 'duration', type: 'select', allowed: [6, 10] },
      aspectRatio: { target: 'aspect_ratio', type: 'select', allowed: ['16:9'] },
    });
    const json = JSON.stringify(opts);
    expect(json).not.toContain('aspect_ratio');
    expect(json).not.toContain('"duration"');
    expect(Object.keys(opts)).toEqual(['durationSec', 'aspectRatio']);
  });

  it('过滤平台内部键（count / seed / __mockFail）', () => {
    const opts = deriveParamOptions({
      count: { target: 'count', type: 'int' },
      seed: { target: 'seed', type: 'int' },
      __mockFail: { target: 'fail', type: 'string' },
      resolution: { target: 'resolution', type: 'select', allowed: ['720P'] },
    });
    expect(Object.keys(opts)).toEqual(['resolution']);
  });

  it('required / multiple / maxItems 透传', () => {
    const opts = deriveParamOptions({
      images: { target: 'images', type: 'url', required: true, multiple: true, maxItems: 4 },
    });
    expect(opts['images']).toMatchObject({ type: 'asset', required: true, multiple: true, maxItems: 4 });
  });

  it('固定分辨率注入唯一取值（gk-video-3 锁 720P）', () => {
    const opts = deriveParamOptions({}, { fixedResolution: '720P' });
    expect(opts['resolution']).toMatchObject({ type: 'select', options: ['720P'], default: '720P' });
  });

  it('固定分辨率不覆盖已有映射', () => {
    const opts = deriveParamOptions(
      { resolution: { target: 'resolution', type: 'select', allowed: ['720P', '1080P'] } },
      { fixedResolution: '720P' },
    );
    expect(opts['resolution']?.options).toEqual(['720P', '1080P']);
  });

  it('脏 param_mapping 不崩且返回空对象', () => {
    expect(deriveParamOptions(null)).toEqual({});
    expect(deriveParamOptions(undefined)).toEqual({});
    expect(deriveParamOptions([])).toEqual({});
    expect(deriveParamOptions('nope')).toEqual({});
  });

  it('每条 option 都带 labelKey（前端本地化用）', () => {
    const opts = deriveParamOptions({ resolution: { target: 'r', type: 'select', allowed: ['720P'] } });
    expect(opts['resolution']?.labelKey).toBe('model.param.resolution');
  });
});

// ================================================================ capabilities 元数据

describe('CAPABILITY_META', () => {
  it('10 个能力全部有 icon + 11 语种 nameI18n + kind', () => {
    const locales = ['en', 'zh-TW', 'zh-CN', 'ja', 'ko', 'es', 'fr', 'de', 'it', 'pt', 'ru'];
    for (const c of CAPABILITIES) {
      const meta = CAPABILITY_META[c];
      expect(meta.icon.length).toBeGreaterThan(0);
      expect(['video', 'image', 'audio', 'other']).toContain(meta.kind);
      for (const l of locales) {
        expect(meta.nameI18n[l], `${c}.${l}`).toBeTruthy();
      }
      expect(Object.keys(meta.nameI18n)).toHaveLength(11);
    }
  });

  it('nameI18n 的 key 集合与 CAPABILITIES 完全一致（无遗漏无多余）', () => {
    expect(Object.keys(CAPABILITY_META).sort()).toEqual([...CAPABILITIES].sort());
  });

  it('capabilityKind 与 core/types 的 CAPABILITY_KIND 一致', () => {
    expect(capabilityKind('text_to_video')).toBe('video');
    expect(capabilityKind('text_to_image')).toBe('image');
    expect(capabilityKind('tts')).toBe('audio');
    expect(capabilityKind('avatar_talk')).toBe('video');
    expect(capabilityKind('nope')).toBe('other');
  });
});

// ================================================================ 模板

describe('BUILTIN_TEMPLATES（前端 app.quick[] 兼容）', () => {
  it('7 个模板（与前端硬编码数量一致）', () => {
    expect(BUILTIN_TEMPLATES).toHaveLength(7);
  });

  it('id 全局唯一', () => {
    const ids = BUILTIN_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('字段结构与详细设计 §2.3 冻结形状一致', () => {
    for (const t of BUILTIN_TEMPLATES) {
      expect(typeof t.id).toBe('string');
      expect(typeof t.title).toBe('string');
      expect(typeof t.sub).toBe('string');
      expect(typeof t.img).toBe('string');
      expect(typeof t.prompt).toBe('string');
      expect(typeof t.refImgUrl).toBe('string');
      expect(CAPABILITIES).toContain(t.capability);
    }
  });

  it('prompt 是真实可用的中文提示词（长度足够、非占位符）', () => {
    for (const t of BUILTIN_TEMPLATES) {
      expect(t.prompt.length, t.id).toBeGreaterThan(30);
      expect(t.prompt).not.toMatch(/lorem|TODO|占位|placeholder/i);
      // 含中文字符
      expect(/[\u4e00-\u9fa5]/.test(t.prompt), t.id).toBe(true);
    }
  });

  it('prompt 自身不含违规内容（模板必须能直接提交）', async () => {
    const { scanBlocklist, getKeywordSource, resetCompiledRules } = await import('../moderation/index.js');
    resetCompiledRules();
    const src = getKeywordSource();
    const entries = await src.load();
    const rules = entries.map((e) => ({
      regex: new RegExp(e.lang === 'zh' ? e.term : `\\b${e.term}\\b`, 'i'),
      category: e.category,
      severity: e.severity,
    }));
    for (const t of BUILTIN_TEMPLATES) {
      expect(scanBlocklist(t.prompt, rules), t.id).toEqual([]);
    }
  });

  it('能力只用本期可用的 text_to_video / text_to_image', () => {
    for (const t of BUILTIN_TEMPLATES) {
      expect(['text_to_video', 'text_to_image']).toContain(t.capability);
    }
  });

  it('img / refImgUrl 都是前端站点静态路径（不改 UI 即可渲染）', () => {
    for (const t of BUILTIN_TEMPLATES) {
      expect(t.img.startsWith('/')).toBe(true);
      expect(t.refImgUrl.startsWith('/')).toBe(true);
    }
  });

  it('title/sub 不含内部代号', () => {
    for (const t of BUILTIN_TEMPLATES) {
      expect(findInternalCodenameLeaks(t.title)).toEqual([]);
      expect(findInternalCodenameLeaks(t.sub)).toEqual([]);
    }
  });
});
