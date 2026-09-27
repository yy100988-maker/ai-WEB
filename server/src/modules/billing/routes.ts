/**
 * 计费 / 定价 / admin 路由（详细设计 §2.6、§2.7）。
 *
 *   GET  /v1/plans                     公开
 *   GET  /v1/billing/balance           需认证
 *   GET  /v1/billing/ledger            需认证
 *   GET  /v1/billing/subscription      需认证
 *   GET  /v1/billing/credit-packs      公开
 *   POST /v1/pricing/quote             公开（带 Authorization 时算订阅折扣）
 *   GET  /v1/pricing/skus              公开，Redis 缓存 5min
 *   GET  /v1/pricing/skus/:capability  公开，非法能力 404
 *   GET  /v1/pricing/promotions        公开，只返回当前生效
 *   POST /v1/admin/credits/adjust      内网 + ADMIN_TOKEN
 *   GET  /v1/admin/users               内网 + ADMIN_TOKEN
 *
 * ⚠️ Phase 2 明确**不注册**：/v1/billing/checkout、/v1/billing/portal、
 *    /v1/webhooks/payments/* —— 框架默认 404（详细设计 §2.6）。
 */

import { z } from 'zod';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { db } from '../../core/db.js';
import { err } from '../../core/errors.js';
import { getConfig } from '../../core/config.js';
import { safeEqual } from '../../core/crypto.js';
import { ok, paged, requireUserId, type RouteModule } from '../../core/http.js';
import { redis } from '../../core/redis.js';
import { childLogger } from '../../core/logger.js';
import { CAPABILITIES, isCapability, type Capability } from '../../core/types.js';
import { ledger } from './ledger.js';
import { pricingEngine, normalizeSpec, skuOf } from './engine.js';
import { billingService } from './service.js';
import { authGuard } from '../auth/guard.js';
import { adminKeyFingerprint, recordAdminAudit, verifyAdminToken } from '../admin/routes.js';
import { batchStats, createBatch, redeem, redeemCodeSchema } from './redeem.js';

const log = childLogger({ mod: 'billing-routes' });

/** /v1/pricing/skus 的 Redis 缓存键与 TTL（详细设计 §2.6：价格每日仅 2 变，无需实时） */
const SKUS_CACHE_KEY = 'pricing:skus:v1';
const SKUS_CACHE_TTL_SEC = 300;

// ---------------------------------------------------------------- 校验 schema

const quoteSchema = z.object({
  capability: z.string().min(1),
  modelId: z.string().optional(),
  params: z.record(z.union([z.string(), z.number(), z.boolean(), z.array(z.string())])).default({}),
});

const paginationSchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

const adminAdjustSchema = z.object({
  userId: z.string().uuid(),
  delta: z.number().int().refine((n) => n !== 0, { message: 'delta must be non-zero' }),
  reason: z.string().min(1).max(500),
});

const adminUsersSchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  email: z.string().optional(),
});

// ---------------------------------------------------------------- admin 鉴权

/**
 * Admin 鉴权：`Authorization: Bearer <ADMIN_TOKEN>`，**独立于用户 JWT**（详细设计 §6.4）。
 * 用 safeEqual 常量时间比较，避免通过响应时间逐字节爆破 token。
 * 失败一律 err.unauthorized()（不区分"没带"与"带错"，减少信息泄露）。
 */
async function requireAdmin(req: FastifyRequest): Promise<string> {
  const header = req.headers.authorization;
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) {
    throw err.unauthorized();
  }
  const token = header.slice(7);
  let expected: string;
  try {
    expected = getConfig().ADMIN_TOKEN;
  } catch {
    throw err.unauthorized();
  }
  if (!expected || !safeEqual(token, expected)) {
    log.warn({ ip: req.ip }, 'admin auth failed');
    throw err.unauthorized();
  }
  return token;
}

/** 内网来源限制：非生产环境放开（CI/本地），生产只信私网与反代网段 */
function assertInternal(req: FastifyRequest): void {
  const cfg = getConfig();
  if (cfg.NODE_ENV !== 'production') return;

  const ip = req.ip ?? '';
  const internal =
    ip === '127.0.0.1' ||
    ip === '::1' ||
    ip.startsWith('10.') ||
    ip.startsWith('192.168.') ||
    ip.startsWith('172.16.') ||
    ip.startsWith('172.17.') ||
    ip.startsWith('172.18.') ||
    ip.startsWith('172.19.') ||
    ip.startsWith('172.2') ||
    ip.startsWith('172.30.') ||
    ip.startsWith('172.31.') ||
    ip.startsWith('::ffff:127.') ||
    ip.startsWith('::ffff:10.') ||
    ip.startsWith('::ffff:192.168.');

  if (!internal) {
    log.warn({ ip }, 'admin endpoint accessed from non-internal address');
    throw err.notFound();
  }
}

// ---------------------------------------------------------------- skus 组装

export interface SkuSpec {
  spec: Record<string, unknown>;
  credits: number;
  costUnits: number;
}

export interface SkuModel {
  modelId: string;
  /** ⚠️ 必须取 models.display_name，绝不泄露上游 model code（如 tt-image-2） */
  displayName: string;
  capability: Capability;
  specs: SkuSpec[];
}

function decimalToNumber(d: { toString(): string }): number {
  return Number(d.toString());
}

/**
 * 对外价目表：`model.active=true` 且 `price_item.active=true`。
 * displayName 只取 `models.display_name` —— 上游 code（tt-image-2 等）**绝不外泄**。
 */
async function buildSkus(capability?: Capability): Promise<SkuModel[]> {
  const rows = await db().priceItem.findMany({
    where: {
      active: true,
      model: { active: true, enabled: true },
      ...(capability ? { capability } : {}),
    },
    include: { model: { select: { id: true, displayName: true, code: true } } },
    orderBy: [{ capability: 'asc' }, { credits: 'asc' }],
  });

  const byKey = new Map<string, SkuModel>();

  for (const r of rows) {
    if (!isCapability(r.capability)) continue;
    const key = `${r.modelId}|${r.capability}`;
    let entry = byKey.get(key);
    if (!entry) {
      entry = {
        modelId: r.modelId,
        displayName: r.model.displayName,
        capability: r.capability,
        specs: [],
      };
      byKey.set(key, entry);
    }
    entry.specs.push({
      spec: (r.spec ?? {}) as Record<string, unknown>,
      credits: r.credits,
      costUnits: decimalToNumber(r.costUnits),
    });
  }

  return [...byKey.values()];
}

async function cachedSkus(): Promise<SkuModel[]> {
  try {
    const hit = await redis().get(SKUS_CACHE_KEY);
    if (hit) return JSON.parse(hit) as SkuModel[];
  } catch (e) {
    // Redis 不可用不能导致价目表 500：降级直查 DB
    log.warn({ err: e }, 'skus cache read failed, fallback to db');
  }

  const skus = await buildSkus();

  try {
    await redis().set(SKUS_CACHE_KEY, JSON.stringify(skus), 'EX', SKUS_CACHE_TTL_SEC);
  } catch (e) {
    log.warn({ err: e }, 'skus cache write failed');
  }

  return skus;
}

// ---------------------------------------------------------------- 路由

export const billingRoutes: RouteModule = async (app: FastifyInstance) => {
  // 注册 app.requireAuth（幂等：guard 内部用 app.hasDecorator 判断）
  authGuard(app);

  // ---------------------------------------------------------------- 计划

  app.get('/v1/plans', async (req) => {
    return ok(req, { plans: await billingService.plans() });
  });

  app.get('/v1/billing/credit-packs', async (req) => {
    return ok(req, { packs: billingService.creditPacks() });
  });

  // ---------------------------------------------------------------- 余额 / 流水 / 订阅

  app.get('/v1/billing/balance', { preHandler: [app.requireAuth] }, async (req) => {
    const userId = requireUserId(req);
    return ok(req, await billingService.balance(userId));
  });

  app.get('/v1/billing/ledger', { preHandler: [app.requireAuth] }, async (req) => {
    const userId = requireUserId(req);
    const q = paginationSchema.parse(req.query);
    const page = await billingService.ledgerPage(userId, {
      ...(q.cursor ? { cursor: q.cursor } : {}),
      ...(q.limit ? { limit: q.limit } : {}),
    });
    return paged(req, page.items, page.nextCursor);
  });

  app.get('/v1/billing/subscription', { preHandler: [app.requireAuth] }, async (req) => {
    const userId = requireUserId(req);
    return ok(req, await billingService.subscription(userId));
  });

  // ---------------------------------------------------------------- 报价

  /**
   * 报价（公开；带 Authorization 时算订阅折扣）。
   *
   * 只用可选鉴权：能从 Bearer 解出 userId 就算折扣，解不出按原价报——
   * 前端的 model chip / 参数 chip 在未登录时也要实时显示价格（PRD §8.4.1）。
   */
  app.post('/v1/pricing/quote', async (req) => {
    const body = quoteSchema.parse(req.body ?? {});

    if (!isCapability(body.capability)) {
      throw err.invalidParams({ capability: body.capability, allowed: CAPABILITIES });
    }

    const userId = await optionalUserId(req);

    const quote = await pricingEngine.quote({
      capability: body.capability,
      ...(body.modelId ? { modelId: body.modelId } : {}),
      params: body.params,
      ...(userId ? { userId } : {}),
    });

    // 余额与充足性（未登录不下发，前端此时不显示余额）
    let balance: { credits: number; sufficient: boolean } | null = null;
    if (userId) {
      const credits = await ledger.balance(userId);
      balance = { credits, sufficient: credits >= quote.credits };
    }

    return ok(req, {
      sku: quote.sku,
      modelId: quote.modelId,
      model: quote.displayName,
      capability: quote.capability,
      credits: quote.credits,
      breakdown: quote.breakdown,
      ...(balance ? { balance } : {}),
      estimated: quote.estimated,
    });
  });

  app.get('/v1/pricing/skus', async (req) => {
    return ok(req, { skus: await cachedSkus() });
  });

  app.get('/v1/pricing/skus/:capability', async (req) => {
    const params = z.object({ capability: z.string() }).parse(req.params);
    if (!isCapability(params.capability)) {
      throw err.notFound({ capability: params.capability });
    }
    const all = await cachedSkus();
    return ok(req, { skus: all.filter((s) => s.capability === params.capability) });
  });

  app.get('/v1/pricing/promotions', async (req) => {
    const now = new Date();
    const rows = await db().promotion.findMany({
      where: { active: true, startsAt: { lte: now }, endsAt: { gte: now } },
      orderBy: { endsAt: 'asc' },
    });
    return ok(req, {
      promotions: rows.map((p) => ({
        id: p.id,
        scope: p.scope,
        targetId: p.targetId,
        discount: decimalToNumber(p.discount),
        startsAt: p.startsAt.toISOString(),
        endsAt: p.endsAt.toISOString(),
        nameI18n: p.nameI18n,
      })),
    });
  });

  // ---------------------------------------------------------------- admin

  app.post('/v1/admin/credits/adjust', async (req) => {
    assertInternal(req);
    const adminKey = await requireAdmin(req);
    const body = adminAdjustSchema.parse(req.body ?? {});

    const result = await billingService.adminAdjust({
      userId: body.userId,
      delta: body.delta,
      reason: body.reason,
      adminKey,
    });

    return ok(req, result);
  });

  app.get('/v1/admin/users', async (req) => {
    assertInternal(req);
    await requireAdmin(req);
    const q = adminUsersSchema.parse(req.query);

    const page = await billingService.adminUsers({
      ...(q.cursor ? { cursor: q.cursor } : {}),
      ...(q.limit ? { limit: q.limit } : {}),
      ...(q.email ? { email: q.email } : {}),
    });

    return paged(req, page.items, page.nextCursor);
  });
  // ============================ xiaoye-adoption F3：积分兑换码（R1，方案 §5） ============================

  const redeemBody = z.object({ code: redeemCodeSchema });
  const redeemKeysBody = z.object({
    count: z.number().int().min(1).max(1000),
    credits: z.number().int().min(1).max(1_000_000),
    expiresInDays: z.number().int().min(1).max(3650).optional(),
    note: z.string().max(200).optional(),
  });

  /**
   * 用户兑换：条件更新（redeemed_by IS NULL）是防双花唯一裁决点 → 同事务 grant(type:'promo')。
   * 不存在 → 404（不泄露"格式错 vs 不存在"）；过期/已被兑 → 400（reason 承载语义）。
   */
  app.post('/v1/billing/redeem', { preHandler: [app.requireAuth] }, async (req) => {
    const userId = requireUserId(req);
    const body = redeemBody.parse(req.body);
    const result = await redeem(userId, body.code);
    return ok(req, { credits: result.credits, balanceAfter: result.balanceAfter });
  });

  /** admin 批量生成（明文码仅此响应出现一次；DB 只存 sha256；审计不含明文） */
  app.post('/v1/admin/redeem-keys', async (req) => {
    assertInternal(req);
    await requireAdmin(req);
    const token = verifyAdminToken(req); // 指纹入审计，绝不落明文 token
    const body = redeemKeysBody.parse(req.body);
    const result = await createBatch({
      adminKeyFingerprint: adminKeyFingerprint(token),
      count: body.count,
      credits: body.credits,
      ...(body.expiresInDays !== undefined ? { expiresInDays: body.expiresInDays } : {}),
      ...(body.note !== undefined ? { note: body.note } : {}),
    });
    await recordAdminAudit({
      adminKey: adminKeyFingerprint(token),
      action: 'redeem_keys.create',
      // ⚠️ 审计只记批次元数据，**不含 codes 明文**（明文只进本次 HTTP 响应体）
      target: { batchId: result.batchId },
      payload: { count: body.count, credits: body.credits, note: body.note ?? '' },
    });
    return ok(req, { batchId: result.batchId, codes: result.codes });
  });

  /** admin 批次统计：total / redeemed / pending */
  app.get('/v1/admin/redeem-keys', async (req) => {
    assertInternal(req);
    await requireAdmin(req);
    const q = z.object({ batchId: z.string().min(1).max(64) }).parse(req.query);
    return ok(req, await batchStats(q.batchId));
  });
};

/**
 * 可选鉴权：尝试解析 Bearer 得到 userId，失败返回 null（不抛错）。
 *
 * 不直接依赖 auth 模块的解析函数（那是 A 模块内部实现），
 * 用「查 refresh？不」——这里只做**极轻量**的存在性判断：
 * 若 authGuard 已在 req 上挂了 userId（optionalAuth 装饰器或已认证），直接复用。
 */
async function optionalUserId(req: FastifyRequest): Promise<string | null> {
  const existing = (req as FastifyRequest & { userId?: string }).userId;
  if (typeof existing === 'string' && existing.length > 0) return existing;

  const header = req.headers.authorization;
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return null;

  // 交由 auth 模块解析：它导出 verifyAccessToken 时即可精确取 userId；
  // 未导出（A 模块未就绪）则安静降级为匿名报价（不影响正确性，只是不显示订阅折扣）。
  try {
    const mod = (await import('../auth/guard.js')) as {
      userIdFromToken?: (token: string) => Promise<string | null> | string | null;
    };
    if (typeof mod.userIdFromToken === 'function') {
      const uid = await mod.userIdFromToken(header.slice(7));
      return typeof uid === 'string' && uid.length > 0 ? uid : null;
    }
  } catch {
    /* A 模块未就绪：匿名报价 */
  }
  return null;
}

/** 供主代理注册时使用（避免重复计算 spec 的调用方各自实现一遍） */
export { normalizeSpec, skuOf };

/** 402 辅助：提交前预检余额（前端按钮置灰也依赖 quote.balance.sufficient） */
export function assertSufficient(balance: number, required: number): void {
  if (balance < required) throw err.insufficientCredits(required, balance);
}

export type { FastifyReply };
