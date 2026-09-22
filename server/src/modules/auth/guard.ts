/**
 * 认证守卫（契约 §3）。
 *
 * 用法：
 * ```ts
 * authGuard(app);                                   // 每个插件内调用一次
 * app.get('/v1/auth/me', { preHandler: [app.requireAuth] }, handler);
 * ```
 *
 * 行为：
 * - 从 `Authorization: Bearer <access_token>` 取令牌 → `verifyAccessToken`
 * - 查库确认 `status === 'active'` 且未 `deletedAt`（注销中 → 409 ACCOUNT_DELETION_PENDING）
 * - 注入 `req.userId`(uuid) / `req.userPlanCode` / `req.userLocale`
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { db } from '../../core/db.js';
import { err } from '../../core/errors.js';
import { extractBearerToken, verifyAccessToken } from './tokens.js';

/** 请求对象上的认证上下文（避免依赖 declaration merging 时的可选性） */
function decorate(app: FastifyInstance): void {
  // ⚠️ Fastify 5：decorateRequest 的初值用 null（不能传对象字面量，否则会被所有请求共享）
  app.decorateRequest('userId');
  app.decorateRequest('userPlanCode');
  app.decorateRequest('userLocale');
}

/** 已认证用户 ID；未认证抛 401 */
export function currentUserId(req: FastifyRequest): string {
  const userId = req.userId;
  if (!userId) throw err.unauthorized();
  return userId;
}

/**
 * 解析 Bearer access token 并校验用户状态。
 * @returns 成功时 true；`optional=true` 且失败时返回 false（不抛错）
 */
async function authenticate(req: FastifyRequest, optional: boolean): Promise<boolean> {
  const token = extractBearerToken(req.headers.authorization);
  if (!token) {
    if (optional) return false;
    throw err.unauthorized();
  }

  const verified = verifyAccessToken(token);
  if (!verified.ok) {
    if (optional) return false;
    throw err.unauthorized();
  }

  // access token 无状态，但账号状态必须实时核对（封禁/注销立即生效）
  const user = await db().user.findUnique({
    where: { id: verified.value.userId },
    select: { id: true, status: true, deletedAt: true, locale: true, plan: { select: { code: true } } },
  });

  if (!user) {
    if (optional) return false;
    throw err.unauthorized();
  }
  if (user.deletedAt !== null || user.status === 'deleted') throw err.accountDeletionPending();
  if (user.status !== 'active') {
    if (optional) return false;
    throw err.unauthorized();
  }

  req.userId = user.id;
  req.userPlanCode = user.plan.code;
  req.userLocale = user.locale;
  return true;
}

/** 注册认证装饰器：requireAuth / optionalAuth / authenticate */
export function authGuard(app: FastifyInstance): void {
  if (!app.hasRequestDecorator('userId')) {
    decorate(app);
  }

  const requireAuth = async (req: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    await authenticate(req, false);
  };

  const optionalAuth = async (req: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    try {
      await authenticate(req, true);
    } catch {
      // 可选鉴权绝不因令牌问题失败
      req.userId = undefined;
      req.userPlanCode = undefined;
      req.userLocale = undefined;
    }
  };

  if (!app.hasDecorator('requireAuth')) app.decorate('requireAuth', requireAuth);
  if (!app.hasDecorator('optionalAuth')) app.decorate('optionalAuth', optionalAuth);
  if (!app.hasDecorator('authenticate')) app.decorate('authenticate', requireAuth);
}
