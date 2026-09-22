/**
 * 资产服务（PRD §8.3 / 详细设计 §2.4）。
 *
 * 三类 URL **三权分立**（PRD §8.3 硬性规则，本文件是唯一的签发入口）：
 * | 类型     | 用途           | 有效期 | 可见范围      | 签发方                              |
 * | 上传 URL | 前端直传 PUT   | 15min  | 仅上传者      | `presignPut()`（本模块 upload-url）  |
 * | 浏览 URL | 前端预览/下载  | 15min  | 仅资产 owner  | `presignView()`（本模块 GET /:id）   |
 * | 交付 URL | 上游拉输入文件 | 4h     | 仅渠道        | **Worker 在 submit 前现签**（本模块**不签发**） |
 *
 * ⚠️ `GET /v1/assets/:id` **永不下发交付 URL**（PRD §8.3 硬性）——
 * 交付 URL 有效期 4h 且用于上游下载，一旦下发前端就等于把长期有效的对象存储读权限泄露给浏览器。
 */

import type { Asset } from '@prisma/client';
import { db, transaction } from '../../core/db.js';
import { err } from '../../core/errors.js';
import { newPublicId } from '../../core/ids.js';
import { childLogger } from '../../core/logger.js';
import { getObjectBuffer, headObject, presignPut, presignView, uploadKey } from '../../core/storage.js';
import { sanitizeFilename } from '../../core/storage.js';
import { sha256 } from '../../core/crypto.js';
import {
  MEDIA_RULES,
  mediaTypeOfMime,
  mimeFromExtension,
  normalizeMime,
  validateMagic,
  validateUploadRequest,
  type MediaType,
} from './media.js';
import { SsrfError, safeFetch } from './ssrf.js';

const log = childLogger({ mod: 'asset-service' });

/** 上传 URL 有效期（PRD §8.3：15min；配置项 UPLOAD_URL_TTL_SEC 默认 900） */
export const UPLOAD_TTL_SEC = 900;
/** 浏览 URL 有效期（PRD §8.3：15min） */
export const VIEW_TTL_SEC = 900;

// ---------------------------------------------------------------- 序列化

export interface SerializedAsset {
  id: string;
  kind: string;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  durationSec: number | null;
  sourceUrl: string | null;
  quarantined: boolean;
  createdAt: string;
}

/**
 * 资产 → 对客结构。
 * ⚠️ **绝不包含 `storageKey`**：那是对象存储内部路径，泄露它等于给出桶结构。
 */
export function serializeAsset(asset: Asset): SerializedAsset {
  const meta = (asset.meta ?? {}) as Record<string, unknown>;
  return {
    id: asset.publicId,
    kind: asset.kind,
    mimeType: asset.mimeType,
    sizeBytes: Number(asset.sizeBytes),
    width: asset.width ?? null,
    height: asset.height ?? null,
    durationSec: asset.durationSec ?? null,
    sourceUrl: asset.sourceUrl ?? null,
    quarantined: meta['quarantined'] === true,
    createdAt: asset.createdAt.toISOString(),
  };
}

// ---------------------------------------------------------------- 上传 URL

export interface UploadUrlResult {
  assetId: string;
  uploadUrl: string;
  requiredHeaders: Record<string, string>;
  expiresInSec: number;
}

/**
 * 签发直传 URL（PRD §8.3：`{ mimeType, sizeBytes, kind }` → 预签名 PUT + assetId）。
 *
 * 流程：
 *  1. 校验 mime 白名单 + 大小（超限抛 413 `err.payloadTooLarge()`）；
 *  2. 建 `Asset` 记录（**先建记录再给 URL**：这样 `POST /v1/assets` 确认时能查到，
 *     且未完成上传的资产是 `sizeBytes` 待确认状态，不会被误用）；
 *  3. `storageKey = uploadKey(userPublicId, assetPublicId, filename)`；
 *  4. `presignPut()`（15min）→ 返回 `{ assetId, uploadUrl, requiredHeaders }`。
 *
 * `requiredHeaders` 必须原样带给 PUT：签名包含了 `Content-Type`，
 * 客户端漏传或改值都会得到 `SignatureDoesNotMatch`。
 */
export async function createUploadUrl(input: {
  userId: string;
  userPublicId: string;
  mimeType: string;
  sizeBytes: number;
  kind: 'upload' | 'output';
  filename?: string;
}): Promise<UploadUrlResult> {
  const issue = validateUploadRequest({
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
    kind: input.kind,
  });
  if (issue) {
    if (issue.code === 'too_large') throw err.payloadTooLarge(issue.details);
    throw err.invalidParams(issue.details);
  }

  const mime = normalizeMime(input.mimeType);
  const assetPublicId = newPublicId('asset');
  const filename = input.filename ?? defaultFilenameFor(mime);
  const storageKey = uploadKey(input.userPublicId, assetPublicId, filename);

  await db().asset.create({
    data: {
      publicId: assetPublicId,
      userId: input.userId,
      kind: input.kind,
      mimeType: mime,
      storageKey,
      sizeBytes: BigInt(Math.max(0, Math.trunc(input.sizeBytes))),
      meta: { pendingConfirm: true, declaredMime: mime },
    },
  });

  const uploadUrl = await presignPut(storageKey, mime, UPLOAD_TTL_SEC);

  return {
    assetId: assetPublicId,
    uploadUrl,
    requiredHeaders: { 'Content-Type': mime },
    expiresInSec: UPLOAD_TTL_SEC,
  };
}

/** 无文件名时按 mime 生成默认名（storageKey 必须稳定唯一） */
function defaultFilenameFor(mime: string): string {
  const ext: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'video/mp4': 'mp4',
    'video/quicktime': 'mov',
    'video/webm': 'webm',
    'video/x-matroska': 'mkv',
    'audio/mpeg': 'mp3',
    'audio/mp3': 'mp3',
    'audio/wav': 'wav',
    'audio/x-wav': 'wav',
    'audio/wave': 'wav',
    'audio/mp4': 'm4a',
    'audio/x-m4a': 'm4a',
    'audio/m4a': 'm4a',
  };
  return `file.${ext[mime] ?? 'bin'}`;
}

// ---------------------------------------------------------------- 确认上传

export interface ConfirmResult {
  asset: SerializedAsset;
}

/**
 * 确认上传完成（PRD §8.3）。
 *
 * 1. `headObject()` 校验对象**确实存在**（防止前端伪造 assetId 却什么都没传）；
 * 2. 校验**实际大小与声明一致**（前端的 sizeBytes 只是声明，以存储为准）；
 * 3. 更新 `sizeBytes` / `checksum`；
 * 4. **异步**触发魔数校验（PRD §8.3："触发校验（类型/大小/病毒扫描异步）"）：
 *    失败则置 `meta.quarantined = true`，该资产不可被任务引用。
 *
 * 为什么异步：魔数校验要 `GetObject` 读回文件头，对 200MB 视频也要走一次网络往返。
 * 放在请求路径上会让"直传完成后确认"这个高频接口变慢；而**隔离标记是幂等的**，
 * 稍晚生效不影响正确性（任务提交时会检查 quarantined）。
 */
export async function confirmUpload(input: {
  userId: string;
  assetPublicId: string;
}): Promise<ConfirmResult> {
  const asset = await db().asset.findFirst({
    where: { publicId: input.assetPublicId, userId: input.userId, deletedAt: null },
  });
  if (!asset) throw err.notFound({ assetId: input.assetPublicId });

  const head = await headObject(asset.storageKey);
  if (!head) {
    throw err.invalidParams({
      assetId: input.assetPublicId,
      reason: '对象不存在，请先完成直传',
    });
  }

  const declared = Number(asset.sizeBytes);
  const actual = head.sizeBytes;

  // 大小不一致：以存储为准，但记 warn（前端可能漏传了部分内容）
  if (declared > 0 && actual !== declared) {
    log.warn(
      { assetId: asset.publicId, declared, actual },
      'uploaded object size differs from declared size',
    );
  }

  // 实际类型：优先用存储上的 ContentType，其次用声明的
  const actualMime = normalizeMime(head.contentType ?? asset.mimeType);

  const updated = await db().asset.update({
    where: { id: asset.id },
    data: {
      sizeBytes: BigInt(actual),
      mimeType: actualMime || asset.mimeType,
      checksum: sha256(`${asset.storageKey}:${actual}`),
      meta: { ...((asset.meta ?? {}) as Record<string, unknown>), pendingConfirm: false },
    },
  });

  // 异步魔数校验：绝不阻塞确认响应
  void runMagicScan(asset.id, asset.publicId, updated.mimeType, updated.storageKey);

  return { asset: serializeAsset(updated) };
}

/**
 * 异步魔数校验（PRD §8.3 / §9 安全："文件上传类型/大小/魔数校验"）。
 * 失败 → `meta.quarantined = true`，资产进入隔离态（任务提交时拒绝引用）。
 */
export async function runMagicScan(
  assetId: string,
  assetPublicId: string,
  mimeType: string,
  storageKey: string,
): Promise<void> {
  try {
    const head = await getObjectBuffer(storageKey);
    // 只需前 16 字节做魔数判定，但 getObjectBuffer 会读全量；
    // 大文件场景这里改造为 Range 请求（Phase 优化），当前先限制读取量。
    const slice = head.subarray(0, 16);

    const issue = validateMagic({ mimeType, head: slice });
    if (issue) {
      await db().asset.update({
        where: { id: assetId },
        data: {
          meta: {
            quarantined: true,
            quarantineReason: issue.code,
            quarantineMessage: issue.message,
            quarantinedAt: new Date().toISOString(),
          },
        },
      });
      log.warn({ assetId: assetPublicId, reason: issue.code }, 'asset quarantined by magic scan');
    }
  } catch (e) {
    // 扫描失败不隔离（可能是存储瞬时不可用），但要留痕供排查
    log.warn({ err: e, assetId: assetPublicId }, 'magic scan failed');
  }
}

// ---------------------------------------------------------------- import-url

export interface ImportUrlResult {
  assetId: string;
  status: 'ready';
  mimeType: string;
  sizeBytes: number;
}

/**
 * 服务端拉取公网 URL → 转存对象存储（PRD §8.3，**SSRF 防护是验收项 §13 #21**）。
 *
 * 防护链路（详见 `ssrf.ts` 注释）：
 *   ① 协议白名单 http/https
 *   ② 字面 IP / 主机名黑名单
 *   ③ DNS 解析后**复验全部 IP**
 *   ④ **IP pinning** 直连（防 DNS rebinding），重定向 ≤3 跳且每跳复验
 *   ⑤ Content-Type 与 kind 一致性校验 + **魔数校验**
 *   ⑥ 超限**边下边断**（图片 20MB / 视频 200MB / 音频 50MB）、超时 30s
 *
 * 失败一律 `err.unfetchableUrl(reason)`（422），**不建资产、不扣费**（PRD §8.3 / §8.9）。
 */
export async function importFromUrl(input: {
  userId: string;
  userPublicId: string;
  url: string;
  kind: 'upload' | 'output';
  expectMedia?: MediaType;
}): Promise<ImportUrlResult> {
  // 先做同步的语法层校验（①②），失败即刻返回，不消耗网络资源
  let expectedMedia = input.expectMedia;
  if (!expectedMedia) {
    // 未显式指定时，从 URL 扩展名猜（缺失则后面用 Content-Type 判定）
    const guess = mimeFromExtension(safePathname(input.url));
    expectedMedia = guess ? (mediaTypeOfMime(guess) ?? undefined) : undefined;
  }

  const maxBytes = expectedMedia ? MEDIA_RULES[expectedMedia].maxBytes : MEDIA_RULES.image.maxBytes;

  let fetched;
  try {
    fetched = await safeFetch(input.url, { maxBytes });
  } catch (e) {
    if (e instanceof SsrfError) {
      log.warn({ url: input.url, reason: e.reason, userId: input.userId }, 'import-url blocked');
      throw err.unfetchableUrl(e.reason);
    }
    throw err.unfetchableUrl(e instanceof Error ? e.message : '拉取失败');
  }

  // ---- Content-Type 与 kind 一致性 + 大小复核 ----
  const rawContentType = fetched.contentType;
  const contentType = normalizeMime(rawContentType);
  const detectedMedia = mediaTypeOfMime(contentType);

  // Content-Type 缺失/泛化时回落扩展名（很多静态站点不给准确头）
  const effectiveMime = detectedMedia
    ? contentType
    : (mimeFromExtension(safePathname(fetched.finalUrl)) ?? '');

  const effectiveMedia = mediaTypeOfMime(effectiveMime);

  if (!effectiveMedia) {
    throw err.unfetchableUrl(
      `无法识别的 Content-Type：${rawContentType || '(缺失)'}；仅支持 image/* video/* audio/*`,
    );
  }

  // 显式指定了期望媒体类型 → 必须一致（PRD §8.3 "Content-Type 与 kind 一致性校验"）
  if (input.expectMedia && effectiveMedia !== input.expectMedia) {
    throw err.unfetchableUrl(
      `类型不符：期望 ${input.expectMedia}，实际 ${effectiveMedia}（${effectiveMime}）`,
    );
  }

  // 大小上限按**实际媒体类型**复核（防止用扩展名声明成小类型绕过）
  const actualMax = MEDIA_RULES[effectiveMedia].maxBytes;
  if (fetched.sizeBytes > actualMax) {
    throw err.unfetchableUrl(
      `文件超出大小限制：${effectiveMedia} 最大 ${Math.floor(actualMax / 1024 / 1024)}MB`,
    );
  }

  // ---- 魔数校验（PRD §8.3：Content-Type 声明不可信）----
  const magicIssue = validateMagic({ mimeType: effectiveMime, head: fetched.body.subarray(0, 16) });
  if (magicIssue) {
    throw err.unfetchableUrl(magicIssue.message);
  }

  // ---- 转存对象存储 + 建资产 ----
  const assetPublicId = newPublicId('asset');
  const filename = filenameFromUrl(fetched.finalUrl, effectiveMime);
  const storageKey = uploadKey(input.userPublicId, assetPublicId, filename);

  const { putObject } = await import('../../core/storage.js');
  try {
    await putObject(storageKey, fetched.body, effectiveMime);
  } catch (e) {
    log.error({ err: e, url: input.url }, 'import-url putObject failed');
    throw err.unfetchableUrl('转存对象存储失败');
  }

  const created = await transaction(async (tx) => {
    return tx.asset.create({
      data: {
        publicId: assetPublicId,
        userId: input.userId,
        kind: input.kind,
        mimeType: effectiveMime,
        storageKey,
        sizeBytes: BigInt(fetched.sizeBytes),
        // sourceUrl 记来源**供审计**（PRD §8.3：导入资产要能追溯）
        sourceUrl: fetched.finalUrl,
        checksum: sha256(`${storageKey}:${fetched.sizeBytes}`),
        meta: {
          imported: true,
          importedAt: new Date().toISOString(),
          pinnedAddress: fetched.pinnedAddress,
          contentTypeDeclared: rawContentType || null,
        },
      },
    });
  });

  return {
    assetId: created.publicId,
    status: 'ready',
    mimeType: created.mimeType,
    sizeBytes: Number(created.sizeBytes),
  };
}

/** 安全取 pathname（URL 非法时返回空串，不抛） */
function safePathname(rawUrl: string): string {
  try {
    return new URL(rawUrl).pathname;
  } catch {
    return '';
  }
}

function filenameFromUrl(finalUrl: string, mime: string): string {
  const base = safePathname(finalUrl).split('/').pop() ?? '';
  const cleaned = sanitizeFilename(base);
  if (cleaned && cleaned !== 'file' && cleaned.includes('.')) return cleaned;
  return defaultFilenameFor(mime);
}

// ---------------------------------------------------------------- 列表 / 详情 / 删除

export interface ListAssetsInput {
  userId: string;
  /**
   * 归属筛选。
   * - `upload` / `output`：资产来源（assets.kind 枚举）
   * - `image` / `video` / `audio`：**媒体类型**（按 mime_type 前缀筛）
   *
   * ⚠️ 路由层早已放开 image/video/audio（见 routes.ts 的 listQuerySchema），
   * 但这里过去直接把入参塞进 `where.kind`（Prisma 枚举只认 upload/output），
   * 导致 `kind=image` 查不到任何数据。现在按语义分流，见 buildKindFilter()。
   */
  kind?: string;
  /** 显式媒体类型（等价于 kind=image|video|audio，优先级更高） */
  mediaType?: 'image' | 'video' | 'audio';
  /** 创建时间下界（含） */
  createdFrom?: Date;
  /** 创建时间上界（不含） */
  createdTo?: Date;
  cursor?: string;
  limit?: number;
}

/** `upload` / `output` 是 assets.kind 的真实枚举值，其余按媒体类型处理 */
const ASSET_KINDS = new Set(['upload', 'output']);
const MEDIA_PREFIX: Record<'image' | 'video' | 'audio', string> = {
  image: 'image/',
  video: 'video/',
  audio: 'audio/',
};

/**
 * kind / mediaType → Prisma where 片段。
 *
 * 把"归属"（kind 枚举）与"媒体类型"（mime 前缀）两种语义分开，
 * 避免 image/video/audio 被当成枚举值导致查询恒空。
 */
export function buildKindFilter(input: {
  kind?: string;
  mediaType?: 'image' | 'video' | 'audio';
}): { kind?: 'upload' | 'output'; mimeType?: { startsWith: string } } {
  const out: { kind?: 'upload' | 'output'; mimeType?: { startsWith: string } } = {};

  if (input.kind && ASSET_KINDS.has(input.kind)) {
    out.kind = input.kind as 'upload' | 'output';
  }

  // mediaType 显式优先；否则看 kind 是否是媒体类型
  const media = input.mediaType ?? (input.kind && !ASSET_KINDS.has(input.kind) ? input.kind : undefined);
  if (media && media in MEDIA_PREFIX) {
    out.mimeType = { startsWith: MEDIA_PREFIX[media as 'image' | 'video' | 'audio'] };
  }

  return out;
}

/** 游标编解码（与 tasks 模块同构：base64url(`{ISO}|{id}`)，倒序翻页） */
export function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(`${createdAt.toISOString()}|${id}`, 'utf8').toString('base64url');
}

export function decodeCursor(cursor?: string): { createdAt: Date; id: string } | null {
  if (!cursor) return null;
  try {
    const raw = Buffer.from(cursor, 'base64url').toString('utf8');
    const idx = raw.lastIndexOf('|');
    if (idx <= 0) return null;
    const createdAt = new Date(raw.slice(0, idx));
    const id = raw.slice(idx + 1);
    if (Number.isNaN(createdAt.getTime()) || !id) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

/** 资产库列表（软删除过滤，倒序游标分页） */
export async function listAssets(input: ListAssetsInput): Promise<{
  items: SerializedAsset[];
  nextCursor: string | null;
}> {
  const limit = Math.min(Math.max(input.limit ?? 20, 1), 100);
  const cursor = decodeCursor(input.cursor);

  const rows = await db().asset.findMany({
    where: {
      userId: input.userId,
      deletedAt: null,
      ...buildKindFilter({ kind: input.kind, mediaType: input.mediaType }),
      // 日期范围：from 含、to 不含（半开区间，配合日历选择更直观）
      ...(input.createdFrom || input.createdTo
        ? {
            createdAt: {
              ...(input.createdFrom ? { gte: input.createdFrom } : {}),
              ...(input.createdTo ? { lt: input.createdTo } : {}),
            },
          }
        : {}),
      ...(cursor
        ? {
            OR: [
              { createdAt: { lt: cursor.createdAt } },
              { createdAt: cursor.createdAt, id: { lt: cursor.id } },
            ],
          }
        : {}),
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
  });

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];

  return {
    items: page.map(serializeAsset),
    nextCursor: hasMore && last ? encodeCursor(last.createdAt, last.id) : null,
  };
}

/**
 * 资产详情 + **浏览 URL**（PRD §8.3：仅 owner，15min）。
 * ⚠️ **交付 URL 永不经此下发**（4h 的交付 URL 只由 Worker 在 submit 前现签）。
 */
export async function getAssetWithViewUrl(input: {
  userId: string;
  assetPublicId: string;
}): Promise<{ asset: SerializedAsset; viewUrl: string }> {
  const asset = await db().asset.findFirst({
    where: { publicId: input.assetPublicId, userId: input.userId, deletedAt: null },
  });
  if (!asset) throw err.notFound({ assetId: input.assetPublicId });

  const viewUrl = await presignView(asset.storageKey, VIEW_TTL_SEC);
  return { asset: serializeAsset(asset), viewUrl };
}

/**
 * 软删除（PRD §8.3）。
 *
 * **被任务引用则拒绝**（`409 ASSET_IN_USE`）：任务的输入/结果资产一旦被删，
 * 创作记录里的历史结果会变成死链，重试/再审也无从取证。
 * 判定用 PG 数组包含操作符 `@>`（`input_asset_ids` / `result_asset_ids` 是 uuid[] 列），
 * 走一次 SQL 就够，避免把全部任务拉回内存过滤。
 */
export async function softDeleteAsset(input: {
  userId: string;
  assetPublicId: string;
}): Promise<{ deleted: true; assetId: string }> {
  const asset = await db().asset.findFirst({
    where: { publicId: input.assetPublicId, userId: input.userId, deletedAt: null },
    select: { id: true, publicId: true },
  });
  if (!asset) throw err.notFound({ assetId: input.assetPublicId });

  const rows = await db().$queryRaw<Array<{ cnt: bigint | number }>>`
    SELECT COUNT(*)::bigint AS cnt
    FROM tasks
    WHERE user_id = ${input.userId}::uuid
      AND (input_asset_ids @> ARRAY[${asset.id}::uuid]
        OR result_asset_ids @> ARRAY[${asset.id}::uuid])
  `;
  const raw = rows[0]?.cnt ?? 0;
  const referenced = typeof raw === 'bigint' ? Number(raw) : Number(raw ?? 0);

  if (referenced > 0) {
    throw err.assetInUse();
  }

  await db().asset.update({
    where: { id: asset.id },
    data: { deletedAt: new Date() },
  });

  return { deleted: true, assetId: asset.publicId };
}

/** 内部用：按 publicId 取资产（owner 校验由调用方做） */
export async function findAssetByPublicId(assetPublicId: string): Promise<Asset | null> {
  return db().asset.findFirst({ where: { publicId: assetPublicId, deletedAt: null } });
}
