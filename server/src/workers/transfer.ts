/**
 * 产物转存（详细设计 §3.6 / PRD §8.4"产物转存流程"）。
 *
 * 任务 succeeded 后必须：
 *  1. 从 result_url 下载产物到我方对象存储 outputs/{userPublicId}/{taskPublicId}/{file}
 *  2. 生成资产记录 assets(kind=output, mime_type, size_bytes, width, height, duration_sec)
 *  3. 写入 tasks.result_asset_ids[]
 *  4. 前端通过 GET /v1/assets/:id 访问，不再依赖上游临时链接
 *
 * **为什么必须转存**：上游 result_url 不可控（可能删/改/限流）；转存后可加水印、
 * 设保留期、控访问权限。
 *
 * **绝不因下载失败重提任务**（平台已扣费）：下载失败重试 3 次，仍失败只告警 P2。
 */

import { request } from 'undici';
import { db, transaction } from '../core/db.js';
import { childLogger } from '../core/logger.js';
import { getConfig } from '../core/config.js';
import { newPublicId } from '../core/ids.js';
import { outputKey, putObject, presignView } from '../core/storage.js';
import { sha256 } from '../core/crypto.js';

const log = childLogger({ mod: 'transfer' });

export interface TransferOutput {
  mimeType: string;
  remoteUrl?: string;
  base64?: string;
  meta?: { width?: number; height?: number; durationSec?: number; sizeBytes?: number };
}

export interface TransferResult {
  assetPublicId: string;
  mimeType: string;
  sizeBytes: number;
  viewUrl: string;
}

const MAX_DOWNLOAD_BYTES = 512 * 1024 * 1024; // 512MB 上限兜底
const DOWNLOAD_TIMEOUT_MS = 120_000;

/** 魔数校验：防止上游返回错误内容被当成合法产物入库 */
export function sniffMime(buf: Buffer): string | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.subarray(0, 4).toString('ascii') === 'GIF8') return 'image/gif';
  if (
    buf.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buf.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }
  if (
    buf.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buf.subarray(8, 12).toString('ascii') === 'WAVE'
  ) {
    return 'audio/wav';
  }
  if (buf.subarray(4, 8).toString('ascii') === 'ftyp') return 'video/mp4';
  if (buf.subarray(0, 3).toString('ascii') === 'ID3') return 'audio/mpeg';
  // MP3 frame sync（无 ID3 头）
  if (buf[0] === 0xff && (buf[1]! & 0xe0) === 0xe0) return 'audio/mpeg';
  return null;
}

function extensionFor(mimeType: string): string {
  const map: Record<string, string> = {
    'video/mp4': 'mp4',
    'video/quicktime': 'mov',
    'video/webm': 'webm',
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'audio/mpeg': 'mp3',
    'audio/wav': 'wav',
    'audio/mp4': 'm4a',
  };
  return map[mimeType] ?? 'bin';
}

/**
 * Mock 模式产物 URL 白名单判定（纯函数，可单测）。
 *
 * 允许：data: 内联、回环地址、k8s 内网域名、minio 内网名、
 * 以及**配置的 fixture 基址的 hostname**（compose 里是 `api`，单机是 `localhost`）。
 * 判定依据是解析后的 hostname 精确匹配，而不是子串包含 ——
 * `evil-localhost.example.com` 这类域名不能蒙混过关。
 */
export function isAllowedMockOutputUrl(remoteUrl: string, fixtureBaseUrl: string): boolean {
  const normalized = remoteUrl.toLowerCase();
  if (normalized.startsWith('data:')) return true;

  let fixtureHost = '';
  try {
    fixtureHost = new URL(fixtureBaseUrl).hostname.toLowerCase();
  } catch {
    fixtureHost = '';
  }
  let urlHost = '';
  try {
    urlHost = new URL(remoteUrl).hostname.toLowerCase();
  } catch {
    return false;
  }

  return (
    urlHost === 'localhost' ||
    urlHost === '127.0.0.1' ||
    urlHost === '::1' ||
    urlHost.endsWith('.svc.cluster.local') ||
    (fixtureHost !== '' && urlHost === fixtureHost) ||
    urlHost === 'minio' ||
    urlHost.endsWith('.minio')
  );
}
/**
 * 下载产物（带重试 + 超时 + 大小上限），返回 Buffer。
 *
 * ⚠️ 关于测试：本函数用 undici 的 `request`，**nock 拦不住 undici**
 * （nock 劫持 http.ClientRequest，undici 走自研 llhttp + 连接池）。
 * 测试中若要拦截下载，必须用 `undici` 的 `MockAgent` + `setGlobalDispatcher`。
 */
export async function downloadOutput(remoteUrl: string, attempts = 3): Promise<Buffer> {
  let lastErr: unknown = null;

  // Mock 模式下的额外保险：产物远端 URL 必须指向本次部署的本地 fixture，
  // 绝不允许在 Mock 环境里真的去外网拉取（防止误配置导致打上游）。
  // 白名单逻辑见 isAllowedMockOutputUrl（以 MOCK_FIXTURE_BASE_URL 配置为准，
  // 不要在这里硬编码 service 名，否则换个名字又要改代码）。
  const cfg = getConfig();
  if (cfg.MOCK_PROVIDER) {
    if (!isAllowedMockOutputUrl(remoteUrl, cfg.MOCK_FIXTURE_BASE_URL)) {
      throw new Error(
        `MOCK_PROVIDER=true but output URL is not a local fixture: ${remoteUrl.slice(0, 80)}`,
      );
    }
  }
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await request(remoteUrl, {
        method: 'GET',
        headersTimeout: DOWNLOAD_TIMEOUT_MS,
        bodyTimeout: DOWNLOAD_TIMEOUT_MS,
      });

      if (res.statusCode < 200 || res.statusCode >= 300) {
        throw new Error(`download failed with status ${res.statusCode}`);
      }

      const chunks: Buffer[] = [];
      let total = 0;
      for await (const chunk of res.body) {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
        total += buf.length;
        if (total > MAX_DOWNLOAD_BYTES) {
          throw new Error(`download exceeded ${MAX_DOWNLOAD_BYTES} bytes`);
        }
        chunks.push(buf);
      }
      return Buffer.concat(chunks);
    } catch (e) {
      lastErr = e;
      log.warn({ err: e, remoteUrl, attempt: i + 1 }, 'download output failed, retrying');
      if (i < attempts - 1) {
        await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
      }
    }
  }

  throw new Error(`download output exhausted retries: ${String(lastErr)}`);
}

/**
 * 转存一个产物并建资产记录。
 * userId 用内部 UUID；storageKey 用对外 ID（可读且不暴露内部主键习惯）。
 */
export async function transferOne(input: {
  userId: string;
  userPublicId: string;
  taskId: string;
  taskPublicId: string;
  output: TransferOutput;
  index: number;
}): Promise<TransferResult | null> {
  const { userId, userPublicId, taskId, taskPublicId, output, index } = input;

  let buf: Buffer;
  try {
    if (output.remoteUrl) {
      buf = await downloadOutput(output.remoteUrl);
    } else if (output.base64) {
      buf = Buffer.from(output.base64.replace(/^data:[^;]+;base64,/, ''), 'base64');
    } else {
      log.warn({ taskId }, 'transfer: output has neither remoteUrl nor base64, skipped');
      return null;
    }
  } catch (e) {
    // 绝不因下载失败重提任务 —— 只告警（Sentry P2）
    log.error({ err: e, taskId, remoteUrl: output.remoteUrl }, 'transfer download failed (no retry of generation)');
    return null;
  }

  const sniffed = sniffMime(buf);
  const mimeType = sniffed ?? output.mimeType ?? 'application/octet-stream';
  if (!sniffed) {
    log.warn({ taskId, declared: output.mimeType }, 'transfer: magic number mismatch, using declared mime');
  }

  const assetPublicId = newPublicId('asset');
  const key = outputKey(userPublicId, taskPublicId, `output-${index}.${extensionFor(mimeType)}`);

  await putObject(key, buf, mimeType);

  const asset = await db().asset.create({
    data: {
      publicId: assetPublicId,
      userId,
      kind: 'output',
      mimeType,
      storageKey: key,
      sizeBytes: BigInt(buf.length),
      width: output.meta?.width ?? null,
      height: output.meta?.height ?? null,
      durationSec: output.meta?.durationSec ?? null,
      checksum: sha256(buf),
      meta: { taskId: taskPublicId, sourceRemoteUrl: output.remoteUrl ?? null },
    },
  });

  const viewUrl = await presignView(key);

  return {
    assetPublicId: asset.publicId,
    mimeType,
    sizeBytes: buf.length,
    viewUrl,
  };
}

/** 批量转存并回填 tasks.result_asset_ids[] */
export async function transferAll(input: {
  userId: string;
  taskId: string;
  taskPublicId: string;
  outputs: TransferOutput[];
}): Promise<TransferResult[]> {
  const user = await db().user.findUnique({
    where: { id: input.userId },
    select: { publicId: true },
  });
  const userPublicId = user?.publicId ?? input.userId;

  const results: TransferResult[] = [];
  for (let i = 0; i < input.outputs.length; i++) {
    const out = input.outputs[i];
    if (!out) continue;
    const r = await transferOne({
      userId: input.userId,
      userPublicId,
      taskId: input.taskId,
      taskPublicId: input.taskPublicId,
      output: out,
      index: i,
    });
    if (r) results.push(r);
  }

  if (results.length > 0) {
    const assetIds = await db().asset.findMany({
      where: { publicId: { in: results.map((r) => r.assetPublicId) } },
      select: { id: true },
    });

    await transaction(async (tx) => {
      await tx.task.update({
        where: { id: input.taskId },
        data: { resultAssetIds: assetIds.map((a) => a.id) },
      });
      await tx.taskEvent.create({
        data: {
          taskId: input.taskId,
          fromStatus: null,
          toStatus: null,
          progress: 100,
          message: `transferred ${results.length} output(s)`,
          payload: { assetIds: results.map((r) => r.assetPublicId) },
        },
      });
    });
  }

  return results;
}
