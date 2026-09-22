/**
 * 对象存储（S3 协议 / 默认同机 MinIO）。
 *
 * 三类 URL 三权分立（PRD §8.3）—— 严禁混用：
 * | 类型     | 用途             | 有效期 | 可见范围      |
 * | 上传 URL | 前端直传 PUT     | 15min  | 仅上传者      |
 * | 浏览 URL | 前端预览/下载    | 15min  | 仅资产 owner  |
 * | 交付 URL | 上游供应商拉取   | 4h     | 仅渠道，不下发前端、不记日志明文 |
 */

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { getConfig } from './config.js';

let client: S3Client | null = null;

function s3(): S3Client {
  if (!client) {
    const cfg = getConfig();
    client = new S3Client({
      endpoint: cfg.S3_ENDPOINT,
      region: cfg.S3_REGION,
      forcePathStyle: cfg.S3_FORCE_PATH_STYLE,
      credentials: {
        accessKeyId: cfg.S3_ACCESS_KEY,
        secretAccessKey: cfg.S3_SECRET_KEY,
      },
    });
  }
  return client;
}

/** 生成签名 URL 时使用的客户端：对外 URL 必须用公网可达基址 */
let publicClient: S3Client | null = null;
function s3Public(): S3Client {
  const cfg = getConfig();
  if (!cfg.S3_PUBLIC_ENDPOINT) return s3();
  if (!publicClient) {
    publicClient = new S3Client({
      endpoint: cfg.S3_PUBLIC_ENDPOINT,
      region: cfg.S3_REGION,
      forcePathStyle: cfg.S3_FORCE_PATH_STYLE,
      credentials: {
        accessKeyId: cfg.S3_ACCESS_KEY,
        secretAccessKey: cfg.S3_SECRET_KEY,
      },
    });
  }
  return publicClient;
}

export function bucket(): string {
  return getConfig().S3_BUCKET;
}

/** 上传 URL（预签名 PUT，15min） */
export async function presignPut(storageKey: string, mimeType: string, ttlSec?: number): Promise<string> {
  const cfg = getConfig();
  return getSignedUrl(
    s3Public(),
    new PutObjectCommand({
      Bucket: cfg.S3_BUCKET,
      Key: storageKey,
      ContentType: mimeType,
    }),
    { expiresIn: ttlSec ?? cfg.UPLOAD_URL_TTL_SEC },
  );
}

/** 浏览 URL（预签名 GET，15min，仅 owner 经 API 下发） */
export async function presignView(storageKey: string, ttlSec?: number): Promise<string> {
  const cfg = getConfig();
  return getSignedUrl(
    s3Public(),
    new GetObjectCommand({ Bucket: cfg.S3_BUCKET, Key: storageKey }),
    { expiresIn: ttlSec ?? cfg.VIEW_URL_TTL_SEC },
  );
}

/**
 * 交付 URL（预签名 GET，4h）—— 传给上游供应商拉输入文件。
 * Worker 每次 submit（含重试）前**必须重新签发**（PRD §8.3）。
 */
export async function presignDelivery(storageKey: string, ttlSec?: number): Promise<string> {
  const cfg = getConfig();
  return getSignedUrl(
    s3Public(),
    new GetObjectCommand({ Bucket: cfg.S3_BUCKET, Key: storageKey }),
    { expiresIn: ttlSec ?? cfg.DELIVERY_URL_TTL_SEC },
  );
}

export async function putObject(
  storageKey: string,
  body: Buffer | Uint8Array | string,
  contentType: string,
): Promise<void> {
  await s3().send(
    new PutObjectCommand({
      Bucket: bucket(),
      Key: storageKey,
      Body: body,
      ContentType: contentType,
    }),
  );
}

export async function headObject(storageKey: string): Promise<{ sizeBytes: number; contentType?: string } | null> {
  try {
    const res = await s3().send(new HeadObjectCommand({ Bucket: bucket(), Key: storageKey }));
    return { sizeBytes: Number(res.ContentLength ?? 0), contentType: res.ContentType };
  } catch {
    return null;
  }
}

export async function getObjectBuffer(storageKey: string): Promise<Buffer> {
  const res = await s3().send(new GetObjectCommand({ Bucket: bucket(), Key: storageKey }));
  const stream = res.Body as unknown as AsyncIterable<Uint8Array>;
  const chunks: Uint8Array[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

export async function deleteObject(storageKey: string): Promise<void> {
  await s3().send(new DeleteObjectCommand({ Bucket: bucket(), Key: storageKey }));
}

/** 存储路径：outputs/{userPublicId}/{taskPublicId}/{file}（详细设计 §3.6） */
export function outputKey(userPublicId: string, taskPublicId: string, filename: string): string {
  return `outputs/${userPublicId}/${taskPublicId}/${sanitizeFilename(filename)}`;
}

/** 上传路径：uploads/{userPublicId}/{assetPublicId}/{file} */
export function uploadKey(userPublicId: string, assetPublicId: string, filename: string): string {
  return `uploads/${userPublicId}/${assetPublicId}/${sanitizeFilename(filename)}`;
}

export function sanitizeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? 'file';
  return base.replace(/[^\w.-]+/g, '_').slice(0, 120) || 'file';
}

export function resetStorageClient(): void {
  client = null;
  publicClient = null;
}
