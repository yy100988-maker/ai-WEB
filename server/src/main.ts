/**
 * API 进程入口（详细设计 §8：单镜像两入口 api / worker）。
 */

import 'dotenv/config';
import { loadConfig } from './core/config.js';
import { logger } from './core/logger.js';
import { buildApp, type RouteModule } from './core/http.js';
import { redis } from './core/redis.js';
import { db, disconnectDb } from './core/db.js';
import { startCron } from './cron/index.js';

// 业务路由模块
import { authRoutes } from './modules/auth/routes.js';
import { billingRoutes } from './modules/billing/routes.js';
import { catalogRoutes } from './modules/catalog/routes.js';
import { assetRoutes } from './modules/assets/routes.js';
import { checkinRoutes } from './modules/checkin/routes.js';
import { notificationRoutes } from './modules/notifications/routes.js';
import { promptRoutes } from './modules/prompts/routes.js';
import { adminRoutes } from './modules/admin/routes.js';
import { taskRoutes } from './modules/tasks/routes.js';
import { mockFixtureRoutes } from './modules/providers/mock.js';

const routes: RouteModule[] = [
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

async function main(): Promise<void> {
  const cfg = loadConfig();
  const log = logger();

  // 启动即校验依赖（PG/Redis），避免"起来了但不可用"
  await db().$queryRaw`SELECT 1`;
  await redis().ping();

  const app = await buildApp({ routes });

  // 定时任务（node-cron + Redis leader 锁）
  const cron = startCron();

  const shutdown = async (signal: string) => {
    log.info({ signal }, 'shutting down api');
    cron.stop();
    await app.close().catch(() => undefined);
    await disconnectDb().catch(() => undefined);
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  await app.listen({ port: cfg.PORT, host: cfg.HOST });
  log.info(
    { port: cfg.PORT, mockProvider: cfg.MOCK_PROVIDER, env: cfg.NODE_ENV },
    'vutu api listening',
  );
}

main().catch((e: unknown) => {
  logger().fatal({ err: e }, 'api failed to start');
  process.exit(1);
});
