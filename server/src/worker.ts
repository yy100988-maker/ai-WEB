/**
 * Worker 进程入口（常驻，BullMQ 消费者，不暴露端口）。
 */

import 'dotenv/config';
import { loadConfig } from './core/config.js';
import { logger } from './core/logger.js';
import { db, disconnectDb } from './core/db.js';
import { redis } from './core/redis.js';
import { startWorkers } from './workers/index.js';
import { startCron } from './cron/index.js';

async function main(): Promise<void> {
  const cfg = loadConfig();
  const log = logger();

  await db().$queryRaw`SELECT 1`;
  await redis().ping();

  const workers = startWorkers();
  // 定时任务同样由 worker 承担（leader 锁保证单实例执行）
  const cron = startCron();

  const shutdown = async (signal: string) => {
    log.info({ signal }, 'shutting down worker');
    cron.stop();
    await Promise.all(workers.map((w) => w.close().catch(() => undefined)));
    await disconnectDb().catch(() => undefined);
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  log.info({ mockProvider: cfg.MOCK_PROVIDER, env: cfg.NODE_ENV }, 'vutu worker started');
}

main().catch((e: unknown) => {
  logger().fatal({ err: e }, 'worker failed to start');
  process.exit(1);
});
