/**
 * Fastify 应用装配（M0 骨架 + 全模块路由注册）。
 *
 * 关键约定：
 * - 所有响应统一 { ok, data|error, requestId }（详细设计 §2.1）
 * - 路由模块一律实现 RouteModule 接口，在 registerRoutes 中挂载
 * - requestId 由 onRequest 生成并透传 Worker/上游
 */

import Fastify from 'fastify';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import { ZodError } from 'zod';
import { AppError, messageFor } from './errors.js';
import { getConfig } from './config.js';
import { loggerOptions } from './logger.js';
import { newRequestId } from './ids.js';
import { parseAcceptLanguage, type Locale } from './types.js';
import { redis } from './redis.js';

declare module 'fastify' {
  interface FastifyRequest {
    requestId: string;
    locale: Locale;
  }
}

export type RouteModule = (app: FastifyInstance) => Promise<void> | void;

/** userId（users.id）形态：UUID。用于限流分桶时校验 sub 的可信度 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 从 Bearer token 里取出 userId（JWT payload 的 sub），**不验签**。
 *
 * 用途仅限限流分桶，不参与任何授权判断 —— 攻击者伪造 sub 只能改变自己所在的桶，
 * 无法提权；海量伪造 token 的洪泛由 keyGenerator 的 IP 分支兜住。
 *
 * 为什么不能取 token 前 20 字符（auth.slice(7,27)）：那是 JWT 的**固定 header**，
 * 所有用户相同（HS256 下恒为 eyJhbGciOiJIUzI1NiIs）→ 全体共用一个限流桶。
 *
 * 额外做 UUID 形态校验：非 UUID 的 sub 一律按「无法分桶」处理，退回 IP 维度，
 * 避免攻击者用任意字符串无限造桶。
 */
export function extractSub(token: string): string | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const payload = parts[1];
  if (!payload) return null;
  try {
    const obj = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { sub?: unknown };
    return typeof obj.sub === 'string' && UUID_RE.test(obj.sub) ? obj.sub : null;
  } catch {
    return null;
  }
}

/** 统一成功响应 */
export function ok<T>(req: FastifyRequest, data: T, extra?: Record<string, unknown>) {
  return { ok: true as const, data, requestId: req.requestId, ...(extra ?? {}) };
}

/** 统一分页响应 */
export function paged<T>(req: FastifyRequest, items: T[], nextCursor: string | null) {
  return ok(req, { items, nextCursor });
}

export interface BuildAppOptions {
  /** 只注册指定前缀的路由模块（测试用） */
  routes?: RouteModule[];
  disableRateLimit?: boolean;
}

export async function buildApp(opts: BuildAppOptions = {}): Promise<FastifyInstance> {
  const cfg = getConfig();

  const app = Fastify({
    // Fastify 的 `logger` 只接受**配置对象**（传已构造的 pino 实例会抛
    // FST_ERR_LOG_INVALID_LOGGER_CONFIG；用 `loggerInstance` 传实例又会把
    // Fastify 的 Logger 泛型推断成具体 pino Logger，与 FastifyInstance 默认的
    // FastifyBaseLogger 冲突，route 注册处报 TS2345）。
    // 因此这里传**同一份 pino 配置**，由 Fastify 自行构造；应用侧日志走
    // core/logger.ts 的 logger()，两边配置同源（见 buildLoggerOptions()）。
    logger: loggerOptions(),
    // ⚠️ 必须是具体跳数而非 `true`。
    // nginx 原用 $proxy_add_x_forwarded_for（**追加**客户端自带的 XFF），
    // 配合 trustProxy:true 会让 Fastify 取最左值 = 攻击者可控 → req.ip 可伪造，
    // 直接击穿全局限流 / 注册 IP 限流，并污染审计日志。
    // 配套已把 nginx 改为覆写（proxy_set_header X-Forwarded-For $remote_addr），
    // 此处只信任紧邻一跳。
    // 用「信任跳数」字符串形式（等价于只信任紧邻一跳）
    trustProxy: '1', // 仅信 Caddy/nginx 这一跳反代（详细设计 §6.4）
    // 生产环境不打印每请求日志（由 access log / 指标承接）。
    // 注：`logController` 在此 Fastify 版本要求实现完整接口（10+ 方法），
    // 而顶层 `disableRequestLogging` 在 fastify@6 才移除 —— 当前锁 fastify@5，
    // 等升级到 6 时再改用 logController。
    disableRequestLogging: cfg.NODE_ENV === 'production',
    bodyLimit: 1024 * 1024, // JSON 请求体 1MB（文件走对象存储直传）
    genReqId: () => newRequestId(),
  });

  // ---------------- 基础插件 ----------------
  await app.register(helmet, {
    contentSecurityPolicy: false, // API 服务，无 HTML
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  });

  await app.register(cors, {
    origin: true, // 同域部署（nginx /api 反代）；跨域调试期放开
    credentials: true,
    exposedHeaders: ['X-Request-Id', 'Retry-After'],
  });

  await app.register(cookie);

  if (!opts.disableRateLimit) {
    await app.register(rateLimit, {
      global: true,
      max: 100,
      timeWindow: '1 minute',
      redis: redis(),
      keyGenerator: (req) => {
        // ⚠️ 旧实现取 token 前 20 字符（auth.slice(7,27)），但 JWT 第一段是
        // **固定 header**（HS256 下恒为 eyJhbGciOiJIUzI1NiIs），与用户无关 →
        // 全体登录用户共用同一个桶，实测两个不同用户的键完全相同。
        // 现改为「IP 兜底 + userId 分桶」双维度：
        //   - 有可解析的 sub → 按用户分桶（真正的用户维度）
        //   - 否则（未登录 / token 畸形 / 伪造）→ 退回 IP，保证洪泛仍被限住
        const auth = req.headers.authorization;
        const sub = auth?.startsWith('Bearer ') ? extractSub(auth.slice(7)) : null;
        return sub ? `u:${sub}` : `ip:${req.ip}`;
      },
      errorResponseBuilder: (req, context) => {
        const locale = parseAcceptLanguage(req.headers['accept-language']);
        return {
          ok: false,
          error: {
            code: 'RATE_LIMITED',
            message: messageFor('RATE_LIMITED', locale),
            details: { retryAfter: Math.ceil(context.ttl / 1000) },
          },
          requestId: (req as FastifyRequest).requestId,
        };
      },
    });
  }

  // ---------------- 请求上下文 ----------------
  app.addHook('onRequest', async (req) => {
    req.requestId = (req.id as string) || newRequestId();
    req.locale = parseAcceptLanguage(req.headers['accept-language']);
  });

  app.addHook('onSend', async (req, reply, payload) => {
    reply.header('X-Request-Id', req.requestId);
    return payload;
  });

  // ---------------- 错误处理 ----------------
  app.setNotFoundHandler((req, reply) => {
    const locale = req.locale ?? parseAcceptLanguage(req.headers['accept-language']);
    reply.status(404).send({
      ok: false,
      error: { code: 'NOT_FOUND', message: messageFor('NOT_FOUND', locale) },
      requestId: req.requestId ?? newRequestId(),
    });
  });

  app.setErrorHandler((error, req, reply) => {
    const locale = req.locale ?? parseAcceptLanguage(req.headers['accept-language']);

    if (error instanceof AppError) {
      if (error.status >= 500) {
        req.log.error({ err: error, code: error.code }, 'app error');
      }
      return reply.status(error.status).send(error.toBody(locale, req.requestId));
    }

    if (error instanceof ZodError) {
      const details = {
        issues: error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      };
      return reply.status(400).send({
        ok: false,
        error: {
          code: 'INVALID_PARAMS',
          message: messageFor('INVALID_PARAMS', locale),
          details,
        },
        requestId: req.requestId,
      });
    }

    // JSON 解析失败 / 请求体过大
    const status = (error as { statusCode?: number }).statusCode ?? 500;
    if (status === 413) {
      return reply.status(413).send({
        ok: false,
        error: { code: 'PAYLOAD_TOO_LARGE', message: messageFor('PAYLOAD_TOO_LARGE', locale) },
        requestId: req.requestId,
      });
    }
    if (status === 429) {
      return reply.status(429).send({
        ok: false,
        error: { code: 'RATE_LIMITED', message: messageFor('RATE_LIMITED', locale) },
        requestId: req.requestId,
      });
    }

    req.log.error({ err: error }, 'unhandled error');
    // 非生产环境把原始错误信息带回响应，便于排查（生产只返回通用文案，避免信息泄露）
    const debugDetail =
      cfg.NODE_ENV !== 'production' && error instanceof Error
        ? { reason: error.message, name: error.name }
        : undefined;
    return reply.status(500).send({
      ok: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: messageFor('INTERNAL_ERROR', locale),
        ...(debugDetail ? { details: debugDetail } : {}),
      },
      requestId: req.requestId,
    });
  });

  // ---------------- 健康检查（容器 healthcheck 用，无鉴权） ----------------
  app.get('/v1/health', async () => ({
    ok: true,
    data: { status: 'ok', uptime: Math.round(process.uptime()), mockProvider: cfg.MOCK_PROVIDER },
    requestId: newRequestId(),
  }));

  app.get('/health', async () => ({ status: 'ok' }));

  // ---------------- 业务路由（由 main.ts 传入，避免核心层依赖业务层） ----------------
  for (const route of opts.routes ?? []) {
    await route(app);
  }

  return app;
}

/** 便捷：断言已认证用户，未认证抛 401 */
export function requireUserId(req: FastifyRequest): string {
  const userId = (req as FastifyRequest & { userId?: string }).userId;
  if (!userId) throw new AppError('UNAUTHORIZED');
  return userId;
}

export type { FastifyInstance, FastifyReply, FastifyRequest };
