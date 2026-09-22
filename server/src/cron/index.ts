/**
 * 定时任务（详细设计 §5，node-cron + Redis SET NX leader 锁保证单实例执行）。
 *
 * | 任务         | 频率                  | 逻辑 |
 * | 价格同步     | 每日 02:00 / 14:00    | 拉上游 pricing → 按三口径重算 → price_items + price_sync_log；涨超 20% 自动下线 |
 * | 额度重置     | 每日 00:05            | Pro 月度重置 + 签到额度清零 + signup 7 天过期扫描 |
 * | 账本对账     | 每日 03:00            | 逐用户 SUM(delta) 对比 balance_after，差异 P0 告警 |
 * | 超时扫描     | 每 5min               | running 超 30min → timeout → refund（兜底轮询器漏网） |
 * | 平台余额监控 | 每小时                | GET /v1/skills/balance；低于阈值 P0 告警 |
 * | 产物清理     | 每日 04:00            | 超保留期软删 + S3 删除 |
 * | 通知清理     | 每周                  | 已读超 90 天硬删 |
 */

import cron, { type ScheduledTask } from 'node-cron';
import { db } from '../core/db.js';
import { childLogger } from '../core/logger.js';
import { acquireCronLock, redis } from '../core/redis.js';
import { getConfig } from '../core/config.js';
import { refundTaskTerminal } from '../workers/settle.js';
import { resetDailyQuotas, reconcileLedger } from '../modules/billing/jobs.js';
import { syncPrices } from '../modules/billing/price-sync.js';
import { checkPlatformBalance } from '../modules/billing/platform-balance.js';
import { deleteObject } from '../core/storage.js';

const log = childLogger({ mod: 'cron' });

const tasks: ScheduledTask[] = [];

/** 抢到 leader 锁才执行（多实例部署时只跑一份） */
function guarded<T>(name: string, ttlSec: number, fn: () => Promise<T>): () => Promise<void> {
  return async () => {
    const acquired = await acquireCronLock(name, ttlSec).catch(() => false);
    if (!acquired) {
      log.debug({ job: name }, 'cron lock not acquired, skipped');
      return;
    }
    const started = Date.now();
    try {
      await fn();
      log.info({ job: name, ms: Date.now() - started }, 'cron job done');
    } catch (e) {
      log.error({ err: e, job: name }, 'cron job failed');
    }
  };
}

export function startCron(): { stop: () => void } {
  const tz = 'Asia/Shanghai'; // 价格同步按 UTC+8（PRD §6.9）

  // 价格同步：每日 02:00 与 14:00
  tasks.push(
    cron.schedule('0 2,14 * * *', guarded('price-sync', 1800, syncPrices), { timezone: tz }),
  );

  // 额度重置：每日 00:05
  tasks.push(
    cron.schedule('5 0 * * *', guarded('quota-reset', 900, async () => {
      const r = await resetDailyQuotas();
      log.info(r, 'quota reset summary');
    }), { timezone: tz }),
  );

  // 账本对账：每日 03:00
  tasks.push(
    cron.schedule('0 3 * * *', guarded('ledger-reconcile', 1800, async () => {
      const r = await reconcileLedger();
      if (r.mismatches.length > 0) {
        log.error({ mismatches: r.mismatches.slice(0, 20) }, 'P0: ledger reconciliation mismatch');
      }
    }), { timezone: tz }),
  );

  // 超时扫描：每 5 分钟
  tasks.push(
    cron.schedule('*/5 * * * *', guarded('timeout-scan', 240, scanTimeouts), { timezone: tz }),
  );

  // 平台余额监控：每小时
  tasks.push(
    cron.schedule('0 * * * *', guarded('platform-balance', 300, async () => {
      await checkPlatformBalance();
    }), { timezone: tz }),
  );

  // 产物清理：每日 04:00
  tasks.push(
    cron.schedule('0 4 * * *', guarded('retention-cleanup', 1800, cleanupExpiredAssets), { timezone: tz }),
  );

  // 通知清理：每周一 05:00
  tasks.push(
    cron.schedule('0 5 * * 1', guarded('notification-cleanup', 900, cleanupNotifications), { timezone: tz }),
  );

  log.info({ count: tasks.length }, 'cron scheduled');
  return {
    stop: () => {
      for (const t of tasks) t.stop();
      tasks.length = 0;
    },
  };
}

/**
 * 超时扫描（详细设计 §5）：running 超 30min → timeout → refund。
 * 兜底轮询器漏网的任务（如 poll job 丢失）。
 */
export async function scanTimeouts(now: Date = new Date()): Promise<number> {
  const cfg = getConfig();
  const deadline = new Date(now.getTime() - cfg.TASK_TIMEOUT_MIN * 60_000);

  const stale = await db().task.findMany({
    where: {
      status: 'running',
      OR: [
        { startedAt: { lt: deadline } },
        { startedAt: null, createdAt: { lt: deadline } },
      ],
    },
    select: { id: true, publicId: true },
    take: 200,
  });

  for (const t of stale) {
    await refundTaskTerminal({
      taskId: t.id,
      taskPublicId: t.publicId,
      toStatus: 'timeout',
      error: { code: 'TASK_TIMEOUT', message: 'generation timed out', retryable: true },
      message: 'timeout scan',
    });
  }

  return stale.length;
}

/**
 * 产物清理（PRD §9 隐私合规）：Free 30 天 / Pro 90 天。
 * 软删除资产 + 删除 S3 对象，保留审计元数据。
 */
export async function cleanupExpiredAssets(now: Date = new Date()): Promise<number> {
  const cfg = getConfig();

  const plans = await db().plan.findMany({ select: { id: true, code: true } });
  const proPlanId = plans.find((p) => p.code === 'pro')?.id;

  const freeCutoff = new Date(now.getTime() - cfg.RETENTION_FREE_DAYS * 86_400_000);
  const proCutoff = new Date(now.getTime() - cfg.RETENTION_PRO_DAYS * 86_400_000);

  const expired = await db().asset.findMany({
    where: {
      deletedAt: null,
      kind: 'output',
      OR: [
        { createdAt: { lt: freeCutoff }, user: { planId: { not: proPlanId ?? '' } } },
        { createdAt: { lt: proCutoff } },
      ],
    },
    select: { id: true, storageKey: true },
    take: 500,
  });

  for (const a of expired) {
    await deleteObject(a.storageKey).catch((e: unknown) =>
      log.warn({ err: e, storageKey: a.storageKey }, 'delete object failed'),
    );
    await db().asset.update({ where: { id: a.id }, data: { deletedAt: now } });
  }

  return expired.length;
}

/** 通知清理：已读超 90 天的通知硬删 */
export async function cleanupNotifications(now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - 90 * 86_400_000);
  const res = await db().userNotification.deleteMany({
    where: { readAt: { not: null, lt: cutoff } },
  });
  return res.count;
}

/** 幂等键缓存清理：防止 Redis 无限增长（可选维护任务） */
export async function trimEphemeralKeys(): Promise<void> {
  // 仅清理已知前缀的临时键；正式幂等靠 DB 唯一键，不依赖 Redis
  const keys = await redis().keys('loginfail:*');
  if (keys.length > 0) await redis().del(...keys);
}
