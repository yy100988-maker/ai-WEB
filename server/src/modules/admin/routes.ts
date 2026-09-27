/**
 * 最小 admin 接口（详细设计 §2.7 / PRD §8.2 上下架）。
 *
 *   POST /v1/admin/models/:id/active   { active }   上下架模型（运营开关 ★ 名单）
 *
 * ⚠️ 模块边界（CONTRACT §4 模块所有权表）：
 *   - `/v1/admin/credits/adjust` 与 `/v1/admin/users` 由 **B 模块（billing）** 负责，
 *     本模块**不重复实现**（重复注册会让 Fastify 抛 "Method already declared"）。
 *
 * 鉴权：`Authorization: Bearer <ADMIN_TOKEN>`，与其他 admin 接口一致。
 * 本文件导出 `adminGuard()` 供 B 模块的 admin 路由复用，避免两处各写一遍常量时间比较。
 */

import { z } from 'zod';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Prisma } from '@prisma/client';
import { db } from '../../core/db.js';
import { err } from '../../core/errors.js';
import { safeEqual, sha256 } from '../../core/crypto.js';
import { getConfig } from '../../core/config.js';
import { ok, type RouteModule } from '../../core/http.js';
import { childLogger } from '../../core/logger.js';
import { findInternalCodenameLeaks } from '../catalog/service.js';
import { reviewPost } from '../prompts/publish.js';

const log = childLogger({ mod: 'admin' });

/**
 * admin key 指纹：`sha256(token)` 前 12 位（详细设计 §1.8 `admin_key` 字段说明）。
 * **绝不存明文 token** —— 审计日志会被导出/查询，明文等于泄露管理员凭据。
 */
export function adminKeyFingerprint(token: string): string {
  return sha256(token).slice(0, 12);
}

/**
 * 校验 admin Bearer token。
 *
 * 用 `safeEqual`（常量时间比较，core/crypto.ts）而不是 `===`：
 * 普通字符串比较会在第一个不同字节处提前返回，攻击者可以用**响应耗时差异**
 * 逐字节爆破 token（时序侧信道）。`ADMIN_TOKEN` 是平台最高权限凭据，必须防这一手。
 */
export function verifyAdminToken(req: FastifyRequest): string {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    throw err.unauthorized({ reason: 'admin token required' });
  }
  const token = header.slice(7).trim();
  if (token.length === 0) {
    throw err.unauthorized({ reason: 'admin token required' });
  }

  const expected = getConfig().ADMIN_TOKEN;
  if (!safeEqual(token, expected)) {
    log.warn({ ip: req.ip }, 'admin auth failed');
    // 不区分"格式错"与"token 错"，避免给攻击者额外信息
    throw err.unauthorized({ reason: 'invalid admin token' });
  }

  return token;
}

/**
 * 注册 admin preHandler（供本模块与 B 模块 admin 路由共用）。
 * `app.hasDecorator()` 保证幂等 —— 幂等很重要：多个模块各自调用一次不会重复装饰。
 */
export function adminGuard(app: FastifyInstance): void {
  if (!app.hasDecorator('requireAdmin')) {
    app.decorate('requireAdmin', async (req: FastifyRequest) => {
      verifyAdminToken(req);
    });
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    requireAdmin: (req: FastifyRequest) => Promise<void>;
  }
}

/** 写 `admin_audit_logs`（详细设计 §1.8）。失败只记日志，不让审计失败掩盖业务结果。 */
export async function recordAdminAudit(input: {
  adminKey: string;
  action: string;
  target: Record<string, unknown>;
  payload?: Record<string, unknown>;
}): Promise<void> {
  try {
    await db().adminAuditLog.create({
      data: {
        adminKey: input.adminKey,
        action: input.action,
        // Prisma 的 Json 列要求 JsonValue；Record<string, unknown> 不能直接赋值，
        // 经 unknown 转一次（内容本身是普通 JSON 对象，运行时安全）。
        target: input.target as unknown as Prisma.InputJsonValue,
        payload: (input.payload ?? {}) as unknown as Prisma.InputJsonValue,
      },
    });
  } catch (e) {
    // 审计写失败不阻塞运营操作，但必须留痕（error 级别，会进告警）
    log.error({ err: e, action: input.action, target: input.target }, 'admin audit write failed');
  }
}

const activeBodySchema = z.object({
  active: z.boolean(),
});

export const adminRoutes: RouteModule = async (app: FastifyInstance) => {
  adminGuard(app);

  // ============================ xiaoye-adoption F4：广场帖子审核（R1，方案 §6，决议 D3 兜底） ============================

  const reviewBody = z.object({ reason: z.string().max(200).optional() });

  /** 待审/在架列表（?status=pending|published|rejected|all，默认 pending） */
  app.get('/v1/admin/prompt-posts', { preHandler: [app.requireAdmin] }, async (req) => {
    const q = z
      .object({
        status: z.enum(['pending', 'published', 'rejected', 'all']).default('pending'),
        limit: z.coerce.number().int().min(1).max(200).default(50),
        cursor: z.string().optional(),
      })
      .parse(req.query);

    const rows = await db().promptPost.findMany({
      where: q.status === 'all' ? {} : { status: q.status },
      orderBy: [{ createdAt: 'desc' }],
      take: q.limit + 1,
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > q.limit;
    const items = hasMore ? rows.slice(0, q.limit) : rows;
    return ok(req, {
      items: items.map((post) => ({
        id: post.id,
        tabCode: post.tabCode,
        title: post.title,
        imgUrl: post.imgUrl,
        status: post.status,
        createdBy: post.createdBy,
        rejectReason: post.rejectReason,
        active: post.active,
        createdAt: post.createdAt.toISOString(),
      })),
      nextCursor: hasMore ? (items[items.length - 1]?.id ?? null) : null,
    });
  });

  /** 审核通过：仅 pending → published（重复 approve 400），写审计 */
  app.post('/v1/admin/prompt-posts/:id/approve', { preHandler: [app.requireAdmin] }, async (req) => {
    const params = z.object({ id: z.string().uuid() }).parse(req.params);
    const result = await reviewPost({ postId: params.id, action: 'approve' });
    await recordAdminAudit({
      adminKey: adminKeyFingerprint(verifyAdminToken(req)),
      action: 'prompt_post.approve',
      target: { postId: params.id, status: result.status },
    });
    return ok(req, result);
  });

  /**
   * 驳回：pending → rejected；published → rejected **放行**（事后下架 —— D3 自动过审
   * 必须保留的人工兜底能力），写审计。
   */
  app.post('/v1/admin/prompt-posts/:id/reject', { preHandler: [app.requireAdmin] }, async (req) => {
    const params = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = reviewBody.parse(req.body ?? {});
    const result = await reviewPost({
      postId: params.id,
      action: 'reject',
      ...(body.reason !== undefined ? { rejectReason: body.reason } : {}),
    });
    await recordAdminAudit({
      adminKey: adminKeyFingerprint(verifyAdminToken(req)),
      action: 'prompt_post.reject',
      target: { postId: params.id, status: result.status },
      payload: { reason: body.reason ?? '' },
    });
    return ok(req, result);
  });


  /**
   * 模型上下架（详细设计 §2.7：`POST /v1/admin/models/:id/active { active }`）。
   *
   * 为什么这是"运营开关 ★ 名单"的唯一入口（PRD §14 #2）：
   *   首期上架名单锁死 9 个模型位，后续增减**只改 `active` 配置**、不改代码、不发版。
   *   因此这个接口的正确性直接决定"哪些模型对客可见"。
   *
   * `:id` 接受 UUID 或 `models.code`（PRD §8.4 的请求体示例用的是 code）。
   *
   * ⚠️ 上架前校验 `display_name` 不含内部代号（PRD §8.2 硬性规则）：
   *   否则会把 `tt-image-2` 这类渠道代号泄露到前端。
   *   这里**拒绝上架**而不是静默放行 —— 让运营在操作当下就知道要改展示名。
   */
  app.post('/v1/admin/models/:id/active', { preHandler: [app.requireAdmin] }, async (req) => {
    const token = verifyAdminToken(req); // preHandler 已校验；这里再取一次用于审计指纹
    const params = z.object({ id: z.string().min(1).max(120) }).parse(req.params);
    const body = activeBodySchema.parse(req.body);

    const model = await db().model.findFirst({
      where: { OR: [{ id: params.id }, { code: params.id }] },
      select: { id: true, code: true, displayName: true, active: true, enabled: true },
    });
    if (!model) throw err.notFound({ modelId: params.id });

    // 上架前必须保证展示名合规（否则 catalog 会拒发该模型，运营会困惑"为什么上架了看不到"）
    if (body.active) {
      const leaks = findInternalCodenameLeaks(model.displayName);
      if (leaks.length > 0 || model.displayName.trim().length === 0) {
        throw err.invalidParams({
          modelId: model.code,
          displayName: model.displayName,
          reason: 'display_name 泄露上游内部代号或为空，请先修正后再上架（PRD §8.2）',
          leaks,
        });
      }
    }

    const updated = await db().model.update({
      where: { id: model.id },
      data: { active: body.active },
      select: { id: true, code: true, displayName: true, active: true, enabled: true },
    });

    await recordAdminAudit({
      adminKey: adminKeyFingerprint(token),
      action: 'models.active',
      target: { modelId: updated.id, modelCode: updated.code },
      payload: { before: model.active, after: updated.active, displayName: updated.displayName },
    });

    log.info(
      { modelCode: updated.code, active: updated.active, adminKey: adminKeyFingerprint(token) },
      'admin toggled model active',
    );

    return ok(req, {
      model: {
        id: updated.id,
        code: updated.code,
        displayName: updated.displayName,
        active: updated.active,
        enabled: updated.enabled,
      },
    });
  });
};
