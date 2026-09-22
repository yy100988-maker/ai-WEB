/**
 * 演示数据（离线回退）
 * ------------------------------------------------------------------
 * 当 `/v1/catalog/models` 不可达时（后端未启动 / 未登录），工作台降级到
 * 这份内置目录，保证 UI 可完整预览。**真实数据永远优先**。
 */
import type { CatalogModel, ResolvedModelDetail, TaskSummary } from './api';

/**
 * 演示用模型目录：仅在 `/v1/catalog/models` 不可达时使用。
 * 字段形状对齐线上真实返回（resolutions / aspectRatios / features）。
 */
export const DEMO_MODELS: CatalogModel[] = [
  m('demo-gpt-image-25', 'GPT Image 2.5', 98, ['auto', '1K', '2K', '4K'], true),
  m('demo-gpt-image-2', 'GPT Image 2', 95, ['auto', '1K', '2K'], true),
  m('demo-tt-image-25', 'TT Image 2.5', 92, ['1K', '2K', '4K'], true),
  m('demo-tt-image-2', 'TT Image 2', 90, ['1K', '2K', '4K'], false),
  m('demo-nano-banana-pro', '纳米香蕉 Pro', 88, ['1K', '2K'], true),
  m('demo-nano-banana-2', '纳米香蕉 2', 86, ['1K', '2K'], false),
  m('demo-jimeng-5-pro', '即梦 5.0 Pro', 84, ['1K', '2K'], false),
];

/** 构造一个图片类模型（durations 为空 → isImageModel() 判定为图片） */
function m(
  id: string,
  displayName: string,
  qualityScore: number,
  resolutions: string[],
  hd: boolean,
): CatalogModel {
  return {
    id,
    displayName,
    qualityScore,
    resolutions,
    durations: [],
    aspectRatios: ['auto', '1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '21:9'],
    features: hd ? ['hd', 'fast', 'high_res'] : ['fast'],
  };
}

/** 演示用模型详情：参数面板据此渲染 chip 与报价（params 已归一化为数组） */
export const DEMO_MODEL_DETAIL: ResolvedModelDetail = {
  id: 'demo-tt-image-2',
  displayName: 'TT Image 2',
  code: 'demo-tt-image-2',
  capability: 'text_to_image',
  capabilityKind: 'image',
  capabilities: ['text_to_image', 'image_to_image'],
  params: [
    {
      key: 'aspectRatio',
      label: '画面比例',
      type: 'enum',
      default: '1:1',
      options: [
        { value: '1:1', label: '1:1' },
        { value: '16:9', label: '16:9' },
        { value: '9:16', label: '9:16' },
        { value: '4:3', label: '4:3' },
      ],
    },
    {
      key: 'resolution',
      label: '输出质量',
      type: 'enum',
      default: '2K',
      options: [
        { value: '1K', label: '1K' },
        { value: '2K', label: '2K' },
        { value: '4K', label: '4K' },
      ],
    },
    { key: 'count', label: '生成张数', type: 'number', default: 1, min: 1, max: 4, step: 1 },
  ],
  constraints: null,
  // spec 是对象（对齐线上真实形状），matchPrice() 按 resolution/aspectRatio 匹配
  pricing: [
    { spec: { resolution: '1K' }, credits: 0.03, capability: 'text_to_image' },
    { spec: { resolution: '2K' }, credits: 0.08, capability: 'text_to_image' },
    { spec: { resolution: '4K' }, credits: 0.17, capability: 'text_to_image' },
  ],
};

/**
 * 演示用生成结果。
 * 缩略图使用内联 SVG data-URI，避免依赖外网资源（离线也能看到"图"）。
 */
const APPLE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800">
  <defs>
    <radialGradient id="bg" cx="50%" cy="38%" r="72%">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="100%" stop-color="#eceef1"/>
    </radialGradient>
    <radialGradient id="ap" cx="38%" cy="30%" r="78%">
      <stop offset="0%" stop-color="#ff6b5e"/>
      <stop offset="46%" stop-color="#d62828"/>
      <stop offset="100%" stop-color="#8c1414"/>
    </radialGradient>
  </defs>
  <rect width="800" height="800" fill="url(#bg)"/>
  <ellipse cx="400" cy="596" rx="212" ry="34" fill="#000" opacity="0.13"/>
  <path d="M400 214c8-40 30-58 62-64-6 34-30 56-62 64Z" fill="#4a7c3f"/>
  <path d="M400 226c0-16 2-28 4-38" stroke="#6b4a2f" stroke-width="15" stroke-linecap="round" fill="none"/>
  <path d="M400 226c78 0 148 66 148 158 0 118-70 214-148 214s-148-96-148-214c0-92 70-158 148-158Z" fill="url(#ap)"/>
  <ellipse cx="336" cy="338" rx="46" ry="64" fill="#fff" opacity="0.3" transform="rotate(-24 336 338)"/>
  <ellipse cx="472" cy="470" rx="30" ry="44" fill="#fff" opacity="0.12" transform="rotate(-24 472 470)"/>
</svg>`;

function svgUri(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export const DEMO_THUMB = svgUri(APPLE_SVG);

export const DEMO_TASKS: TaskSummary[] = [
  {
    id: 'demo-task-1',
    status: 'succeeded',
    progress: 100,
    capability: 'text_to_image',
    prompt: 'a red apple on a white table, studio photo',
    model: { id: 'demo-tt-image-25', displayName: 'TT Image 2.5' },
    params: { aspectRatio: '16:9', resolution: '4K', count: 1 },
    results: [{ assetId: 'demo-asset-1', url: DEMO_THUMB, mimeType: 'image/png', width: 1536, height: 864 }],
    quotedCredits: 0.17,
    settledCredits: 0.17,
    createdAt: '2026-09-19T20:18:40.000Z',
    estimatedSec: 18,
  },
  {
    id: 'demo-task-2',
    status: 'succeeded',
    progress: 100,
    capability: 'text_to_image',
    prompt: 'a red apple, centered composition, soft daylight, minimal background',
    model: { id: 'demo-tt-image-2', displayName: 'TT Image 2' },
    params: { aspectRatio: '1:1', resolution: '4K', count: 1 },
    results: [{ assetId: 'demo-asset-2', url: DEMO_THUMB, mimeType: 'image/png', width: 1024, height: 1024 }],
    quotedCredits: 0.08,
    settledCredits: 0.08,
    createdAt: '2026-09-19T20:17:35.000Z',
    estimatedSec: 12,
  },
];
