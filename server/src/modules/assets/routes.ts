/**
 * 资产路由（PRD §8.3 / 详细设计 §2.4）。
 *
 *   POST   /v1/assets/upload-url   { mimeType, sizeBytes, kind } → 预签名 PUT（15min）
 *   POST   /v1/assets              { assetId } → 确认上传完成（异步魔数校验）
 *   POST   /v1/assets/import-url   { url, kind } → 服务端拉取并转存（**SSRF 防护**）
 *   GET    /v1/assets?kind=&cursor=&limit=
 *   GET    /v1/assets/:id          → { asset, viewUrl }（仅 owner；交付 URL 永不经此下发）
 *   DELETE /v1/assets/:id          → 软删除（被任务引用则 409 ASSET_IN_USE）
 *
 * 认证：本模块全部需要登录（`app.requireAuth`）。
 * `authGuard(app)` 内部幂等（`app.hasDecorator()` 判断），可安全重复调用。
 */

import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { err } from '../../core/errors.js';
import { ok, paged, requireUserId, type RouteModule } from '../../core/http.js';
import { db } from '../../core/db.js';
import {
  confirmUpload,
  createUploadUrl,
  getAssetWithViewUrl,
  importFromUrl,
  listAssets,
  softDeleteAsset,
} from './service.js';

// A 模块（auth/guard.ts）已就绪：直接静态 import。
// 早前为并行开发期写的"动态 import + 401 兜底"已移除 —— 那种降级是**静默失败**
// （接口在、永远 401，编译期无提示），只在 A 模块缺失时才有意义，现在只会掩盖真实故障。
import { authGuard } from '../auth/guard.js';

const uploadUrlSchema = z.object({
  mimeType: z.string().min(1).max(120),
  sizeBytes: z.coerce.number().int().positive(),
  kind: z.enum(['upload', 'output']).default('upload'),
  filename: z.string().max(160).optional(),
});

const confirmSchema = z.object({
  assetId: z.string().min(1).max(64),
});

const importUrlSchema = z.object({
  url: z.string().min(1).max(2048),
  kind: z.enum(['upload', 'output']).default('upload'),
  /** 可选：显式声明期望的媒体类型，用于 Content-Type 一致性校验 */
  mediaType: z.enum(['image', 'video', 'audio']).optional(),
});

/** 批量软删除：一次最多 100 个，避免单请求打爆 DB */
const batchDeleteSchema = z.object({
  assetIds: z.array(z.string().min(1).max(64)).min(1).max(100),
});

const listQuerySchema = z.object({
  kind: z.enum(['upload', 'output', 'image', 'video', 'audio']).optional(),
  /** 显式媒体类型（与 kind=image|video|audio 等价，语义更清晰） */
  mediaType: z.enum(['image', 'video', 'audio']).optional(),
  /** 创建时间下界（ISO 8601，含） */
  createdFrom: z.string().datetime({ offset: true }).optional(),
  /** 创建时间上界（ISO 8601，不含） */
  createdTo: z.string().datetime({ offset: true }).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export const assetRoutes: RouteModule = async (app: FastifyInstance) => {
  // authGuard 内部幂等（hasDecorator 判断），多模块重复调用安全
  authGuard(app);

  /** 受保护路由的 preHandler（A 模块的 requireAuth，未登录抛 401） */
  const auth = () => ({ preHandler: [app.requireAuth] });

  /** 取当前用户 publicId（上传路径需要） */
  async function userPublicIdOf(userId: string): Promise<string> {
    const user = await db().user.findUnique({ where: { id: userId }, select: { publicId: true } });
    if (!user) throw err.unauthorized();
    return user.publicId;
  }

  // ---------------------------------------------------------------- upload-url
  app.post('/v1/assets/upload-url', auth(), async (req, reply) => {
    const userId = requireUserId(req);
    const body = uploadUrlSchema.parse(req.body);

    const result = await createUploadUrl({
      userId,
      userPublicId: await userPublicIdOf(userId),
      mimeType: body.mimeType,
      sizeBytes: body.sizeBytes,
      kind: body.kind,
      ...(body.filename ? { filename: body.filename } : {}),
    });

    reply.status(201);
    return ok(req, result);
  });

  // ---------------------------------------------------------------- 确认上传
  app.post('/v1/assets', auth(), async (req) => {
    const userId = requireUserId(req);
    const body = confirmSchema.parse(req.body);

    const result = await confirmUpload({ userId, assetPublicId: body.assetId });
    return ok(req, { asset: result.asset });
  });

  // ---------------------------------------------------------------- import-url
  /**
   * ⚠️ SSRF 防护验收项（PRD §8.3 / §13 #21）。
   * 传内网地址 / 超大文件 / 非法 Content-Type **全部必须被拒**（422），
   * 且**无资产残留、无扣费** —— 本路由在任何校验失败路径上都不写 `assets` 表。
   */
  app.post('/v1/assets/import-url', auth(), async (req, reply) => {
    const userId = requireUserId(req);
    const body = importUrlSchema.parse(req.body);

    const expectMedia = body.mediaType ?? undefined;

    const result = await importFromUrl({
      userId,
      userPublicId: await userPublicIdOf(userId),
      url: body.url,
      kind: body.kind,
      ...(expectMedia ? { expectMedia } : {}),
    });

    // 详细设计 §2.4 写的是 202 fetching（异步 Worker）；本期是同步拉取（文件小、30s 超时内可完成），
    // 完成后即为 ready，因此用 201 更准确。这里保留 status 字段兼容前端两种处理。
    reply.status(201);
    return ok(req, result);
  });

  // ---------------------------------------------------------------- 列表
  app.get('/v1/assets', auth(), async (req) => {
    const userId = requireUserId(req);
    const q = listQuerySchema.parse(req.query);

    // ⚠️ 媒体类型筛选（image/video/audio）必须下推到 DB：
    // 过去是先按 limit 取一页再在内存里 filter，导致「筛图片」时
    // 每页可能只剩个位数、且 nextCursor 指向的是未过滤的位置（翻页会漏数据）。
    // 现在统一交给 listAssets 在 where 里用 mime_type 前缀过滤。
    const page = await listAssets({
      userId,
      ...(q.kind ? { kind: q.kind } : {}),
      ...(q.mediaType ? { mediaType: q.mediaType } : {}),
      ...(q.createdFrom ? { createdFrom: new Date(q.createdFrom) } : {}),
      ...(q.createdTo ? { createdTo: new Date(q.createdTo) } : {}),
      ...(q.cursor ? { cursor: q.cursor } : {}),
      ...(q.limit ? { limit: q.limit } : {}),
    });

    return paged(req, page.items, page.nextCursor);
  });

  // ---------------------------------------------------------------- 详情
  app.get('/v1/assets/:id', auth(), async (req) => {
    const userId = requireUserId(req);
    const params = z.object({ id: z.string().min(1).max(64) }).parse(req.params);

    // 仅 owner（service 内以 userId 过滤，非 owner 得到 404 而非 403，不泄露存在性）
    const result = await getAssetWithViewUrl({ userId, assetPublicId: params.id });
    return ok(req, result);
  });

  // ---------------------------------------------------------------- 软删除
  app.delete('/v1/assets/:id', auth(), async (req) => {
    const userId = requireUserId(req);
    const params = z.object({ id: z.string().min(1).max(64) }).parse(req.params);

    const result = await softDeleteAsset({ userId, assetPublicId: params.id });
    return ok(req, result);
  });

  // ---------------------------------------------------------------- 批量软删除
  /**
   * 个人中心「批量操作」用：一次删多张作品。
   *
   * 语义与单个删除一致（软删除；**被任务引用则拒绝**，避免创作记录出现死链），
   * 但**逐个独立处理**：某个资产失败不影响其余，
   * 结果里逐条回报 deleted / skipped，前端据此提示"n 成功 / m 被占用"。
   */
  app.post('/v1/assets/batch-delete', auth(), async (req) => {
    const userId = requireUserId(req);
    const body = batchDeleteSchema.parse(req.body ?? {});

    const deleted: string[] = [];
    const skipped: Array<{ id: string; reason: string; message: string }> = [];

    for (const id of body.assetIds) {
      try {
        await softDeleteAsset({ userId, assetPublicId: id });
        deleted.push(id);
      } catch (e) {
        const code = (e as { code?: string }).code ?? 'UNKNOWN';
        // ASSET_IN_USE 是最常见的"删不掉"原因（作品被创作记录引用），
        // 给出可读 message，前端才能提示用户"该作品已被记录引用，无法删除"。
        const message =
          code === 'ASSET_IN_USE'
            ? '该作品已被创作记录引用，无法删除'
            : code === 'NOT_FOUND'
              ? '作品不存在或已删除'
              : '删除失败';
        skipped.push({ id, reason: code, message });
      }
    }

    return ok(req, { deleted, skipped });
  });
};
