/**
 * 上传限制与媒体类型判定（PRD §8.3 / 详细设计 §2.4）。
 *
 * 三类限制（PRD §8.3「上传限制」原文）：
 *   图片 ≤ 20MB（jpg/png/webp）
 *   视频 ≤ 200MB（mp4/mov/webm）
 *   音频 ≤ 50MB（mp3/wav/m4a）
 *
 * 这里同时承担**魔数校验**（magic number）：
 * 只信 Content-Type 是不够的——攻击者可以把 HTML/JS 命名成 `.png` 并声明 `image/png`，
 * 也可以把超大 payload 伪装成图片绕过大小的业务判断。
 * PRD §8.3 明确要求 "Content-Type 与 kind 一致性校验 + 魔数校验"，二者缺一不可。
 */

import type { AssetKind } from '@prisma/client';

/** 一个 kind 下允许的 mime 白名单 + 单文件上限 */
export interface KindRule {
  maxBytes: number;
  /** mime → 该 mime 允许的魔数判定器 */
  allowed: Map<string, (head: Buffer) => boolean>;
}

const MB = 1024 * 1024;

export const IMAGE_MAX_BYTES = 20 * MB;
export const VIDEO_MAX_BYTES = 200 * MB;
export const AUDIO_MAX_BYTES = 50 * MB;

// ---------------------------------------------------------------- 魔数判定器

/** PNG：`\x89PNG\r\n\x1a\n` */
function isPng(buf: Buffer): boolean {
  return (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 && // P
    buf[2] === 0x4e && // N
    buf[3] === 0x47 //   G
  );
}

/** JPEG：`\xFF\xD8\xFF` */
function isJpeg(buf: Buffer): boolean {
  return buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
}

/** GIF：`GIF8`（GIF87a / GIF89a） */
function isGif(buf: Buffer): boolean {
  return buf.length >= 4 && buf.toString('latin1', 0, 4) === 'GIF8';
}

/** WEBP：`RIFF....WEBP`（偏移 0 是 RIFF，偏移 8 是 WEBP） */
function isWebp(buf: Buffer): boolean {
  return (
    buf.length >= 12 &&
    buf.toString('latin1', 0, 4) === 'RIFF' &&
    buf.toString('latin1', 8, 12) === 'WEBP'
  );
}

/**
 * MP4 / MOV / M4A：ISO BMFF 的 `ftyp` box —— 偏移 4 起是 `ftyp`。
 * box 结构：[4 字节 size][4 字节 'ftyp'][4 字节 major_brand]…
 * 允许任意 brand（isom / mp42 / qt  / M4A  …），因为 mov/m4a 共用同一容器。
 */
function isIsoBmff(buf: Buffer): boolean {
  return buf.length >= 12 && buf.toString('latin1', 4, 8) === 'ftyp';
}

/** `ftyp` 且 major_brand 属于 QuickTime（mov 的 brand 是 `qt  `） */
function isQuickTime(buf: Buffer): boolean {
  return isIsoBmff(buf) && buf.toString('latin1', 8, 12).startsWith('qt');
}

/** WebM / MKV：EBML 头 `\x1A\x45\xDF\xA3` */
function isWebm(buf: Buffer): boolean {
  return buf.length >= 4 && buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3;
}

/** WAV：`RIFF....WAVE` */
function isWav(buf: Buffer): boolean {
  return (
    buf.length >= 12 &&
    buf.toString('latin1', 0, 4) === 'RIFF' &&
    buf.toString('latin1', 8, 12) === 'WAVE'
  );
}

/**
 * MP3：两种合法开头
 *  - 带 ID3 标签：`ID3`
 *  - 裸帧同步：`0xFF` + 高 3 位为 1（0xE0 掩码）→ 如 0xFF 0xFB / 0xFF 0xF3 / 0xFF 0xFA
 */
function isMp3(buf: Buffer): boolean {
  if (buf.length >= 3 && buf.toString('latin1', 0, 3) === 'ID3') return true;
  return buf.length >= 2 && buf[0] === 0xff && ((buf[1] as number) & 0xe0) === 0xe0;
}

// ---------------------------------------------------------------- kind 规则表

/**
 * mime → kind 的归属（PRD §8.3 三类白名单）。
 * `kind` 是**业务方向**（upload/output），不是媒体类型，所以这里按 mime 前缀判定媒体类型。
 */
export type MediaType = 'image' | 'video' | 'audio';

export function mediaTypeOfMime(mimeType: string): MediaType | null {
  const m = normalizeMime(mimeType);
  if (m.startsWith('image/')) return 'image';
  if (m.startsWith('video/')) return 'video';
  if (m.startsWith('audio/')) return 'audio';
  return null;
}

/** 去掉 `; charset=...` 等参数并转小写 */
export function normalizeMime(mimeType: string): string {
  return (mimeType ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
}

/** 每种媒体类型 → 允许的 mime → 魔数判定器（PRD §8.3 白名单） */
export const MEDIA_RULES: Record<MediaType, { maxBytes: number; allowed: Map<string, (b: Buffer) => boolean> }> = {
  image: {
    maxBytes: IMAGE_MAX_BYTES,
    allowed: new Map<string, (b: Buffer) => boolean>([
      ['image/jpeg', isJpeg],
      ['image/jpg', isJpeg],
      ['image/png', isPng],
      ['image/webp', isWebp],
      // GIF 不在 PRD 白名单里，但魔数识别保留给 import-url 的错误提示更精确
      ['image/gif', isGif],
    ]),
  },
  video: {
    maxBytes: VIDEO_MAX_BYTES,
    allowed: new Map<string, (b: Buffer) => boolean>([
      ['video/mp4', isIsoBmff],
      ['video/quicktime', isQuickTime],
      ['video/webm', isWebm],
      ['video/x-matroska', isWebm],
    ]),
  },
  audio: {
    maxBytes: AUDIO_MAX_BYTES,
    allowed: new Map<string, (b: Buffer) => boolean>([
      ['audio/mpeg', isMp3],
      ['audio/mp3', isMp3],
      ['audio/wav', isWav],
      ['audio/x-wav', isWav],
      ['audio/wave', isWav],
      ['audio/mp4', isIsoBmff],
      ['audio/x-m4a', isIsoBmff],
      ['audio/m4a', isIsoBmff],
    ]),
  },
};

/** PRD §8.3 的"官方白名单"（用于错误提示，不含我们额外放行的 gif/mkv 别名） */
export const PRD_MIME_WHITELIST = {
  image: ['image/jpeg', 'image/png', 'image/webp'],
  video: ['video/mp4', 'video/quicktime', 'video/webm'],
  audio: ['audio/mpeg', 'audio/wav', 'audio/mp4'],
} as const;

/** 取该媒体类型的大小上限 */
export function maxBytesForMedia(media: MediaType): number {
  return MEDIA_RULES[media].maxBytes;
}

/** 该 mime 是否在（任一媒体类型的）白名单内 */
export function isAllowedMime(mimeType: string): boolean {
  const media = mediaTypeOfMime(mimeType);
  if (!media) return false;
  return MEDIA_RULES[media].allowed.has(normalizeMime(mimeType));
}

// ---------------------------------------------------------------- 校验

export interface AssetValidationIssue {
  code: 'unsupported_type' | 'too_large' | 'magic_mismatch';
  message: string;
  details: Record<string, unknown>;
}

/**
 * 上传前校验（`POST /v1/assets/upload-url`）。
 * 只校验 mime 白名单 + 声明大小（此时还没有文件内容，无法做魔数校验）。
 */
export function validateUploadRequest(input: {
  mimeType: string;
  sizeBytes: number;
  kind: AssetKind;
}): AssetValidationIssue | null {
  const mime = normalizeMime(input.mimeType);

  if (input.kind !== 'upload' && input.kind !== 'output') {
    return {
      code: 'unsupported_type',
      message: 'kind 只能是 upload 或 output',
      details: { kind: input.kind },
    };
  }

  const media = mediaTypeOfMime(mime);
  if (!media) {
    return {
      code: 'unsupported_type',
      message: `不支持的 MIME 类型：${input.mimeType}`,
      details: { mimeType: input.mimeType, allowed: PRD_MIME_WHITELIST },
    };
  }

  if (!MEDIA_RULES[media].allowed.has(mime)) {
    return {
      code: 'unsupported_type',
      message: `该类型不在允许清单内：${mime}`,
      details: { mimeType: mime, media, allowed: PRD_MIME_WHITELIST[media] },
    };
  }

  if (!Number.isFinite(input.sizeBytes) || input.sizeBytes <= 0) {
    return {
      code: 'unsupported_type',
      message: 'sizeBytes 必须是正整数',
      details: { sizeBytes: input.sizeBytes },
    };
  }

  const max = MEDIA_RULES[media].maxBytes;
  if (input.sizeBytes > max) {
    return {
      code: 'too_large',
      message: `文件超出大小限制：${media} 最大 ${Math.floor(max / MB)}MB`,
      details: { sizeBytes: input.sizeBytes, maxBytes: max, media },
    };
  }

  return null;
}

/**
 * 魔数校验（`POST /v1/assets` 确认上传 + import-url 转存前）。
 *
 * 为什么必须做：Content-Type 是**客户端声明**，完全可伪造。
 * 只信声明等于允许把任意文件（含 HTML/JS、可执行文件）放进私有桶并签名下发，
 * 一旦前端按图片渲染就会命中 XSS / 内容嗅探问题。魔数是文件**自证**的类型。
 *
 * @returns null 表示通过；否则返回不匹配说明
 */
export function validateMagic(input: {
  mimeType: string;
  head: Buffer;
}): AssetValidationIssue | null {
  const mime = normalizeMime(input.mimeType);
  const media = mediaTypeOfMime(mime);

  if (!media) {
    return {
      code: 'unsupported_type',
      message: `不支持的 MIME 类型：${input.mimeType}`,
      details: { mimeType: input.mimeType },
    };
  }

  const checker = MEDIA_RULES[media].allowed.get(mime);
  if (!checker) {
    return {
      code: 'unsupported_type',
      message: `该类型不在允许清单内：${mime}`,
      details: { mimeType: mime, allowed: PRD_MIME_WHITELIST[media] },
    };
  }

  if (input.head.length < 12) {
    return {
      code: 'magic_mismatch',
      message: '文件太小，无法完成魔数校验',
      details: { headBytes: input.head.length },
    };
  }

  if (!checker(input.head)) {
    return {
      code: 'magic_mismatch',
      message: `文件内容与声明的类型（${mime}）不符`,
      details: { mimeType: mime, media },
    };
  }

  return null;
}

/**
 * Content-Type 与业务 `kind` 的一致性校验（import-url 用）。
 *
 * 注意 `kind` 到媒体类型**不是一一映射**（PRD §8.3 的三类白名单）：
 *  - `AssetKind`（upload/output）是业务方向，不携带媒体类型；
 *  - 所以这里按 PRD 的三分类做校验：给定 `expect`（image/video/audio）时，
 *    实际 Content-Type 必须落在同一类。调用方用 `mediaTypeOfMime(mime) === expect` 判定。
 */
export function mediaTypeMatches(actualMime: string, expected: MediaType): boolean {
  return mediaTypeOfMime(actualMime) === expected;
}

/** kind 字符串 → 期望媒体类型（`?kind=` 查询参数支持 image/video/audio 直传） */
export function expectedMediaOfKind(kind: string): MediaType | null {
  const k = kind.toLowerCase();
  if (k === 'image' || k === 'video' || k === 'audio') return k;
  return null;
}

/**
 * 从文件扩展名推断 mime（import-url 的 URL 无 Content-Type 时的兜底）。
 * 仅在响应头缺失/为 `application/octet-stream` 时使用。
 */
export function mimeFromExtension(pathname: string): string | null {
  const ext = (pathname.split('.').pop() ?? '').toLowerCase().split('?')[0];
  switch (ext) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    case 'webp':
      return 'image/webp';
    case 'gif':
      return 'image/gif';
    case 'mp4':
      return 'video/mp4';
    case 'mov':
      return 'video/quicktime';
    case 'webm':
      return 'video/webm';
    case 'mp3':
      return 'audio/mpeg';
    case 'wav':
      return 'audio/wav';
    case 'm4a':
      return 'audio/mp4';
    default:
      return null;
  }
}
