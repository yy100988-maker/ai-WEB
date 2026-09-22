/**
 * 签到路由（PRD §8.7 / 详细设计 §2.7）。
 *
 *   POST /v1/checkin              当日签到 → { credits, balance, ... }
 *   GET  /v1/checkin/today        今日签到状态（**权威本地日**，规则 2）
 *   GET  /v1/checkin/history?limit=  签到记录
 *
 * 认证：全部需要登录。
 */

import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { ok, requireUserId, type RouteModule } from '../../core/http.js';
import { authGuard } from '../auth/guard.js';
import { checkin, history, todayStatus } from './service.js';

const historyQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(365).optional(),
});

export const checkinRoutes: RouteModule = async (app: FastifyInstance) => {
  // authGuard 内部幂等，多模块重复调用安全
  authGuard(app);

  /** 受保护路由的 preHandler（A 模块的 requireAuth，未登录抛 401） */
  const auth = () => ({ preHandler: [app.requireAuth] });

  // ---------------------------------------------------------------- 签到
  /**
   * 返回值必须含 `{ credits: 5, balance }`（详细设计 §2.7 / §13 #3）。
   * 同日重复 → 409 `ALREADY_CHECKED_IN`（唯一键冲突，含并发双击）。
   */
  app.post('/v1/checkin', auth(), async (req) => {
    const userId = requireUserId(req);
    const result = await checkin(userId);

    return ok(req, {
      credits: result.credits,
      balance: result.balance,
      // 规则 2：把权威本地日与过期点一并下发，前端不得自行算日期
      date: result.date,
      timezone: result.timezone,
      expiresAt: result.expiresAt,
      checkedIn: true,
    });
  });

  // ---------------------------------------------------------------- 今日状态
  /**
   * 规则 2 的落点：**前端展示与后端判定同源**。
   * 返回 `checkedIn` + 权威 `date` + `timezone`，前端直接渲染，不再自行算"今天"。
   */
  app.get('/v1/checkin/today', auth(), async (req) => {
    const userId = requireUserId(req);
    const status = await todayStatus(userId);
    return ok(req, {
      checkedIn: status.checkedIn,
      credits: status.credits,
      date: status.date,
      timezone: status.timezone,
      expiresAt: status.expiresAt,
    });
  });

  // ---------------------------------------------------------------- 记录
  app.get('/v1/checkin/history', auth(), async (req) => {
    const userId = requireUserId(req);
    const q = historyQuerySchema.parse(req.query);
    const result = await history(userId, q.limit ?? 30);
    return ok(req, result);
  });
};
