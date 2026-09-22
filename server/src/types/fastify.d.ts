/**
 * 类型扩展（declaration merging）。
 *
 * ⚠️ `requestId` / `locale` 已由 `src/core/http.ts` 声明，此处**不得重复声明**，
 * 只追加认证上下文与 FastifyInstance 上的鉴权装饰器。
 */

import type { FastifyReply } from 'fastify';

declare module 'fastify' {
  interface FastifyRequest {
    /** users.id（UUID），由 requireAuth 注入 */
    userId?: string;
    /** users.plan.code */
    userPlanCode?: string;
    /** users.locale */
    userLocale?: string;
  }

  interface FastifyInstance {
    /** 强制鉴权 preHandler：未登录/令牌失效抛 401 */
    requireAuth: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    /** 可选鉴权 preHandler：无 token 或无效令牌不报错 */
    optionalAuth: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    /** 兼容写法：与 requireAuth 相同实现（契约 §3 两种命名均被引用） */
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}
