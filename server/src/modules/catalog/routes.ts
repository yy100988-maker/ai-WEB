/**
 * 目录路由（PRD §8.2 / 详细设计 §2.3）—— **全部公开**，限流宽松 200/min。
 *
 *   GET /v1/catalog/capabilities         能力列表（无 active 模型的能力自动隐藏）
 *   GET /v1/catalog/models?capability=   可用模型列表
 *   GET /v1/catalog/models/:id           模型详情（params + pricing，驱动 chip 联动与实时报价）
 *   GET /v1/catalog/templates            快速开始模板（前端 app.quick[]）
 *
 * 硬性规则（PRD §8.2）：
 *  - 只返回 `active=true && enabled=true` 的模型；
 *  - `displayName` 取 `models.display_name`，**禁止泄露上游内部代号**；
 *  - 未上架模型不得出现在任何对客位置（包括 capabilities 的过滤依据）。
 */

import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { db } from '../../core/db.js';
import { err } from '../../core/errors.js';
import { ok, type RouteModule } from '../../core/http.js';
import { childLogger } from '../../core/logger.js';
import { CAPABILITIES, isCapability, type Capability } from '../../core/types.js';
import {
  CAPABILITY_META,
  BUILTIN_TEMPLATES,
  type CatalogTemplate,
} from './templates.js';
import {
  capabilityKind,
  deriveParamOptions,
  findInternalCodenameLeaks,
  isSafeDisplayName,
  toCatalogModelRow,
} from './service.js';

const log = childLogger({ mod: 'catalog-routes' });

/** 公开目录接口限流（详细设计 §2.3：200/min，比全局 100/min 宽松） */
const CATALOG_RATE_LIMIT = { max: 200, timeWindow: '1 minute' } as const;

const modelsQuerySchema = z.object({
  capability: z.string().optional(),
});

export const catalogRoutes: RouteModule = async (app: FastifyInstance) => {
  // ---------------------------------------------------------------- capabilities
  /**
   * 能力列表。
   *
   * 过滤规则（详细设计 §2.3）：**无 active 模型的能力不返回** ——
   * `avatar_talk` 本期为空（PRD §14 #11：数字人本期不做），因此自动隐藏，
   * 前端无需硬编码"哪些能力要藏"，上下架只改 DB。
   *
   * 一次聚合查询取出所有可对客能力的集合，避免 10 次 count 查询。
   */
  app.get('/v1/catalog/capabilities', { config: { rateLimit: CATALOG_RATE_LIMIT } }, async (req) => {
    const rows = await db().model.findMany({
      where: { active: true, enabled: true },
      select: { capabilities: true, displayName: true },
    });

    // 展示名不合规的模型不计入能力可见性（否则会出现"能力可见但模型全被过滤"的空列表）
    const available = new Set<string>();
    for (const row of rows) {
      if (!isSafeDisplayName(row.displayName)) {
        log.warn({ displayName: row.displayName }, 'model display_name leaks internal codename, excluded');
        continue;
      }
      for (const c of row.capabilities) available.add(c);
    }

    const data = CAPABILITIES.filter((c) => available.has(c)).map((code) => ({
      code,
      nameI18n: CAPABILITY_META[code].nameI18n,
      icon: CAPABILITY_META[code].icon,
    }));

    return ok(req, data);
  });

  // ---------------------------------------------------------------- models 列表
  app.get('/v1/catalog/models', { config: { rateLimit: CATALOG_RATE_LIMIT } }, async (req) => {
    const q = modelsQuerySchema.parse(req.query);

    if (q.capability !== undefined && !isCapability(q.capability)) {
      throw err.invalidParams({ capability: q.capability, allowed: [...CAPABILITIES] });
    }

    const rows = await db().model.findMany({
      where: {
        active: true,
        enabled: true,
        ...(q.capability ? { capabilities: { has: q.capability } } : {}),
      },
      select: {
        id: true,
        displayName: true,
        paramMapping: true,
        capabilities: true,
        qualityScore: true,
      },
      orderBy: [{ qualityScore: 'desc' }, { displayName: 'asc' }],
    });

    const items = [];
    for (const row of rows) {
      // ⚠️ 运行时兜底：运营若把 display_name 误填成内部代号，宁可不下发也不能泄露（PRD §8.2）
      if (!isSafeDisplayName(row.displayName)) {
        log.warn(
          { modelId: row.id, leaks: findInternalCodenameLeaks(row.displayName) },
          'model excluded from catalog: display_name leaks internal codename',
        );
        continue;
      }
      const mapped = toCatalogModelRow(row);
      if (mapped) items.push(mapped);
    }

    return ok(req, items);
  });

  // ---------------------------------------------------------------- models 详情
  /**
   * 模型详情：驱动 PRD §8.4.1「模型 chip → 参数 chip 动态渲染 → quote 实时价格」。
   *
   * `:id` 接受 **public id / code 二选一**：
   *  - DB 主键是 UUID（不对客），`models.code` 是渠道侧内部 code；
   *  - 前端从列表拿到的一律是 UUID（列表返回 `id: model.id`），但 PRD §8.4 的
   *    请求体示例用的是 code（`"modelId": "gk-video-3"`），所以两种都要认。
   */
  app.get('/v1/catalog/models/:id', { config: { rateLimit: CATALOG_RATE_LIMIT } }, async (req) => {
    const params = z.object({ id: z.string().min(1) }).parse(req.params);

    const model = await db().model.findFirst({
      where: {
        active: true,
        enabled: true,
        OR: [{ id: params.id }, { code: params.id }],
      },
    });

    if (!model) throw err.notFound({ modelId: params.id });

    if (!isSafeDisplayName(model.displayName)) {
      // 上架了但展示名不合规：对客等价于"该模型不可用"，并留告警供运营修正
      log.warn(
        { modelId: model.id, leaks: findInternalCodenameLeaks(model.displayName) },
        'model detail blocked: display_name leaks internal codename',
      );
      throw err.modelUnavailable();
    }

    const capability = (model.capabilities[0] ?? '') as Capability;
    const params_ = deriveParamOptions(model.paramMapping, model.constraints);

    // pricing：只取 active=true 的价目行（详细设计 §2.3 / PRD §8.4）
    const priceRows = await db().priceItem.findMany({
      where: { modelId: model.id, active: true },
      select: { spec: true, credits: true, capability: true },
      orderBy: { credits: 'asc' },
    });

    return ok(req, {
      id: model.id,
      displayName: model.displayName,
      code: model.code, // 内部 code：允许出现在 id/code 字段（PRD §8.2 明确豁免）
      capability,
      capabilityKind: capabilityKind(capability),
      capabilities: model.capabilities,
      params: params_,
      constraints: model.constraints,
      pricing: priceRows.map((p) => ({
        spec: p.spec,
        credits: p.credits,
        capability: p.capability,
      })),
    });
  });

  // ---------------------------------------------------------------- templates
  /**
   * 快速开始模板（前端 `app.quick[]`，PRD §8.2 / §8.8 深链预填）。
   *
   * 本期从**内置常量**返回（`templates.ts`）；`modelId` 会在返回前校验该模型确实上架，
   * 否则剔除该字段 —— 避免前端深链预填一个不可用的模型导致提交 409 MODEL_UNAVAILABLE。
   */
  app.get('/v1/catalog/templates', { config: { rateLimit: CATALOG_RATE_LIMIT } }, async (req) => {
    const activeModels = await db().model.findMany({
      where: { active: true, enabled: true },
      select: { id: true, code: true, displayName: true, capabilities: true },
    });

    const usable = activeModels.filter((m) => isSafeDisplayName(m.displayName));
    const usableIds = new Set(usable.map((m) => m.id));
    const usableCodes = new Set(usable.map((m) => m.code));

    const items: CatalogTemplate[] = BUILTIN_TEMPLATES.map((tpl) => {
      const next: CatalogTemplate = { ...tpl };
      if (next.modelId !== undefined) {
        const okModel = usableIds.has(next.modelId) || usableCodes.has(next.modelId);
        if (!okModel) {
          delete next.modelId; // 模板保留，但没有可用模型时交给 Router 决策
          delete next.params;
        }
      }
      return next;
    });

    return ok(req, items);
  });
};
