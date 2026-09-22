/**
 * 静态路由装配自检（本地，不连 PG/Redis）。
 *
 * 目的：证明 E 模块的**路由真的挂上去了**，而不是"因为 auth 模块缺失走了兜底 401 分支"。
 * 这类静默降级最危险——接口存在、永远 401，编译器不会报错，只有人工点一遍才会发现。
 *
 * 做法：
 *  1. 直接用 `fastify()` 建实例，注册 authGuard（A 模块真实实现）与各 E 路由；
 *  2. 用 `app.printRoutes()` / `onRoute` 事件断言路径**确实注册**；
 *  3. 断言 `requireAuth` / `optionalAuth` 装饰器是 A 模块提供的真实实现
 *     （而不是 E 模块的 401 兜底）。
 */

import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { describe, expect, it } from 'vitest';
import { authGuard } from '../auth/guard.js';
import { adminRoutes } from '../admin/routes.js';
import { assetRoutes } from '../assets/routes.js';
import { catalogRoutes } from '../catalog/routes.js';
import { checkinRoutes } from '../checkin/routes.js';
import { notificationRoutes } from '../notifications/routes.js';
import { promptRoutes } from '../prompts/routes.js';

/** 建立实例并收集注册到的路由（METHOD + URL） */
async function buildTestApp(): Promise<{ app: FastifyInstance; routes: Set<string> }> {
  const app = Fastify({ logger: false });
  const routes = new Set<string>();
  app.addHook('onRoute', (route) => {
    const methods = Array.isArray(route.method) ? route.method : [route.method];
    for (const m of methods) {
      if (m === 'HEAD' || m === 'OPTIONS') continue;
      routes.add(`${m} ${route.url}`);
    }
  });

  // A 模块真实 authGuard（E 模块内部也会幂等调用一次）
  authGuard(app);
  await catalogRoutes(app);
  await assetRoutes(app);
  await checkinRoutes(app);
  await notificationRoutes(app);
  await promptRoutes(app);
  await adminRoutes(app);

  await app.ready();
  return { app, routes };
}

describe('E 模块路由装配自检', () => {
  it('catalog 4 条路由全部注册', async () => {
    const { app, routes } = await buildTestApp();
    for (const r of [
      'GET /v1/catalog/capabilities',
      'GET /v1/catalog/models',
      'GET /v1/catalog/models/:id',
      'GET /v1/catalog/templates',
    ]) {
      expect(routes.has(r), r).toBe(true);
    }
    await app.close();
  });

  it('assets 6 条路由全部注册', async () => {
    const { app, routes } = await buildTestApp();
    for (const r of [
      'POST /v1/assets/upload-url',
      'POST /v1/assets',
      'POST /v1/assets/import-url',
      'GET /v1/assets',
      'GET /v1/assets/:id',
      'DELETE /v1/assets/:id',
    ]) {
      expect(routes.has(r), r).toBe(true);
    }
    await app.close();
  });

  it('checkin 3 条路由全部注册', async () => {
    const { app, routes } = await buildTestApp();
    for (const r of ['POST /v1/checkin', 'GET /v1/checkin/today', 'GET /v1/checkin/history']) {
      expect(routes.has(r), r).toBe(true);
    }
    await app.close();
  });

  it('notifications 4 条路由全部注册', async () => {
    const { app, routes } = await buildTestApp();
    for (const r of [
      'GET /v1/notifications',
      'POST /v1/notifications/:id/read',
      'POST /v1/notifications/read-all',
      'GET /v1/notifications/unread-count',
    ]) {
      expect(routes.has(r), r).toBe(true);
    }
    await app.close();
  });

  it('prompt-library 4 条路由全部注册', async () => {
    const { app, routes } = await buildTestApp();
    for (const r of [
      'GET /v1/prompt-library',
      'POST /v1/prompt-library/:id/view',
      'POST /v1/prompt-library/:id/copy',
      'POST /v1/prompt-library/:id/like',
    ]) {
      expect(routes.has(r), r).toBe(true);
    }
    await app.close();
  });

  it('admin 1 条路由注册，且**不含** B 模块负责的两条（避免重复注册）', async () => {
    const { app, routes } = await buildTestApp();
    expect(routes.has('POST /v1/admin/models/:id/active')).toBe(true);
    // CONTRACT §4：credits/adjust 与 users 归 B 模块，E 模块不得重复实现
    expect(routes.has('POST /v1/admin/credits/adjust')).toBe(false);
    expect(routes.has('GET /v1/admin/users')).toBe(false);
    await app.close();
  });

  it('★ 认证装饰器来自 A 模块真实实现（不是 E 模块的 401 兜底）', async () => {
    const { app } = await buildTestApp();
    expect(app.hasDecorator('requireAuth')).toBe(true);
    expect(app.hasDecorator('optionalAuth')).toBe(true);

    // A 模块的 requireAuth 会走 authenticate（读 DB），因此无 token 时抛 UNAUTHORIZED；
    // 而 E 模块兜底实现抛的是 UNAUTHORIZED + details.reason='auth guard unavailable'。
    // 用 details 区分，确保走到的是真实现。
    const req = { headers: {}, userId: undefined, log: { warn() {}, error() {}, info() {} } } as unknown as Parameters<
      typeof app.requireAuth
    >[0];
    const reply = {} as Parameters<typeof app.requireAuth>[1];

    await expect(app.requireAuth(req, reply)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    await app.requireAuth(req, reply).catch((e: { details?: { reason?: string } }) => {
      expect(e.details?.reason).not.toBe('auth guard unavailable');
    });

    // optionalAuth 对匿名请求不抛（提示词库必须匿名可访问）
    await expect(app.optionalAuth(req, reply)).resolves.toBeUndefined();

    await app.close();
  });

  it('不存在重复路由（Fastify 会因重复注册抛错，能 ready 即证明无冲突）', async () => {
    await expect(buildTestApp()).resolves.toBeDefined();
  });
});
