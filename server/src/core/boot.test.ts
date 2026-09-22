/**
 * 应用装配冒烟测试（回归护栏）。
 *
 * 为什么需要这个测试：`buildApp()` 的问题是**只有在进程真正启动时才会暴露**的 ——
 * 单测覆盖各业务模块，但没人跑过「Fastify 构造 + 插件注册 + 全部路由挂载」这条路径。
 *
 * 真实踩过的坑（本测试即为防它复发）：
 *  1. `Fastify({ logger: pinoInstance })` → 抛 `FST_ERR_LOG_INVALID_LOGGER_CONFIG`，
 *     容器反复重启。正确写法是 `loggerInstance`。
 *  2. 开发环境默认挂 `pino-pretty` transport，但它是可选依赖；未安装时
 *     构造 pino 直接抛 `unable to determine transport target`，进程起不来。
 */

import { describe, it, expect, afterAll } from 'vitest';
import { buildApp } from '../core/http.js';
import { resetConfig } from '../core/config.js';

// 各模块路由的真实挂载（与 src/main.ts 保持一致）
import { authRoutes } from '../modules/auth/routes.js';
import { billingRoutes } from '../modules/billing/routes.js';
import { catalogRoutes } from '../modules/catalog/routes.js';
import { assetRoutes } from '../modules/assets/routes.js';
import { checkinRoutes } from '../modules/checkin/routes.js';
import { notificationRoutes } from '../modules/notifications/routes.js';
import { promptRoutes } from '../modules/prompts/routes.js';
import { adminRoutes } from '../modules/admin/routes.js';
import { taskRoutes } from '../modules/tasks/routes.js';
import { mockFixtureRoutes } from '../modules/providers/mock.js';

const routes = [
  authRoutes,
  billingRoutes,
  catalogRoutes,
  assetRoutes,
  checkinRoutes,
  notificationRoutes,
  promptRoutes,
  adminRoutes,
  taskRoutes,
  mockFixtureRoutes,
];

const originalEnv = { ...process.env };

afterAll(() => {
  process.env = { ...originalEnv };
  resetConfig();
});

describe('buildApp 装配冒烟', () => {
  it('能在注入全部路由后成功构造并响应 /v1/health', async () => {
    // 强制走 production 分支（不挂 pino-pretty），验证最常部署的路径
    process.env['NODE_ENV'] = 'production';
    process.env['LOG_LEVEL'] = 'silent';
    process.env['DATABASE_URL'] ??= 'postgresql://vutu:vutu@127.0.0.1:5433/vutu?schema=public';
    process.env['REDIS_URL'] ??= 'redis://127.0.0.1:6380';
    process.env['JWT_SECRET'] ??= 'test-secret-at-least-32-bytes-long-xxxxx';
    process.env['ADMIN_TOKEN'] ??= 'test-admin-token';
    process.env['MOCK_PROVIDER'] = 'true';
    resetConfig();

    const app = await buildApp({ routes, disableRateLimit: true });
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/v1/health' });
    expect(res.statusCode).toBe(200);

    const body = JSON.parse(res.body) as { ok: boolean; data: { status: string; mockProvider: boolean } };
    expect(body.ok).toBe(true);
    expect(body.data.status).toBe('ok');
    expect(body.data.mockProvider).toBe(true);

    await app.close();
  });

  it('开发环境缺少 pino-pretty 时也不得启动失败（可选依赖必须可缺）', async () => {
    process.env['NODE_ENV'] = 'development';
    resetConfig();

    const app = await buildApp({ routes: [], disableRateLimit: true });
    await app.ready();
    const res = await app.inject({ method: 'GET', url: '/v1/health' });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it('/v1/health 与 /health 均可用（容器 healthcheck 走前者）', async () => {
    process.env['NODE_ENV'] = 'production';
    resetConfig();

    const app = await buildApp({ routes, disableRateLimit: true });
    await app.ready();

    const v1 = await app.inject({ method: 'GET', url: '/v1/health' });
    const bare = await app.inject({ method: 'GET', url: '/health' });
    expect(v1.statusCode).toBe(200);
    expect(bare.statusCode).toBe(200);

    await app.close();
  });

  it('应用只注册 /v1/* —— /api 前缀由 nginx 剥离（不在应用内改写 URL）', async () => {
    process.env['NODE_ENV'] = 'production';
    resetConfig();

    const app = await buildApp({ routes, disableRateLimit: true });
    await app.ready();

    // Fastify 5 在路由查找**之后**才执行生命周期 hook，因此无法在应用内把
    // /api/v1/* 改写成 /v1/*（改 req.raw.url 已太晚，只会 404）。
    // 正确做法是在 nginx 层 `rewrite ^/api/(.*)$ /$1 break;`（见 deploy/nginx-*.conf）。
    // 本测试固定这一约定：应用侧**不应**有 /api 路由，避免两套前缀语义分叉。
    const proxied = await app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(proxied.statusCode).toBe(404);

    await app.close();
  });

  it('未注册的 Phase 2 路由返回 404（checkout / portal / 支付回调 / 渠道回调）', async () => {
    process.env['NODE_ENV'] = 'production';
    resetConfig();

    const app = await buildApp({ routes, disableRateLimit: true });
    await app.ready();

    const postponed = [
      { method: 'POST' as const, url: '/v1/billing/checkout' },
      { method: 'POST' as const, url: '/v1/billing/portal' },
      { method: 'POST' as const, url: '/v1/webhooks/payments/stripe' },
      { method: 'POST' as const, url: '/v1/webhooks/channels/lk888' },
    ];

    for (const r of postponed) {
      const res = await app.inject({ method: r.method, url: r.url, payload: {} });
      expect(res.statusCode, `${r.url} 不应被注册（Phase 2 预留）`).toBe(404);
    }

    await app.close();
  });

  it('统一错误结构：404 也是 { ok:false, error:{code}, requestId }', async () => {
    process.env['NODE_ENV'] = 'production';
    resetConfig();

    const app = await buildApp({ routes, disableRateLimit: true });
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/v1/definitely-not-a-route' });
    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.body) as { ok: boolean; error: { code: string }; requestId: string };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.requestId).toMatch(/^req_/);

    await app.close();
  });

  it('错误消息按 Accept-Language 本地化（PRD §9 i18n）', async () => {
    process.env['NODE_ENV'] = 'production';
    resetConfig();

    const app = await buildApp({ routes, disableRateLimit: true });
    await app.ready();

    const zh = await app.inject({
      method: 'GET',
      url: '/v1/definitely-not-a-route',
      headers: { 'accept-language': 'zh-CN,zh;q=0.9' },
    });
    const ja = await app.inject({
      method: 'GET',
      url: '/v1/definitely-not-a-route',
      headers: { 'accept-language': 'ja' },
    });

    expect(JSON.parse(zh.body).error.message).toBe('资源不存在');
    expect(JSON.parse(ja.body).error.message).toBe('見つかりません');

    await app.close();
  });
});
