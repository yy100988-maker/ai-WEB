/**
 * 并发上限（详细设计 §3.2）。
 *
 * 规则：`running_count(user) ≥ plan.maxConcurrency` → 429 TOO_MANY_TASKS。
 * 计数器放 Redis，任务终态时递减；启动时从 DB 重建。
 *
 * 容错取向（详细设计 §3.2 原文）：
 *   「计数器与任务状态机在同一事务外维护，**允许短暂超限 1**（终态事件驱动校准），
 *     宁可多放行不可误拦付费生成。」
 * 因此 claim() 用 INCR 后判断：超限则 DECR 回滚并返回 false，恰好放行到 maxConcurrency。
 * 这个「先加后判、超了再减」的窗口正是"允许短暂超限"的实现方式——并发争抢时
 * 极小概率有 N 个请求同时通过判断，但绝不会出现"余额充足却拦下付费用户"。
 */

import { redis, REDIS_KEYS } from '../../core/redis.js';
import { db } from '../../core/db.js';
import { childLogger } from '../../core/logger.js';
import { TERMINAL_STATUSES, type TaskStatus } from '../../core/types.js';

const log = childLogger({ mod: 'concurrency' });

/**
 * 计数器 TTL 兜底（2h）。
 *
 * 为什么必须有：任务超时上限 30min（TASK_TIMEOUT_MIN），但进程被杀/Redis 抖动/
 * Worker 异常退出都可能漏掉 release。没有 TTL 的话计数器只增不减，
 * 用户会被永久锁死在「并发已满」，且只能等运维手工清 key。
 * 2h > 最长任务时长，正常路径下 key 由 release/rebuild 主动维护，TTL 只是安全网。
 */
const CONCURRENCY_TTL_SEC = 2 * 60 * 60;

export interface ConcurrencyApi {
  /** 原子占位：超过 plan.maxConcurrency 返回 false */
  claim(userId: string, maxConcurrency: number): Promise<boolean>;
  release(userId: string): Promise<void>;
  current(userId: string): Promise<number>;
  /** 启动/校准：从 DB 重建计数器 */
  rebuild(userId: string): Promise<number>;
}

function key(userId: string): string {
  return REDIS_KEYS.userConcurrency(userId);
}

export const concurrency: ConcurrencyApi = {
  /**
   * 占位。INCR 是原子的，所以「读-判-写」不会撕裂：
   *   1. INCR  → n
   *   2. 每次 INCR 后刷新 TTL（防泄漏；EXPIRE 幂等）
   *   3. n > max → DECR 回滚 + 返回 false
   */
  async claim(userId: string, maxConcurrency: number): Promise<boolean> {
    const limit = Number.isFinite(maxConcurrency) && maxConcurrency > 0 ? Math.trunc(maxConcurrency) : 1;
    const k = key(userId);

    const n = await redis().incr(k);
    await redis().expire(k, CONCURRENCY_TTL_SEC);

    if (n > limit) {
      const after = await redis().decr(k);
      // DECR 后可能落到 0 以下（release 与 claim 交叉），归零避免负数残留
      if (after < 0) await redis().set(k, '0', 'EX', CONCURRENCY_TTL_SEC);
      log.info({ userId, limit, current: after }, 'concurrency limit reached');
      return false;
    }
    return true;
  },

  /**
   * 释放一个占位。用 Lua 保证「>0 才减」的原子性，避免把计数减成负数
   * （重复 release、或 release 与 rebuild 竞争时都可能发生）。
   */
  async release(userId: string): Promise<void> {
    const k = key(userId);
    const script = `
      local v = tonumber(redis.call('GET', KEYS[1]) or '0')
      if v > 0 then
        return redis.call('DECR', KEYS[1])
      end
      return 0
    `;
    try {
      await redis().eval(script, 1, k);
    } catch (e) {
      // 释放失败不能阻塞终态处理（用户已经拿到结果/退款）；靠 TTL + rebuild 兜底
      log.warn({ err: e, userId }, 'concurrency release failed (fallback: TTL + rebuild)');
    }
  },

  /** 当前计数（负数归零） */
  async current(userId: string): Promise<number> {
    const raw = await redis().get(key(userId));
    const n = raw === null ? 0 : Number.parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
  },

  /**
   * 从 DB 重建计数器：`COUNT(tasks WHERE user_id=$1 AND status IN ('queued','running'))`。
   * 用于进程启动校准，以及 Redis flush 后的恢复（混沌预案 §7.6）。
   */
  async rebuild(userId: string): Promise<number> {
    const active: TaskStatus[] = ['queued', 'running'];
    const n = await db().task.count({
      where: { userId, status: { in: active } },
    });
    await redis().set(key(userId), String(n), 'EX', CONCURRENCY_TTL_SEC);
    log.info({ userId, count: n }, 'concurrency counter rebuilt from db');
    return n;
  },
};

/** 终态判定辅助（worker 用；终态一律 release） */
export function releasesSlot(status: TaskStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}
