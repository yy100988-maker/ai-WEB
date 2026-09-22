/**
 * 提示词库路由（PRD §8.8 / 详细设计 §2.7）。
 *
 *   GET  /v1/prompt-library[?cat=]        { tabs[], cards[] }
 *   POST /v1/prompt-library/:id/view      浏览 +1（UV 去重）
 *   POST /v1/prompt-library/:id/copy      复制 +1，返回 { copies, title }
 *   POST /v1/prompt-library/:id/like      点赞切换 { liked, likes }
 *
 * 认证用 `app.optionalAuth`（匿名可访问）—— 前端首页提示词库是**未登录可见**的，
 * 若强制登录，首页首屏就废了。
 *
 * ⚠️ 匿名处理（详细设计 §1.9，本模块最关键的正确性点）：
 *   1. `prompt_post_events.user_id` 非空 → 匿名写 **哨兵 UUID** `ANONYMOUS_USER_ID`。
 *      若留 NULL，PG 唯一键不把 NULL 视为相等，唯一键形同虚设，可无限刷 views。
 *   2. 匿名额外用 Redis 按 **IP + 事件 + 本地日** 限频 1 次/天（`REDIS_KEYS.promptAnon`）。
 *   3. 匿名本地日固定 `Asia/Shanghai`（无用户偏好可读）。
 */

import { z } from 'zod';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { err } from '../../core/errors.js';
import { ok, type RouteModule } from '../../core/http.js';
import { childLogger } from '../../core/logger.js';
import { ANONYMOUS_USER_ID } from '../../core/ids.js';
import { allowAnonymous, listLibrary, recordCopy, recordView, toggleLike, timezoneOfUser, findPostByPublicId, ANON_TIMEZONE } from './service.js';
import { authGuard } from '../auth/guard.js';

const log = childLogger({ mod: 'prompt-routes' });

const listQuerySchema = z.object({
  cat: z.string().max(40).optional(),
});

export const promptRoutes: RouteModule = async (app: FastifyInstance) => {
  // authGuard 同时装饰 requireAuth / optionalAuth（内部幂等），提示词库用 optionalAuth
  authGuard(app);

  /**
   * 取当前用户 id：已登录返回真实 userId，匿名返回**哨兵 UUID**。
   *
   * 这里不做"未登录就 401"——本模块四个接口全部允许匿名。
   * 哨兵 UUID 是详细设计 §1.9 的强制要求（见文件头注释）。
   */
  function currentUserId(req: FastifyRequest): string {
    const userId = (req as FastifyRequest & { userId?: string }).userId;
    return userId && userId.length > 0 ? userId : ANONYMOUS_USER_ID;
  }

  function isAnonymous(req: FastifyRequest): boolean {
    const userId = (req as FastifyRequest & { userId?: string }).userId;
    return !userId || userId.length === 0;
  }

  /** 取客户端 IP（信任反代，http.ts 已设 trustProxy: true） */
  function clientIp(req: FastifyRequest): string {
    return req.ip || 'unknown';
  }

  /** 匿名限频守卫：超限抛 429 RATE_LIMITED（带 retryAfter） */
  async function guardAnonymous(req: FastifyRequest, event: 'view' | 'copy' | 'like'): Promise<void> {
    if (!isAnonymous(req)) return;
    const allowed = await allowAnonymous(clientIp(req), event);
    if (!allowed) {
      const now = new Date();
      const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      const retryAfter = Math.max(1, Math.ceil((tomorrow.getTime() - now.getTime()) / 1000));
      log.info({ ip: clientIp(req), event }, 'anonymous prompt event rate limited');
      throw err.rateLimited(retryAfter);
    }
  }

  /** 解析 `:id`（UUID 或 title 兜底）→ 内部 UUID */
  async function resolvePostId(rawId: string): Promise<string> {
    const post = await findPostByPublicId(rawId);
    if (!post) throw err.notFound({ postId: rawId });
    return post.id;
  }

  /**
   * 匿名可访问的 preHandler：A 模块的 `optionalAuth`。
   * 它解析 Bearer token 但不强制：有 token → 填 `req.userId`；无/失效 → 静默置空。
   * **必须挂上**，否则已登录用户也会被当成匿名（写哨兵 UUID），
   * 导致"同一用户反复看卡片只计 1 次"——这与 PRD §8.8 的 UV 语义不符。
   */
  const optional = () => ({ preHandler: [app.optionalAuth] });

  // ---------------------------------------------------------------- 列表
  /**
   * `{ tabs[], cards[] }`，`?cat=` 筛选（`all` 返回全部）。
   * PRD §8.8："按 locale 返回"——tabs 的 labelI18n 与 cards 的 title 都是全量下发，
   * 由前端按当前 locale 取（后端不做 locale 过滤，避免同一份数据缓存多份）。
   */
  app.get(
    '/v1/prompt-library',
    { ...optional(), config: { rateLimit: { max: 200, timeWindow: '1 minute' } } },
    async (req) => {
      const q = listQuerySchema.parse(req.query);
      const data = await listLibrary(q.cat ? { cat: q.cat } : {});
      return ok(req, data);
    },
  );

  // ---------------------------------------------------------------- view
  app.post('/v1/prompt-library/:id/view', optional(), async (req) => {
    const params = z.object({ id: z.string().min(1).max(160) }).parse(req.params);
    const userId = currentUserId(req);

    await guardAnonymous(req, 'view');

    const postId = await resolvePostId(params.id);
    // 详细设计 §1.9：date 按 UserPreference.timezone 换算的"用户本地日"；匿名用 Asia/Shanghai
    const timezone = isAnonymous(req) ? ANON_TIMEZONE : await timezoneOfUser(userId);

    const result = await recordView({ postId, userId, timezone, ip: clientIp(req) });
    return ok(req, result);
  });

  // ---------------------------------------------------------------- copy
  /**
   * 复制计数 +1，**同时返回原文**（PRD §8.8："前端复制按钮先调此接口再写剪贴板"）。
   * 返回 `{ copies, title }`。
   */
  app.post('/v1/prompt-library/:id/copy', optional(), async (req) => {
    const params = z.object({ id: z.string().min(1).max(160) }).parse(req.params);
    const userId = currentUserId(req);

    await guardAnonymous(req, 'copy');

    const postId = await resolvePostId(params.id);
    const timezone = isAnonymous(req) ? ANON_TIMEZONE : await timezoneOfUser(userId);

    const result = await recordCopy({ postId, userId, timezone });
    return ok(req, { copies: result.copies, title: result.title });
  });

  // ---------------------------------------------------------------- like
  /**
   * 点赞**切换**：返回 `{ liked, likes }`（PRD §8.8 / 详细设计 §1.9）。
   * 首期前端可以不接，但接口必须就位（为后续点赞按钮预留）。
   */
  app.post('/v1/prompt-library/:id/like', optional(), async (req) => {
    const params = z.object({ id: z.string().min(1).max(160) }).parse(req.params);
    const userId = currentUserId(req);

    // 匿名禁止点赞：like 是"用户身份"语义的持久状态，
    // 用哨兵 UUID 记录会让所有匿名访客共享一个点赞状态（第一个人点赞后所有人都显示已赞）。
    if (isAnonymous(req)) {
      throw err.unauthorized({ reason: 'like requires authentication' });
    }

    const postId = await resolvePostId(params.id);
    const timezone = await timezoneOfUser(userId);

    const result = await toggleLike({ postId, userId, timezone });
    return ok(req, result);
  });
};
