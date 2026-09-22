/**
 * 参数校验与映射单测（PRD §5.4）—— 非法组合矩阵是重点。
 *
 * 覆盖验收点：
 * - gk-video-3 传 30s → 报错（只允许 6/10）
 * - hailuo-h3 传 mode → 被忽略（不报错、不透传）
 * - 缺 required 参数 → 报错
 * - 视频传 base64 → 报错
 * - buildParamOptions 里绝不出现上游内部代号
 */

import { describe, expect, it } from 'vitest';
import type { AssetRef, ModelDescriptor } from '../../core/types.js';
import {
  buildParamOptions,
  mapParamsToUpstream,
  validateRequest,
} from './validate.js';

// ---------------------------------------------------------------- 测试模型

/** gk-video-3：按秒计费，**固定 720P**，只支持 6/10 秒（PRD §5.4） */
const gkVideo3: ModelDescriptor = {
  id: 'm-gk-video-3',
  code: 'gk-video-3',
  displayName: 'GK Video 3',
  channelId: 'c-lk888',
  channelCode: 'lk888',
  capabilities: ['text_to_video', 'image_to_video'],
  paramMapping: {
    durationSec: {
      target: 'duration',
      type: 'select',
      allowed: [6, 10],
      required: true,
      coerce: 'string',
    },
    aspectRatio: {
      target: 'aspect_ratio',
      type: 'select',
      allowed: ['16:9', '9:16', '1:1', '4:3', '3:4'],
    },
  },
  requiredParams: ['durationSec'],
  constraints: { fixedResolution: '720P', maxInputImages: 2, videoNeedsUrl: true },
  enabled: true,
  active: true,
  qualityScore: 80,
};

/** hailuo-h3：4~15s 任意整数（用 int + min/max 表达），**没有 mode 参数** */
const hailuoH3: ModelDescriptor = {
  id: 'm-hailuo-h3',
  code: 'hailuo-h3',
  displayName: 'Hailuo H3',
  channelId: 'c-lk888',
  channelCode: 'lk888',
  capabilities: ['text_to_video'],
  paramMapping: {
    durationSec: { target: 'duration', type: 'int', min: 4, max: 15, required: true, coerce: 'string' },
    resolution: {
      target: 'resolution',
      type: 'select',
      allowed: ['768P', '1080P', '2K'],
      required: true,
    },
    offPeak: { target: 'off_peak', type: 'bool', coerce: 'string' },
    images: { target: 'images', type: 'url', multiple: true, maxItems: 3 },
  },
  requiredParams: ['durationSec', 'resolution'],
  constraints: { maxPromptChars: 2000, maxInputImages: 3, videoNeedsUrl: true },
  enabled: true,
  active: true,
  qualityScore: null,
};

function img(mimeType: string, deliveryUrl = 'https://cdn.example.com/a.png'): AssetRef {
  return { assetId: 'a1', publicId: 'ast_1', mimeType, deliveryUrl, sizeBytes: 1024 };
}

// ---------------------------------------------------------------- 非法组合矩阵

describe('validateRequest —— 非法组合矩阵', () => {
  it('gk-video-3 传 30s 应报错并给出 allowed', () => {
    const res = validateRequest(
      { prompt: 'a cat', params: { durationSec: 30 }, inputs: [] },
      gkVideo3,
    );
    expect(res.valid).toBe(false);
    const e = res.errors?.find((x) => x.param === 'durationSec');
    expect(e).toBeDefined();
    expect(e?.allowed).toEqual([6, 10]);
  });

  it('gk-video-3 传 6 / 10 应通过（数字与字符串都接受）', () => {
    for (const v of [6, 10, '6', '10']) {
      const res = validateRequest({ prompt: 'a cat', params: { durationSec: v }, inputs: [] }, gkVideo3);
      expect(res.valid, `durationSec=${String(v)}`).toBe(true);
    }
  });

  it('gk-video-3 缺 required 的 durationSec 应报错', () => {
    const res = validateRequest({ prompt: 'a cat', params: {}, inputs: [] }, gkVideo3);
    expect(res.valid).toBe(false);
    expect(res.errors?.some((e) => e.param === 'durationSec')).toBe(true);
  });

  it('gk-video-3 传 resolution=1080P 应报错（固定 720P）并给出 allowed', () => {
    const res = validateRequest(
      { prompt: 'a cat', params: { durationSec: 6, resolution: '1080P' }, inputs: [] },
      gkVideo3,
    );
    expect(res.valid).toBe(false);
    const e = res.errors?.find((x) => x.param === 'resolution');
    expect(e?.allowed).toEqual(['720P']);
  });

  it('gk-video-3 传 resolution=720P 应通过', () => {
    const res = validateRequest(
      { prompt: 'a cat', params: { durationSec: 6, resolution: '720P' }, inputs: [] },
      gkVideo3,
    );
    expect(res.valid).toBe(true);
  });

  it('hailuo-h3 传 mode 应被忽略（不报错）', () => {
    const res = validateRequest(
      { prompt: 'a cat', params: { durationSec: 8, resolution: '1080P', mode: 'pro' }, inputs: [] },
      hailuoH3,
    );
    // hailuo-h3 的映射表里没有 mode → validate 不报错（向上游兼容）
    expect(res.valid).toBe(true);
  });

  it('hailuo-h3 的 mode **绝不能**出现在 mapParamsToUpstream 输出里', () => {
    const out = mapParamsToUpstream(
      { prompt: 'a cat', params: { durationSec: 8, resolution: '1080P', mode: 'pro' }, inputs: [] },
      hailuoH3,
    );
    expect(out).toEqual({ duration: '8', resolution: '1080P' });
    expect(out).not.toHaveProperty('mode');
  });

  it('hailuo-h3 传 durationSec=20 应报错（超出 4~15）', () => {
    const res = validateRequest(
      { prompt: 'a cat', params: { durationSec: 20, resolution: '1080P' }, inputs: [] },
      hailuoH3,
    );
    expect(res.valid).toBe(false);
    expect(res.errors?.some((e) => e.param === 'durationSec')).toBe(true);
  });

  it('hailuo-h3 传 durationSec=8.5 应报错（int 必须整数）', () => {
    const res = validateRequest(
      { prompt: 'a cat', params: { durationSec: 8.5, resolution: '1080P' }, inputs: [] },
      hailuoH3,
    );
    expect(res.valid).toBe(false);
  });

  it('缺全部 required 参数应给出全部错误', () => {
    const res = validateRequest({ prompt: 'a cat', params: {}, inputs: [] }, hailuoH3);
    expect(res.valid).toBe(false);
    const params = (res.errors ?? []).map((e) => e.param).sort();
    expect(params).toEqual(['durationSec', 'resolution']);
  });

  it('required 参数传空数组也应视为缺失', () => {
    const model: ModelDescriptor = {
      ...hailuoH3,
      requiredParams: ['images'],
    };
    const res = validateRequest(
      { prompt: 'a cat', params: { durationSec: 8, resolution: '1080P', images: [] }, inputs: [] },
      model,
    );
    expect(res.valid).toBe(false);
    expect(res.errors?.some((e) => e.param === 'images')).toBe(true);
  });
});

// ---------------------------------------------------------------- 视频 base64

describe('validateRequest —— 视频输入必须公网 URL', () => {
  it('视频传 base64 data URI 应报错（平台不支持 base64 视频）', () => {
    const res = validateRequest(
      {
        prompt: 'animate this',
        params: { durationSec: 6 },
        inputs: [img('video/mp4', 'data:video/mp4;base64,AAAAIGZ0eXA=')],
      },
      gkVideo3,
    );
    expect(res.valid).toBe(false);
    expect(res.errors?.some((e) => e.message.includes('不支持 base64'))).toBe(true);
  });

  it('视频 deliveryUrl 为空应报错', () => {
    const res = validateRequest(
      { prompt: 'animate this', params: { durationSec: 6 }, inputs: [img('video/mp4', '')] },
      gkVideo3,
    );
    expect(res.valid).toBe(false);
  });

  it('视频传合法 https URL 应通过', () => {
    const res = validateRequest(
      {
        prompt: 'animate this',
        params: { durationSec: 6 },
        inputs: [img('video/mp4', 'https://cdn.example.com/v.mp4')],
      },
      gkVideo3,
    );
    expect(res.valid).toBe(true);
  });

  it('图片 base64 不受 videoNeedsUrl 限制', () => {
    const res = validateRequest(
      {
        prompt: 'a cat',
        params: { durationSec: 6 },
        inputs: [img('image/png', 'data:image/png;base64,iVBORw0KGgo=')],
      },
      gkVideo3,
    );
    expect(res.valid).toBe(true);
  });

  it('maxInputImages 超限应报错', () => {
    const res = validateRequest(
      {
        prompt: 'a cat',
        params: { durationSec: 6 },
        inputs: [img('image/png'), img('image/png'), img('image/png')],
      },
      gkVideo3, // maxInputImages: 2
    );
    expect(res.valid).toBe(false);
    expect(res.errors?.some((e) => e.message.includes('输入图片最多'))).toBe(true);
  });

  it('maxPromptChars 超限应报错', () => {
    const res = validateRequest(
      { prompt: 'x'.repeat(2001), params: { durationSec: 8, resolution: '1080P' }, inputs: [] },
      hailuoH3, // maxPromptChars: 2000
    );
    expect(res.valid).toBe(false);
    expect(res.errors?.some((e) => e.param === 'prompt')).toBe(true);
  });
});

// ---------------------------------------------------------------- bool / url

describe('validateRequest —— 类型校验', () => {
  it('bool 接受 boolean 与字符串 true/false', () => {
    for (const v of [true, false, 'true', 'false']) {
      const res = validateRequest(
        { prompt: 'x', params: { durationSec: 8, resolution: '1080P', offPeak: v }, inputs: [] },
        hailuoH3,
      );
      expect(res.valid, `offPeak=${String(v)}`).toBe(true);
    }
    const bad = validateRequest(
      { prompt: 'x', params: { durationSec: 8, resolution: '1080P', offPeak: 'yes' }, inputs: [] },
      hailuoH3,
    );
    expect(bad.valid).toBe(false);
  });

  it('url 型参数必须是 http/https', () => {
    const bad = validateRequest(
      { prompt: 'x', params: { durationSec: 8, resolution: '1080P', images: ['ftp://x/y.png'] }, inputs: [] },
      hailuoH3,
    );
    expect(bad.valid).toBe(false);
  });

  it('数组型参数超过 maxItems 应报错', () => {
    const bad = validateRequest(
      {
        prompt: 'x',
        params: {
          durationSec: 8,
          resolution: '1080P',
          images: ['https://a/1.png', 'https://a/2.png', 'https://a/3.png', 'https://a/4.png'],
        },
        inputs: [],
      },
      hailuoH3, // maxItems: 3
    );
    expect(bad.valid).toBe(false);
    expect(bad.errors?.some((e) => e.message.includes('最多 3 项'))).toBe(true);
  });

  it('非 multiple 参数传数组应报错', () => {
    const bad = validateRequest(
      { prompt: 'x', params: { durationSec: ['6', '10'] }, inputs: [] },
      gkVideo3,
    );
    expect(bad.valid).toBe(false);
  });
});

// ---------------------------------------------------------------- mapParamsToUpstream

describe('mapParamsToUpstream', () => {
  it('按 target 重命名并 coerce 类型', () => {
    const out = mapParamsToUpstream(
      { prompt: 'x', params: { durationSec: 8, resolution: '1080P', offPeak: true }, inputs: [] },
      hailuoH3,
    );
    expect(out).toEqual({ duration: '8', resolution: '1080P', off_peak: 'true' });
  });

  it('忽略内部键 count / seed / __mockFail', () => {
    const out = mapParamsToUpstream(
      {
        prompt: 'x',
        params: { durationSec: 8, resolution: '1080P', count: 2, seed: 42, __mockFail: 'timeout' },
        inputs: [],
      },
      hailuoH3,
    );
    expect(out).toEqual({ duration: '8', resolution: '1080P' });
    expect(out).not.toHaveProperty('count');
    expect(out).not.toHaveProperty('seed');
    expect(out).not.toHaveProperty('__mockFail');
  });

  it('只输出上游认识的字段（未映射的键丢弃）', () => {
    const out = mapParamsToUpstream(
      { prompt: 'x', params: { durationSec: 8, resolution: '1080P', bogus: 'zzz' }, inputs: [] },
      hailuoH3,
    );
    expect(Object.keys(out).sort()).toEqual(['duration', 'resolution']);
  });

  it('数组型参数保持数组', () => {
    const out = mapParamsToUpstream(
      {
        prompt: 'x',
        params: { durationSec: 8, resolution: '1080P', images: ['https://a/1.png', 'https://a/2.png'] },
        inputs: [],
      },
      hailuoH3,
    );
    expect(out['images']).toEqual(['https://a/1.png', 'https://a/2.png']);
  });

  it('gk-video-3 输出上游字段名 duration / aspect_ratio', () => {
    const out = mapParamsToUpstream(
      { prompt: 'x', params: { durationSec: 10, aspectRatio: '9:16' }, inputs: [] },
      gkVideo3,
    );
    expect(out).toEqual({ duration: '10', aspect_ratio: '9:16' });
  });

  it('空串与 undefined 不输出', () => {
    const out = mapParamsToUpstream(
      { prompt: 'x', params: { durationSec: 8, resolution: '', aspectRatio: undefined as never }, inputs: [] },
      hailuoH3,
    );
    expect(out).toEqual({ duration: '8' });
  });
});

// ---------------------------------------------------------------- buildParamOptions

describe('buildParamOptions —— 对客 options（驱动前端 chip）', () => {
  it('对客 key 是内部参数名，且**绝不出现上游内部代号**', () => {
    const opts = buildParamOptions(hailuoH3);
    const keys = Object.keys(opts);

    // 内部参数名（前端 params 的键）
    expect(keys).toContain('durationSec');
    expect(keys).toContain('resolution');
    expect(keys).toContain('offPeak');
    expect(keys).toContain('images');

    // 上游代号绝不能出现在对客 options 的 key 或 options 值里
    expect(keys).not.toContain('duration');
    expect(keys).not.toContain('off_peak');
    expect(keys).not.toContain('aspect_ratio');

    const serialized = JSON.stringify(opts);
    expect(serialized).not.toContain('off_peak');
    expect(serialized).not.toContain('aspect_ratio');
  });

  it('派生 type/min/max/options/required/multiple/maxItems', () => {
    const opts = buildParamOptions(hailuoH3);

    expect(opts['durationSec']?.type).toBe('int');
    expect(opts['durationSec']?.min).toBe(4);
    expect(opts['durationSec']?.max).toBe(15);
    expect(opts['durationSec']?.required).toBe(true);

    expect(opts['resolution']?.type).toBe('select');
    expect(opts['resolution']?.options).toEqual(['768P', '1080P', '2K']);
    expect(opts['resolution']?.required).toBe(true);

    expect(opts['offPeak']?.type).toBe('bool');
    expect(opts['images']?.type).toBe('text'); // url → text（前端 chip）
    expect(opts['images']?.multiple).toBe(true);
    expect(opts['images']?.maxItems).toBe(3);
  });

  it('labelKey 用 model.{code}.param.{key} 形式（供 i18n）', () => {
    const opts = buildParamOptions(hailuoH3);
    expect(opts['durationSec']?.labelKey).toBe('model.hailuo-h3.param.durationSec');
  });

  it('固定分辨率模型即使没配 resolution 映射，也下发唯一取值', () => {
    const model: ModelDescriptor = { ...gkVideo3, paramMapping: { durationSec: gkVideo3.paramMapping['durationSec']! } };
    const opts = buildParamOptions(model);
    expect(opts['resolution']?.options).toEqual(['720P']);
    expect(opts['resolution']?.default).toBe('720P');
  });

  it('内部键不会派生到对客 options', () => {
    const opts = buildParamOptions(gkVideo3);
    expect(Object.keys(opts)).not.toContain('count');
    expect(Object.keys(opts)).not.toContain('seed');
    expect(Object.keys(opts)).not.toContain('__mockFail');
  });
});
