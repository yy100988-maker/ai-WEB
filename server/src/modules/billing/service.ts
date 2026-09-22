/**
 * 计费服务（详细设计 §2.6 展示类接口 + §2.7 最小 admin 接口）。
 *
 * 纯编排层：余额/账本/计划/订阅/积分包/管理员调整。
 * 所有余额变动都委托给 ledger（唯一写入者），本文件绝不直接写 credit_ledger。
 */

import { db } from '../../core/db.js';
import { err } from '../../core/errors.js';
import { childLogger } from '../../core/logger.js';
import { sha256 } from '../../core/crypto.js';
import { CREDIT_PACKS } from '../../core/pricing-math.js';
import type { Page } from '../../core/types.js';
import { ledger, adminAdjustKey } from './ledger.js';

const log = childLogger({ mod: 'billing-service' });

/** expiringSoon 提醒窗口（小时），与详细设计 §2.6 的"未来 24h"一致 */
const EXPIRING_SOON_HOURS = 24;

export interface BalanceView {
  credits: number;
  expiringSoon: number;
}

export interface LedgerEntryView {
  id: string;
  delta: number;
  type: string;
  balanceAfter: number;
  taskId: string | null;
  orderId: string | null;
  expiresAt: string | null;
  note: string | null;
  createdAt: string;
}

export interface PlanView {
  code: string;
  nameI18n: unknown;
  listPriceUsd: number;
  monthlyCredits: number;
  maxConcurrency: number;
  checkinCredits: number;
  planDiscount: number | null;
  features: unknown;
}

export interface SubscriptionView {
  plan: string;
  planName: string;
  status: string;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  monthlyCredits: number;
  maxConcurrency: number;
  planDiscount: number | null;
  /** 无有效订阅（Free）时为 true，前端据此展示 upgrade 按钮 */
  isFree: boolean;
}

export interface CreditPackView {
  code: string;
  priceUsdCents: number;
  priceUsd: number;
  credits: number;
}

export interface AdminAdjustInput {
  userId: string;
  delta: number;
  reason: string;
  adminKey: string;
}

export interface AdminAdjustResult {
  userId: string;
  delta: number;
  balanceAfter: number;
  ledgerId: string;
}

function decimalToNumberOrNull(d: { toString(): string } | null): number | null {
  return d === null ? null : Number(d.toString());
}

export const billingService = {
  /** 余额（详细设计 §2.6）：credits = SUM(delta) 全量；expiringSoon 仅供前端提醒 */
  async balance(userId: string): Promise<BalanceView> {
    const [credits, expiringSoon] = await Promise.all([
      ledger.balance(userId),
      ledger.expiringSoon(userId, EXPIRING_SOON_HOURS),
    ]);
    return { credits, expiringSoon };
  },

  /**
   * 积分流水（游标分页，倒序 createdAt DESC, id DESC）。
   * cursor = base64url(`{createdAt ISO}|{id}`)（CONTRACT §2 统一分页约定）。
   */
  async ledgerPage(
    userId: string,
    opts: { cursor?: string; limit?: number } = {},
  ): Promise<Page<LedgerEntryView>> {
    const limit = Math.min(Math.max(opts.limit ?? 20, 1), 100);
    const cursor = decodeCursor(opts.cursor);

    const rows = await db().creditLedger.findMany({
      where: {
        userId,
        ...(cursor
          ? {
              OR: [
                { createdAt: { lt: cursor.createdAt } },
                { createdAt: cursor.createdAt, id: { lt: cursor.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];

    return {
      items: page.map((r) => ({
        id: r.id,
        delta: r.delta,
        type: r.type,
        balanceAfter: r.balanceAfter,
        taskId: r.taskId,
        orderId: r.orderId,
        expiresAt: r.expiresAt?.toISOString() ?? null,
        note: r.note,
        createdAt: r.createdAt.toISOString(),
      })),
      nextCursor: hasMore && last ? encodeCursor(last.createdAt, last.id) : null,
    };
  },

  /** 所有 active 计划（PRD §6.6） */
  async plans(): Promise<PlanView[]> {
    const plans = await db().plan.findMany({
      where: { active: true },
      orderBy: [{ listPriceUsd: 'asc' }],
    });
    return plans.map((p) => ({
      code: p.code,
      nameI18n: p.nameI18n,
      listPriceUsd: p.listPriceUsd,
      monthlyCredits: p.monthlyCredits,
      maxConcurrency: p.maxConcurrency,
      checkinCredits: p.checkinCredits,
      planDiscount: decimalToNumberOrNull(p.planDiscount),
      features: p.features,
    }));
  },

  /**
   * 当前订阅（PRD §6.6，驱动侧栏 planName + upgrade 显隐）。
   * 无 active 订阅 → 返回 free 计划信息（不是 404，前端直接渲染）。
   */
  async subscription(userId: string): Promise<SubscriptionView> {
    const now = new Date();
    const sub = await db().subscription.findFirst({
      where: { userId, status: 'active', currentPeriodEnd: { gt: now } },
      include: { plan: true },
      orderBy: { currentPeriodStart: 'desc' },
    });

    if (sub?.plan) {
      return {
        plan: sub.plan.code,
        planName: pickPlanName(sub.plan.nameI18n),
        status: sub.status,
        currentPeriodStart: sub.currentPeriodStart.toISOString(),
        currentPeriodEnd: sub.currentPeriodEnd.toISOString(),
        cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
        monthlyCredits: sub.plan.monthlyCredits,
        maxConcurrency: sub.plan.maxConcurrency,
        planDiscount: decimalToNumberOrNull(sub.plan.planDiscount),
        isFree: false,
      };
    }

    // 无订阅 → Free 计划（缺失时给安全默认值，绝不让接口 500）
    const free = await db().plan.findUnique({ where: { code: 'free' } });
    return {
      plan: 'free',
      planName: free ? pickPlanName(free.nameI18n) : 'Free',
      status: 'active',
      currentPeriodStart: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      monthlyCredits: free?.monthlyCredits ?? 0,
      maxConcurrency: free?.maxConcurrency ?? 1,
      planDiscount: null,
      isFree: true,
    };
  },

  /** 积分包列表（PRD §6.7，纯展示；购买走运营手动） */
  creditPacks(): CreditPackView[] {
    return CREDIT_PACKS.map((p) => ({
      code: p.code,
      priceUsdCents: p.priceUsdCents,
      priceUsd: Math.round(p.priceUsdCents) / 100,
      credits: p.credits,
    }));
  },

  /**
   * Admin 手动调整积分（详细设计 §2.7）。
   *
   * 约束：**不允许扣成负数**。delta < 0 且 balance + delta < 0 时抛 400 INVALID_PARAMS，
   * 理由：负余额在 append-only 账本里无法自愈（后续签到/充值会先填坑，用户会以为钱丢了），
   * 运营真要清零请用「精确等于余额」的负数，或走业务补偿流程。
   *
   * 审计：写 admin_audit_logs，admin_key 只存 sha256 前 12 位（不落 ADMIN_TOKEN 明文）。
   */
  async adminAdjust(input: AdminAdjustInput): Promise<AdminAdjustResult> {
    const { userId, delta, reason, adminKey } = input;

    if (!Number.isInteger(delta) || delta === 0) {
      throw err.invalidParams({ delta, reason: 'delta must be a non-zero integer' });
    }
    if (!reason || reason.trim().length === 0) {
      throw err.invalidParams({ reason: 'reason is required' });
    }

    const user = await db().user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) throw err.notFound({ userId });

    const current = await ledger.balance(userId);
    if (delta < 0 && current + delta < 0) {
      throw err.invalidParams({ balance: current, delta, reason: 'adjustment would make balance negative' });
    }

    const idempotencyKey = adminAdjustKey();
    const type = delta > 0 ? 'admin_adjust' : 'admin_adjust';

    const res = await ledger.grant({
      userId,
      type,
      amount: delta,
      idempotencyKey,
      expiresAt: null,
      note: reason,
    });

    // 审计日志：只存 adminKey 摘要，永不落明文
    await db().adminAuditLog.create({
      data: {
        id: crypto.randomUUID(),
        adminKey: sha256(adminKey).slice(0, 12),
        action: 'credits.adjust',
        target: { userId },
        payload: { delta, reason, balanceAfter: res.balanceAfter },
      },
    });

    log.info({ userId, delta, balanceAfter: res.balanceAfter }, 'admin credit adjustment applied');

    return { userId, delta: delta, balanceAfter: res.balanceAfter, ledgerId: idempotencyKey };
  },

  /**
   * Admin 用户列表（运营发放入口数据源，详细设计 §2.7）。
   * 只暴露运营需要的字段，绝不返回 password_hash / oauth token。
   */
  async adminUsers(opts: { cursor?: string; limit?: number; email?: string } = {}): Promise<
    Page<{ id: string; publicId: string; email: string | null; phone: string | null; plan: string; status: string; credits: number; createdAt: string }>
  > {
    const limit = Math.min(Math.max(opts.limit ?? 20, 1), 100);
    const cursor = decodeCursor(opts.cursor);

    const rows = await db().user.findMany({
      where: {
        ...(opts.email ? { email: { contains: opts.email, mode: 'insensitive' as const } } : {}),
        ...(cursor
          ? {
              OR: [
                { createdAt: { lt: cursor.createdAt } },
                { createdAt: cursor.createdAt, id: { lt: cursor.id } },
              ],
            }
          : {}),
      },
      include: { plan: { select: { code: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];

    // 余额逐用户聚合（admin 列表量小，且必须准确；不做缓存以免展示陈旧余额）
    const balances = await Promise.all(page.map((u) => ledger.balance(u.id)));

    return {
      items: page.map((u, i) => ({
        id: u.id,
        publicId: u.publicId,
        email: u.email,
        phone: u.phone,
        plan: u.plan.code,
        status: u.status,
        credits: balances[i] ?? 0,
        createdAt: u.createdAt.toISOString(),
      })),
      nextCursor: hasMore && last ? encodeCursor(last.createdAt, last.id) : null,
    };
  },
};

/** 计划多语言名：优先 zh-CN，回落 en，再回落任意键 */
function pickPlanName(nameI18n: unknown): string {
  if (typeof nameI18n === 'string') return nameI18n;
  if (nameI18n && typeof nameI18n === 'object') {
    const obj = nameI18n as Record<string, unknown>;
    for (const k of ['zh-CN', 'en']) {
      const v = obj[k];
      if (typeof v === 'string' && v.length > 0) return v;
    }
    const first = Object.values(obj).find((v): v is string => typeof v === 'string' && v.length > 0);
    if (first) return first;
  }
  return 'Free';
}

// ---------------------------------------------------------------- 游标分页（base64url `{createdAt ISO}|{id}`）

export function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(`${createdAt.toISOString()}|${id}`, 'utf8').toString('base64url');
}

export function decodeCursor(cursor?: string): { createdAt: Date; id: string } | null {
  if (!cursor) return null;
  try {
    const raw = Buffer.from(cursor, 'base64url').toString('utf8');
    const idx = raw.lastIndexOf('|');
    if (idx <= 0) return null;
    const createdAt = new Date(raw.slice(0, idx));
    const id = raw.slice(idx + 1);
    if (Number.isNaN(createdAt.getTime()) || !id) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}
