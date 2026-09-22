/**
 * 集成/E2E 测试基建。
 *
 * 策略：**不依赖 Testcontainers**（Windows 本地 Docker 管道受限，且服务器已有 Docker）。
 * 改为读取 `TEST_DATABASE_URL` / `TEST_REDIS_URL` 环境变量；
 * 若未设置则回落到与本地 compose 一致的默认值。
 *
 * 每个测试文件开始前：truncate 所有业务表 + flush Redis 测试库。
 */

import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import { execSync } from 'node:child_process';

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgresql://vutu:vutu@127.0.0.1:5433/vutu?schema=public';

export const TEST_REDIS_URL = process.env.TEST_REDIS_URL ?? process.env.REDIS_URL ?? 'redis://127.0.0.1:6380';

let prisma: PrismaClient | null = null;
let redisClient: Redis | null = null;

export function testDb(): PrismaClient {
  if (!prisma) {
    prisma = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });
  }
  return prisma;
}

export function testRedis(): Redis {
  if (!redisClient) {
    redisClient = new Redis(TEST_REDIS_URL, { maxRetriesPerRequest: null });
  }
  return redisClient;
}

/**
 * 清空**业务数据**表，但**保留 seed 管理的参考数据**（计划/渠道/模型/价格/路由策略/
 * 提示词库 tab）。原因：这些是测试夹具（fixtures），由 `prisma/seed.ts` 一次性灌入；
 * 如果每轮测试都 TRUNCATE 掉，所有依赖 plan/model 的用例都会因"找不到 free 计划"而失败，
 * 而反复重跑 seed 既慢又会与外键顺序纠缠。
 *
 * 被清空的表（按依赖倒序删除，避免外键约束）：
 *   task_events/task_costs/tasks、credit_ledger、daily_checkins、daily_balance_reset、
 *   grants、assets、refresh_tokens、oauth_accounts、user_notifications、user_preferences、
 *   user_profiles、users、orders、webhook_events、price_sync_log、
 *   model_pricing_snapshots、prompt_post_events、prompt_posts、user_coupons、admin_audit_logs、
 *   moderation_logs、remix_*
 */
const PRESERVE_TABLES = new Set([
  '_prisma_migrations',
  'plans',
  'channels',
  'channel_api_keys',
  'models',
  'price_items',
  'routing_policies',
  'prompt_tabs',
  // ⚠️ prompt_posts 也是 seed 夹具：2026-09 联调时发现 truncate 会把线上提示词库清空，
  // 导致公网 /api/v1/prompt-library 返回空 cards。依赖相对断言（+1）而非绝对计数的
  // 用例不受影响；需要隔离 posts 的用例请自建 tabCode 隔离，不要全表清空。
  'prompt_posts',
  'promotions',
]);

export async function truncateAll(): Promise<void> {
  const db = testDb();
  const rows = await db.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename NOT LIKE '_prisma%'
  `;
  const targets = rows.map((r) => r.tablename).filter((t) => !PRESERVE_TABLES.has(t));
  if (targets.length === 0) return;

  // 用 CASCADE 处理外键，一次性清空；RESTART IDENTITY 让序列从 1 开始（可读性）
  const list = targets.map((t) => `"public"."${t}"`).join(', ');
  await db.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

/** 清空**全部**表（含参考数据）；调用方需自行重新 seed */
export async function truncateEverything(): Promise<void> {
  const db = testDb();
  const rows = await db.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename NOT LIKE '_prisma%'
  `;
  if (rows.length === 0) return;
  const list = rows.map((r) => `"public"."${r.tablename}"`).join(', ');
  await db.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

/** 断言参考数据已就绪，给出可操作的报错（而不是让用例零散地失败） */
export async function assertFixturesSeeded(): Promise<void> {
  const db = testDb();
  const plans = await db.plan.count();
  const models = await db.model.count();
  if (plans === 0 || models === 0) {
    throw new Error(
      '参考数据缺失：请在测试库执行 `npx prisma migrate deploy && npx tsx prisma/seed.ts` ' +
        `(plans=${plans}, models=${models})`,
    );
  }
}

export async function flushTestRedis(): Promise<void> {
  await testRedis().flushdb();
}

export async function closeTestConnections(): Promise<void> {
  if (prisma) {
    await prisma.$disconnect();
    prisma = null;
  }
  if (redisClient) {
    redisClient.disconnect();
    redisClient = null;
  }
}

/** 确保数据库 schema 是最新的（本地开发用 migrate dev 生成的迁移） */
export function ensureSchema(): void {
  execSync('npx prisma migrate deploy', {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
  });
}

/** 探测测试依赖是否可用，不可用则 skip（避免 CI 外误报红） */
export async function canConnect(): Promise<{ db: boolean; redis: boolean }> {
  let dbOk = false;
  let redisOk = false;
  try {
    await testDb().$queryRaw`SELECT 1`;
    dbOk = true;
  } catch {
    dbOk = false;
  }
  try {
    await testRedis().ping();
    redisOk = true;
  } catch {
    redisOk = false;
  }
  return { db: dbOk, redis: redisOk };
}
