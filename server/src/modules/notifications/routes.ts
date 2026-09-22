/**
 * 通知路由（PRD §8.6 / 详细设计 §2.7）。
 *
 *   GET  /v1/notifications?cursor=&limit=   通知列表（倒序游标分页）
 *   POST /v1/notifications/:id/read         标记单条已读
 *   POST /v1/notifications/read-all         全部已读
 *   GET  /v1/notifications/unread-count     未读数（驱动前端红点）
 *
 * ⚠️ 路由注册顺序：`/read-all` 必须**先于** `/:id/read` 注册吗？不需要——
 * 两者路径段数不同（`/read-all` 是 3 段，`/:id/read` 也是 3 段），
 * 但 `/v1/notifications/read-all` 不匹配 `/v1/notifications/:id/read`（后者要求末段是 `read`），
 * 所以无冲突。这里仍显式把 read-all 放在前面，避免将来有人改成 `/:id` 时踩坑。
 */

import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { ok, paged, requireUserId, type RouteModule } from '../../core/http.js';
import { authGuard } from '../auth/guard.js';
import { listNotifications, markAllRead, markRead, unreadCount } from './service.js';

const listQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export const notificationRoutes: RouteModule = async (app: FastifyInstance) => {
  // authGuard 内部幂等，多模块重复调用安全
  authGuard(app);

  /** 受保护路由的 preHandler（A 模块的 requireAuth，未登录抛 401） */
  const auth = () => ({ preHandler: [app.requireAuth] });

  // ---------------------------------------------------------------- 未读数
  /**
   * 放在列表之前注册：前端红点轮询频率高于列表，且它是**最轻**的接口（一次 COUNT）。
   * 返回 `{ count }`（PRD §8.6 / §13 #17）。
   */
  app.get('/v1/notifications/unread-count', auth(), async (req) => {
    const userId = requireUserId(req);
    return ok(req, { count: await unreadCount(userId) });
  });

  // ---------------------------------------------------------------- 全部已读
  app.post('/v1/notifications/read-all', auth(), async (req) => {
    const userId = requireUserId(req);
    const result = await markAllRead(userId);
    return ok(req, { updated: result.updated });
  });

  // ---------------------------------------------------------------- 列表
  app.get('/v1/notifications', auth(), async (req) => {
    const userId = requireUserId(req);
    const q = listQuerySchema.parse(req.query);

    const page = await listNotifications({
      userId,
      ...(q.cursor ? { cursor: q.cursor } : {}),
      ...(q.limit ? { limit: q.limit } : {}),
    });

    return paged(req, page.items, page.nextCursor);
  });

  // ---------------------------------------------------------------- 单条已读
  app.post('/v1/notifications/:id/read', auth(), async (req) => {
    const userId = requireUserId(req);
    const params = z.object({ id: z.string().min(1).max(64) }).parse(req.params);

    const result = await markRead({ userId, notificationId: params.id });
    return ok(req, result);
  });
};
