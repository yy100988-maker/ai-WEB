/**
 * 任务路由（详细设计 §2.5 / §3.5 SSE）。
 *
 *   POST /v1/tasks              提交生成任务
 *   GET  /v1/tasks              创作记录（Filter 全部/视频/图片/音频）
 *   GET  /v1/tasks/:id          详情（轮询降级方案）
 *   GET  /v1/tasks/:id/stream   SSE 进度流（主方案）
 *   POST /v1/tasks/:id/cancel   取消
 *   POST /v1/tasks/:id/retry    失败任务重试
 *
 * 注：POST /v1/pricing/quote 由 billing 模块提供（避免重复注册）。
 */

import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { db } from '../../core/db.js';
import { err } from '../../core/errors.js';
import { ok, paged, requireUserId, type RouteModule } from '../../core/http.js';
import { createRedis, REDIS_KEYS } from '../../core/redis.js';
import { childLogger } from '../../core/logger.js';
import { taskService } from './service.js';
import { authGuard } from '../auth/guard.js';
import { readCachedTaskState, type TaskEventPayload } from './events.js';

const log = childLogger({ mod: 'task-routes' });

const createTaskSchema = z.object({
  capability: z.string().min(1),
  modelId: z.string().optional(),
  prompt: z.string().min(1).max(8000),
  negativePrompt: z.string().max(4000).optional(),
  inputAssetIds: z.array(z.string()).max(20).default([]),
  params: z.record(z.union([z.string(), z.number(), z.boolean(), z.array(z.string())])).default({}),
  idempotencyKey: z.string().min(8).max(128),
});

const listQuerySchema = z.object({
  capability: z.string().optional(),
  status: z.string().optional(),
  type: z.enum(['video', 'image', 'audio']).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export const taskRoutes: RouteModule = async (app: FastifyInstance) => {
  authGuard(app);

  // ---------------------------------------------------------------- 提交
  app.post('/v1/tasks', { preHandler: [app.requireAuth] }, async (req, reply) => {
    const userId = requireUserId(req);
    const body = createTaskSchema.parse(req.body);

    const headerKey = req.headers['idempotency-key'];
    const idempotencyKey =
      typeof headerKey === 'string' && headerKey.length >= 8 ? headerKey : body.idempotencyKey;

    const ctx = await loadUserContext(userId);

    // Mock 失败注入：仅非生产环境透传（生产强制忽略）
    const mockFailHeader = req.headers['x-mock-fail'];
    const mockFail =
      typeof mockFailHeader === 'string' && mockFailHeader.length > 0 ? mockFailHeader : undefined;

    const result = await taskService.create({
      userId,
      userPublicId: ctx.publicId,
      planMaxConcurrency: ctx.maxConcurrency,
      capability: body.capability,
      ...(body.modelId ? { modelId: body.modelId } : {}),
      prompt: body.prompt,
      ...(body.negativePrompt ? { negativePrompt: body.negativePrompt } : {}),
      inputAssetIds: body.inputAssetIds,
      params: body.params as Record<string, string | number | boolean | string[]>,
      idempotencyKey,
      ...(mockFail ? { mockFail } : {}),
    });

    reply.status(result.idempotentReplay ? 200 : 201);
    return ok(
      req,
      {
        task: {
          id: result.taskPublicId,
          status: result.status,
          progress: result.progress,
          capability: result.capability,
          model: { id: result.modelId, displayName: result.modelDisplayName },
          quotedCredits: result.quotedCredits,
          remainingCredits: result.remainingCredits,
          createdAt: result.createdAt.toISOString(),
          estimatedSec: result.estimatedSec,
        },
      },
      { idempotentReplay: result.idempotentReplay },
    );
  });

  // ---------------------------------------------------------------- 列表
  app.get('/v1/tasks', { preHandler: [app.requireAuth] }, async (req) => {
    const userId = requireUserId(req);
    const q = listQuerySchema.parse(req.query);
    const page = await taskService.list({
      userId,
      ...(q.capability ? { capability: q.capability } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.type ? { type: q.type } : {}),
      ...(q.cursor ? { cursor: q.cursor } : {}),
      ...(q.limit ? { limit: q.limit } : {}),
    });
    return paged(req, page.items, page.nextCursor);
  });

  // ---------------------------------------------------------------- SSE（主方案）
  app.get('/v1/tasks/:id/stream', { preHandler: [app.requireAuth] }, async (req, reply) => {
    const userId = requireUserId(req);
    const params = z.object({ id: z.string() }).parse(req.params);
    const taskPublicId = params.id;

    const task = await db().task.findFirst({
      where: { publicId: taskPublicId, userId },
      select: { id: true, status: true, progress: true, publicId: true },
    });
    if (!task) throw err.notFound();

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // 禁用反代缓冲，保证 SSE 首字节 < 500ms
    });

    const send = (event: string, data: unknown) => {
      reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    // 断线重连/首次连接：先推当前态（§3.5 断线后重连可恢复当前状态）
    const cached = await readCachedTaskState(taskPublicId);
    const current: TaskEventPayload =
      cached ?? { taskPublicId, status: task.status as TaskEventPayload['status'], progress: task.progress };
    send('progress', current);

    const terminal = ['succeeded', 'failed', 'cancelled', 'timeout'];
    if (terminal.includes(current.status)) {
      const detail = await taskService.get(userId, taskPublicId);
      send(current.status, detail);
      reply.raw.end();
      return reply;
    }

    const sub = createRedis();
    const channel = REDIS_KEYS.taskChannel(taskPublicId);

    const heartbeat = setInterval(() => {
      reply.raw.write(': ping\n\n'); // 15s 心跳保活
    }, 15000);

    const cleanup = () => {
      clearInterval(heartbeat);
      sub.disconnect();
      if (!reply.raw.writableEnded) reply.raw.end();
    };

    sub.on('message', (_ch: string, message: string) => {
      try {
        const evt = JSON.parse(message) as TaskEventPayload;
        if (terminal.includes(evt.status)) {
          void (async () => {
            const detail = await taskService.get(userId, taskPublicId);
            send(evt.status, { ...detail, ...evt });
            cleanup();
          })();
        } else {
          send('progress', evt);
        }
      } catch (e) {
        log.warn({ err: e, taskPublicId }, 'malformed SSE payload');
      }
    });

    await sub.subscribe(channel);
    req.raw.on('close', cleanup);

    return reply;
  });

  // ---------------------------------------------------------------- 详情（轮询降级）
  app.get('/v1/tasks/:id', { preHandler: [app.requireAuth] }, async (req) => {
    const userId = requireUserId(req);
    const params = z.object({ id: z.string() }).parse(req.params);
    return ok(req, await taskService.get(userId, params.id));
  });

  // ---------------------------------------------------------------- 取消
  app.post('/v1/tasks/:id/cancel', { preHandler: [app.requireAuth] }, async (req) => {
    const userId = requireUserId(req);
    const params = z.object({ id: z.string() }).parse(req.params);
    const r = await taskService.cancel(userId, params.id);
    return ok(req, r);
  });

  // ---------------------------------------------------------------- 重试
  app.post('/v1/tasks/:id/retry', { preHandler: [app.requireAuth] }, async (req) => {
    const userId = requireUserId(req);
    const params = z.object({ id: z.string() }).parse(req.params);

    const body = z.object({ idempotencyKey: z.string().min(8).max(128) }).parse(req.body ?? {});
    const headerKey = req.headers['idempotency-key'];
    const idempotencyKey =
      typeof headerKey === 'string' && headerKey.length >= 8 ? headerKey : body.idempotencyKey;

    const ctx = await loadUserContext(userId);
    const result = await taskService.retry(
      userId,
      ctx.publicId,
      ctx.maxConcurrency,
      params.id,
      idempotencyKey,
    );

    return ok(req, {
      task: {
        id: result.taskPublicId,
        status: result.status,
        progress: result.progress,
        capability: result.capability,
        model: { id: result.modelId, displayName: result.modelDisplayName },
        quotedCredits: result.quotedCredits,
        remainingCredits: result.remainingCredits,
        createdAt: result.createdAt.toISOString(),
      },
    });
  });
};

/** 取用户上下文：publicId + 计划并发上限（Free 1 / Pro 3） */
async function loadUserContext(userId: string): Promise<{ publicId: string; maxConcurrency: number }> {
  const user = await db().user.findUnique({
    where: { id: userId },
    include: { plan: true },
  });
  if (!user) throw err.unauthorized();
  return { publicId: user.publicId, maxConcurrency: user.plan.maxConcurrency };
}
