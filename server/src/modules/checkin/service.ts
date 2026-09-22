/**
 * 签到服务（PRD §8.7 / 详细设计 §1.6 / §2.7）。
 *
 * 四条时区规则（详细设计 §1.6，本文件是唯一落地处）：
 *  1. 服务端取 `UserPreference.timezone`（默认 `Asia/Shanghai`），用该时区算"今天"再写 `date`；
 *  2. 前端展示与后端判定**同源** —— 前端不再自行算日期，一律用 `GET /v1/checkin/today` 的返回；
 *  3. 用户改时区后，若新时区的"今天"恰好已签到 → 返回 **409**（**不补签、不回溯**）；
 *  4. 签到额度过期点 = 该时区**次日 00:00**（写入 `credit_ledger.expires_at`）。
 *
 * 并发双击：同一天两次请求只能一次成功 —— 靠 `daily_checkins(user_id, date)` 唯一键兜底，
 * 捕获 Prisma `P2002` → 409 `ALREADY_CHECKED_IN`。绝不在应用层做"先查后写"。
 *
 * 余额口径：直接 `SUM(delta)` **全量求和，不过滤 expires_at**（详细设计 §2.5 反例），
 * 与 billing 模块的 `ledger.balance()` 完全一致。
 */

import type { Prisma } from '@prisma/client';
import { db, transaction } from '../../core/db.js';
import { err } from '../../core/errors.js';
import { childLogger } from '../../core/logger.js';
import { getConfig } from '../../core/config.js';
import { FALLBACK_TIMEZONE } from '../../core/types.js';
import { localDateOf, localDateToDbDate, dbDateToLocalDate, nextLocalMidnightUtc, normalizeTimezone } from '../time/index.js';

const log = childLogger({ mod: 'checkin' });

/** Prisma 唯一键冲突 */
function isUniqueViolation(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: string }).code === 'P2002';
}

/** 取用户时区（规则 1：默认 Asia/Shanghai；非法/缺失一律回落） */
export async function timezoneOf(userId: string): Promise<string> {
  const pref = await db().userPreference.findUnique({
    where: { userId },
    select: { timezone: true },
  });
  if (!pref?.timezone) return FALLBACK_TIMEZONE;
  return normalizeTimezone(pref.timezone);
}

/**
 * 全量余额（**不过滤 expires_at**）。
 *
 * 为什么自己做而不复用 billing 的 `ledger.balance()`：
 *  - 本模块要求"直接 SUM(delta)"且**不引入对 B 模块的编译期依赖**（并行开发期）；
 *  - 语义与详细设计 §2.5 完全一致：过期由 `expire` 负向流水表达，余额恒等于 SUM(delta)；
 *  - 若按 `expires_at > now()` 过滤，会出现"送 +100 花掉 30 后余额变成 −30"的反例。
 */
export async function balanceOf(
  client: Prisma.TransactionClient | ReturnType<typeof db>,
  userId: string,
): Promise<number> {
  const rows = await client.$queryRaw<Array<{ bal: bigint | number | null }>>`
    SELECT COALESCE(SUM(delta), 0)::bigint AS bal
    FROM credit_ledger
    WHERE user_id = ${userId}::uuid
  `;
  const raw = rows[0]?.bal ?? 0;
  return typeof raw === 'bigint' ? Number(raw) : Number(raw ?? 0);
}

export interface CheckinStatus {
  checkedIn: boolean;
  credits: number;
  /** 权威本地日（规则 2：前端展示必须用这个值，不得自行计算） */
  date: string;
  timezone: string;
  /** 额度过期点（规则 4：该时区次日 00:00 的 UTC 瞬时） */
  expiresAt: string;
}

/**
 * 查询今日签到状态（`GET /v1/checkin/today`）。
 *
 * 详细设计 §2.7 写的是 `{ checked_in, credits }`；这里**额外**返回 `date` 与 `expiresAt`，
 * 因为规则 2 要求"前端展示与后端判定同源"——前端要显示"今天"，就必须拿到后端认定的那个日期，
 * 否则用户跨时区时会看到"本地还是今天、后端说已签"的矛盾。
 */
export async function todayStatus(userId: string, at: Date = new Date()): Promise<CheckinStatus> {
  const cfg = getConfig();
  const timezone = await timezoneOf(userId);
  const localDate = localDateOf(timezone, at);

  const row = await db().dailyCheckin.findUnique({
    where: { userId_date: { userId, date: localDateToDbDate(localDate) } },
    select: { credits: true },
  });

  return {
    checkedIn: row !== null,
    credits: row?.credits ?? cfg.CHECKIN_CREDITS,
    date: localDate,
    timezone,
    expiresAt: nextLocalMidnightUtc(timezone, at).toISOString(),
  };
}

export interface CheckinResult {
  credits: number;
  balance: number;
  date: string;
  timezone: string;
  expiresAt: string;
}

/**
 * 执行签到（`POST /v1/checkin`）。
 *
 * 单事务内四步：
 *  1. 解析用户时区 → 算本地日 `date`（规则 1）；
 *  2. INSERT `daily_checkins`（**唯一键兜底并发**：`P2002` → 409 `ALREADY_CHECKED_IN`）；
 *  3. INSERT `credit_ledger { delta: +5, type: 'grant_checkin',
 *       idempotencyKey: 'checkin:<userId>:<date>', expiresAt: <该时区次日00:00 UTC> }`（规则 4）；
 *  4. upsert `grants`（发放计划：`lastGrantedAt` / `nextGrantAt` 指向次日 00:00）。
 *
 * 返回体必须含 `{ credits, balance }`（详细设计 §2.7 / §13 #3 验收项）。
 *
 * ⚠️ 顺序很关键：**先插 daily_checkins 再插 ledger**。反过来会出现"ledger 写成功但
 * daily_checkins 撞唯一键回滚"的窗口——虽然同事务会一起回滚，
 * 但先插 daily_checkins 能让"并发双击"在**更早的语句**上就分出胜负，减少无效写入。
 */
export async function checkin(userId: string, at: Date = new Date()): Promise<CheckinResult> {
  const cfg = getConfig();
  const credits = cfg.CHECKIN_CREDITS;
  const timezone = await timezoneOf(userId);
  const localDate = localDateOf(timezone, at);
  const dbDate = localDateToDbDate(localDate);

  // 规则 4：签到额度过期点 = 该时区次日 00:00
  const expiresAt = nextLocalMidnightUtc(timezone, at);
  const idempotencyKey = `checkin:${userId}:${localDate}`;

  try {
    const balance = await transaction(async (tx) => {
      // ---- 1. 写签到记录（唯一键是并发双击的唯一裁判）----
      await tx.dailyCheckin.create({
        data: {
          userId,
          date: dbDate,
          credits,
        },
      });

      // ---- 2. 写积分流水（幂等键含本地日，双保险）----
      // 先算 balanceAfter：事务内 SUM，与扣减/发放口径一致
      const before = await balanceOf(tx, userId);
      const balanceAfter = before + credits;

      await tx.creditLedger.create({
        data: {
          userId,
          delta: credits,
          type: 'grant_checkin',
          taskId: null,
          orderId: null,
          balanceAfter,
          idempotencyKey,
          expiresAt, // 规则 4：仅正向批次带 expires_at；负向流水一律 NULL
          note: `daily checkin ${localDate} (${timezone})`,
        },
      });

      // ---- 3. upsert 发放计划（Grant 只承担"发放计划"职责，不参与余额计算）----
      const existingGrant = await tx.grant.findFirst({
        where: { userId, type: 'daily' },
        select: { id: true },
      });
      if (existingGrant) {
        await tx.grant.update({
          where: { id: existingGrant.id },
          data: {
            amount: credits,
            lastGrantedAt: at,
            nextGrantAt: expiresAt,
            expiresAt,
          },
        });
      } else {
        await tx.grant.create({
          data: {
            userId,
            type: 'daily',
            amount: credits,
            lastGrantedAt: at,
            nextGrantAt: expiresAt,
            expiresAt,
          },
        });
      }

      return balanceAfter;
    });

    return {
      credits,
      balance,
      date: localDate,
      timezone,
      expiresAt: expiresAt.toISOString(),
    };
  } catch (e) {
    /**
     * 并发双击 / 当日重复签到 → 唯一键冲突 → 409。
     *
     * ⚠️ 这是**规则 3 的落点**：用户改了时区后若新时区的"今天"已签到，
     * 这里同样撞 `(user_id, date)` 唯一键 → 409，**不补签、不回溯**。
     * 绝不做"如果已签到就返回旧的 credits"这种补偿 —— 那会让"补签"变成隐式行为。
     */
    if (isUniqueViolation(e)) {
      log.info({ userId, localDate, timezone }, 'duplicate checkin rejected');
      throw err.alreadyCheckedIn();
    }
    throw e;
  }
}

export interface CheckinHistoryItem {
  date: string;
  credits: number;
  checkedInAt: string;
}

/** 签到记录（`GET /v1/checkin/history?limit=`，纯记录无 streak —— 详细设计 §2.7） */
export async function history(
  userId: string,
  limit = 30,
): Promise<{ records: CheckinHistoryItem[]; timezone: string; total: number }> {
  const capped = Math.min(Math.max(Math.trunc(limit) || 30, 1), 365);

  const [rows, timezone, total] = await Promise.all([
    db().dailyCheckin.findMany({
      where: { userId },
      orderBy: { date: 'desc' },
      take: capped,
      select: { date: true, credits: true, createdAt: true },
    }),
    timezoneOf(userId),
    db().dailyCheckin.count({ where: { userId } }),
  ]);

  return {
    records: rows.map((r) => ({
      date: dbDateToLocalDate(r.date),
      credits: r.credits,
      checkedInAt: r.createdAt.toISOString(),
    })),
    timezone,
    total,
  };
}

/**
 * 判断某用户在某时区的今天是否已签到（供 SSE / 前端红点复用）。
 * 导出为独立函数，避免路由层拼 SQL。
 */
export async function hasCheckedInToday(userId: string, at: Date = new Date()): Promise<boolean> {
  const timezone = await timezoneOf(userId);
  const localDate = localDateOf(timezone, at);
  const row = await db().dailyCheckin.findUnique({
    where: { userId_date: { userId, date: localDateToDbDate(localDate) } },
    select: { id: true },
  });
  return row !== null;
}

export { localDateOf, nextLocalMidnightUtc };
