/**
 * 任务服务（详细设计 §2.5 提交链路，PRD §4.1 核心流程）。
 *
 * POST /v1/tasks 服务端处理顺序（单事务 + 行锁，P95 < 3s 含审核）：
 *  1. 鉴权 → 2. validate 参数 → 3. Moderation L1+L2（违规 422，不建任务不扣费）
 *  → 4. Router.pick → 5. quote（读表） → 6. deduct 原子扣减（余额不足 402）
 *  → 7. 落库 task(queued)+task_event → 8. BullMQ 入队 → 9. 返回 201
 *
 * 幂等重放：(userId, idempotencyKey) 命中 → 直接返回原 task，不重复扣费。
 */

import type { Task, Model, Channel } from '@prisma/client';
import { db, transaction } from '../../core/db.js';
import { err } from '../../core/errors.js';
import { newPublicId } from '../../core/ids.js';
import { isCapability, type Capability, type TaskStatus } from '../../core/types.js';
import { ledger } from '../billing/ledger.js';
import { pricingEngine } from '../billing/engine.js';
import { concurrency } from '../billing/concurrency.js';
import { router } from '../router/index.js';
import { moderation } from '../moderation/index.js';
import { validateRequest } from '../providers/validate.js';
import { loadModelDescriptor } from '../providers/registry.js';
import { enqueueGeneration } from './queue.js';
import { publishTaskEvent, cacheTaskState } from './events.js';
import { cancellable } from './state-machine.js';
import { notifyTaskFailed } from '../notifications/service.js';

export interface CreateTaskInput {
  userId: string;
  userPublicId: string;
  planMaxConcurrency: number;
  capability: string;
  modelId?: string;
  prompt: string;
  negativePrompt?: string;
  inputAssetIds: string[];
  params: Record<string, string | number | boolean | string[]>;
  idempotencyKey: string;
  /** 仅非生产环境：Mock 失败注入透传（X-Mock-Fail） */
  mockFail?: string;
}

export interface CreateTaskResult {
  taskId: string;
  taskPublicId: string;
  status: TaskStatus;
  progress: number;
  capability: Capability;
  modelId: string;
  modelDisplayName: string;
  quotedCredits: number;
  remainingCredits: number;
  createdAt: Date;
  estimatedSec: number;
  idempotentReplay: boolean;
}

type TaskWithModel = Task & { model?: Model | null; channel?: Channel | null };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 把入参里的资产标识统一解析为**内部 UUID**。
 *
 * 契约：前端传对客 `publicId`（`ast_...`，见 PRD §8.3 与 AppHomePage 的 `^ast_` 判断）；
 * 但脚本/内部调用可能直接传 UUID。两种都接受：
 *  - UUID 形态：原样使用；
 *  - 其他（视为 publicId）：按 (publicId, userId, 未删除) 查表换成 id。
 *
 * 查不到的保留原值——交给调用方的 ownership 校验统一报 400，
 * 而不是在这里抛 500（getErrors 语义更清晰）。
 */
async function resolveAssetIds(ids: string[], userId: string): Promise<string[]> {
  if (ids.length === 0) return [];

  const publicIds = ids.filter((id) => !UUID_RE.test(id));
  const byPublic = new Map<string, string>();
  if (publicIds.length > 0) {
    const rows = await db().asset.findMany({
      where: { publicId: { in: publicIds }, userId, deletedAt: null },
      select: { id: true, publicId: true },
    });
    for (const r of rows) byPublic.set(r.publicId, r.id);
  }

  // 逐个映射并保持入参顺序；未命中的保留原值 → 上层 ownership 校验报 400
  return ids.map((id) => (UUID_RE.test(id) ? id : (byPublic.get(id) ?? id)));
}

function serializeTaskListRow(t: TaskWithModel, modelDisplayName: string) {
  return {
    id: t.publicId,
    status: t.status,
    progress: t.progress,
    capability: t.capability,
    model: { id: t.modelId, displayName: modelDisplayName },
    quotedCredits: t.quotedCredits,
    settledCredits: t.settledCredits,
    refunded: t.refunded,
    resultAssetIds: t.resultAssetIds,
    error: t.error,
    createdAt: t.createdAt.toISOString(),
    finishedAt: t.finishedAt?.toISOString() ?? null,
  };
}

export const taskService = {
  /** 提交生成任务 */
  async create(input: CreateTaskInput): Promise<CreateTaskResult> {
    if (!isCapability(input.capability)) {
      throw err.invalidParams({ capability: input.capability });
    }

    // ---- 幂等重放：命中 (userId, idempotencyKey) 直接返回原任务，不重复扣费 ----
    const existing = await db().task.findUnique({
      where: { userId_idempotencyKey: { userId: input.userId, idempotencyKey: input.idempotencyKey } },
    });
    if (existing) {
      const balance = await ledger.balance(input.userId);
      const model = await db().model.findUnique({ where: { id: existing.modelId } });
      return {
        taskId: existing.id,
        taskPublicId: existing.publicId,
        status: existing.status as TaskStatus,
        progress: existing.progress,
        capability: existing.capability as Capability,
        modelId: existing.modelId,
        modelDisplayName: model?.displayName ?? '',
        quotedCredits: existing.quotedCredits,
        remainingCredits: balance,
        createdAt: existing.createdAt,
        estimatedSec: 0,
        idempotentReplay: true,
      };
    }

    // ---- 3. Prompt 前置审核（违规 422，不建任务、不扣费、无 ledger 流水）----
    const verdict = await moderation.check({
      prompt: input.prompt,
      negativePrompt: input.negativePrompt,
      userId: input.userId,
    });
    if (!verdict.pass) {
      throw err.contentRejected(verdict.layer, verdict.categories);
    }

    // ---- 4. Router.pick（显式模型校验可用性；不可用 409 + alternatives）----
    const picked = await router.pick({
      capability: input.capability,
      requestedModelId: input.modelId,
      userId: input.userId,
      params: input.params,
    });

    // ---- 参数约束校验（提交前拦截非法组合，400）----
    const descriptor = await loadModelDescriptor(picked.modelId);
    const validation = validateRequest(
      {
        taskId: 'pending',
        capability: input.capability,
        prompt: input.prompt,
        negativePrompt: input.negativePrompt,
        inputs: [],
        params: input.params,
        idempotencyKey: input.idempotencyKey,
        modelCode: picked.modelCode,
        channelCode: picked.channelCode,
      },
      descriptor,
    );
    if (!validation.valid) {
      throw err.invalidParams({ errors: validation.errors ?? [] });
    }

    // ---- 输入资产校验：必须属于本人且未删除 ----
    //
    // ⚠️ 前端契约传的是**对客 public_id**（`ast_...`），而 `assets.id` 是 UUID 主键。
    // 直接把 `ast_xxx` 塞进 `where.id` 会让 PG 在类型转换阶段报错（Prisma P2023
    // "invalid character: found `s` at 2"），表现为提交图生图任务 500。
    // 因此这里先把 public_id 批量解析成 UUID；已传 UUID 的调用方（脚本/内部）原样兼容。
    const resolvedAssetIds = await resolveAssetIds(input.inputAssetIds, input.userId);
    if (input.inputAssetIds.length > 0) {
      const owned = await db().asset.findMany({
        where: { id: { in: resolvedAssetIds }, userId: input.userId, deletedAt: null },
        select: { id: true },
      });
      if (owned.length !== resolvedAssetIds.length) {
        throw err.invalidParams({ inputAssetIds: 'asset not found or not owned' });
      }
    }

    // ---- 5. quote（读 price_items；含订阅折扣）----
    const quote = await pricingEngine.quote({
      capability: input.capability,
      modelId: picked.modelId,
      params: input.params,
      userId: input.userId,
    });

    // ---- 并发上限（提交时强制，§3.2）----
    const claimed = await concurrency.claim(input.userId, input.planMaxConcurrency);
    if (!claimed) {
      throw err.tooManyTasks(input.planMaxConcurrency);
    }

    const taskId = crypto.randomUUID();
    const taskPublicId = newPublicId('task');

    try {
      // ---- 6+7. 原子扣减 + 落库（同一事务，行锁串行化，杜绝超卖）----
      const { remainingCredits } = await transaction(async (tx) => {
        const deductRes = await ledger.deduct({
          userId: input.userId,
          credits: quote.credits,
          taskId,
          idempotencyKey: `deduct:${taskPublicId}`,
          tx,
        });

        // Mock 失败注入：仅非生产环境透传（X-Mock-Fail → params.__mockFail）。
        // 注意 params 只能出现一次 —— 重复 key 会让后者覆盖前者，注入静默失效。
        const storedParams: Record<string, string | number | boolean | string[]> = input.mockFail
          ? { ...input.params, __mockFail: input.mockFail }
          : input.params;

        await tx.task.create({
          data: {
            id: taskId,
            publicId: taskPublicId,
            userId: input.userId,
            capability: input.capability,
            modelId: picked.modelId,
            channelId: picked.channelId,
            status: 'queued',
            progress: 0,
            prompt: input.prompt,
            negativePrompt: input.negativePrompt ?? null,
            params: storedParams,
            inputAssetIds: resolvedAssetIds,
            priceSnapshot: {
              capability: input.capability,
              model: picked.modelCode,
              modelId: picked.modelId,
              displayName: picked.displayName,
              spec: quote.sku,
              credits: quote.credits,
              costUnits: quote.breakdown.costUnits,
              quotedAt: new Date().toISOString(),
            },
            quotedCredits: quote.credits,
            deductedCredits: quote.credits,
            settledCredits: 0,
            idempotencyKey: input.idempotencyKey,
            priority: 0,
          },
        });

        await tx.taskEvent.create({
          data: {
            taskId,
            fromStatus: null,
            toStatus: 'queued',
            progress: 0,
            message: 'task created',
            payload: { quotedCredits: quote.credits },
          },
        });

        return { remainingCredits: deductRes.balanceAfter };
      });

      // ---- 8. 入队 ----
      await enqueueGeneration(
        { taskId, taskPublicId, userId: input.userId },
        input.idempotencyKey,
      );

      const estimatedSec = estimateSeconds(picked.modelCode);

      await publishTaskEvent({
        taskPublicId,
        status: 'queued',
        progress: 0,
      });
      await cacheTaskState({ taskPublicId, status: 'queued', progress: 0 });

      return {
        taskId,
        taskPublicId,
        status: 'queued',
        progress: 0,
        capability: input.capability,
        modelId: picked.modelId,
        modelDisplayName: picked.displayName,
        quotedCredits: quote.credits,
        remainingCredits,
        createdAt: new Date(),
        estimatedSec,
        idempotentReplay: false,
      };
    } catch (e) {
      // 提交失败必须释放并发占位，否则用户被永久卡住
      await concurrency.release(input.userId).catch(() => undefined);

      // 幂等键并发冲突：说明另一请求已建同键任务，返回既有任务
      if (isUniqueViolation(e)) {
        const dup = await db().task.findUnique({
          where: { userId_idempotencyKey: { userId: input.userId, idempotencyKey: input.idempotencyKey } },
        });
        if (dup) {
          const balance = await ledger.balance(input.userId);
          const model = await db().model.findUnique({ where: { id: dup.modelId } });
          return {
            taskId: dup.id,
            taskPublicId: dup.publicId,
            status: dup.status as TaskStatus,
            progress: dup.progress,
            capability: dup.capability as Capability,
            modelId: dup.modelId,
            modelDisplayName: model?.displayName ?? '',
            quotedCredits: dup.quotedCredits,
            remainingCredits: balance,
            createdAt: dup.createdAt,
            estimatedSec: 0,
            idempotentReplay: true,
          };
        }
      }
      throw e;
    }
  },

  /** 任务详情（轮询降级方案） */
  async get(userId: string, taskPublicId: string) {
    const task = await db().task.findFirst({
      where: { publicId: taskPublicId, userId },
      include: { model: true },
    });
    if (!task) throw err.notFound();

    const results = task.resultAssetIds.length
      ? await db().asset.findMany({ where: { id: { in: task.resultAssetIds }, deletedAt: null } })
      : [];

    return {
      id: task.publicId,
      status: task.status,
      progress: task.progress,
      capability: task.capability,
      model: { id: task.modelId, displayName: task.model?.displayName ?? '' },
      params: task.params,
      inputAssetIds: task.inputAssetIds,
      quotedCredits: task.quotedCredits,
      settledCredits: task.settledCredits,
      refunded: task.refunded,
      error: task.error,
      results: results.map((a) => ({
        assetId: a.publicId,
        mimeType: a.mimeType,
        width: a.width,
        height: a.height,
        durationSec: a.durationSec,
        sizeBytes: Number(a.sizeBytes),
      })),
      createdAt: task.createdAt.toISOString(),
      startedAt: task.startedAt?.toISOString() ?? null,
      finishedAt: task.finishedAt?.toISOString() ?? null,
    };
  },

  /** 创作记录列表（驱动前端 Filter 全部/视频/图片/音频） */
  async list(input: {
    userId: string;
    capability?: string;
    status?: string;
    type?: string;
    cursor?: string;
    limit?: number;
  }) {
    const limit = Math.min(Math.max(input.limit ?? 20, 1), 100);

    const where: Record<string, unknown> = { userId: input.userId };
    if (input.capability) where.capability = input.capability;
    if (input.status) where.status = input.status;
    if (input.type) {
      const { KIND_TO_CAPABILITIES } = await import('../../core/types.js');
      const caps = KIND_TO_CAPABILITIES[input.type];
      if (caps) where.capability = { in: caps };
    }

    const cursor = decodeCursor(input.cursor);
    const rows = await db().task.findMany({
      where: {
        ...where,
        ...(cursor
          ? {
              OR: [
                { createdAt: { lt: cursor.createdAt } },
                { createdAt: cursor.createdAt, id: { lt: cursor.id } },
              ],
            }
          : {}),
      },
      include: { model: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];

    return {
      items: page.map((t) => serializeTaskListRow(t, t.model?.displayName ?? '')),
      nextCursor: hasMore && last ? encodeCursor(last.createdAt, last.id) : null,
    };
  },

  /**
   * 取消（仅 queued/running 有效）。
   * PRD §8.4：**上游不支持 cancel 时也本地置 cancelled 并全额返还**，避免用户被卡住。
   */
  async cancel(userId: string, taskPublicId: string): Promise<{ status: TaskStatus; refundedCredits: number }> {
    const task = await db().task.findFirst({ where: { publicId: taskPublicId, userId } });
    if (!task) throw err.notFound();
    if (!cancellable(task.status)) throw err.taskFinal();

    const { refundTaskTerminal } = await import('../../workers/settle.js');
    const result = await refundTaskTerminal({
      taskId: task.id,
      taskPublicId: task.publicId,
      toStatus: 'cancelled',
    });

    return { status: 'cancelled', refundedCredits: result.refundedCredits };
  },

  /**
   * 失败任务重试 = 新 task（新幂等键）+ 重新走提交链路，原 task 不动。
   * 返回新任务的创建结果；余额不足会抛 402，由调用方提示用户。
   */
  async retry(
    userId: string,
    userPublicId: string,
    planMaxConcurrency: number,
    taskPublicId: string,
    idempotencyKey: string,
  ): Promise<CreateTaskResult> {
    const task = await db().task.findFirst({ where: { publicId: taskPublicId, userId } });
    if (!task) throw err.notFound();
    if (task.status === 'succeeded' || task.status === 'running' || task.status === 'queued') {
      throw err.invalidParams({ status: task.status, reason: 'only failed/cancelled/timeout tasks can be retried' });
    }

    const params = task.params as Record<string, string | number | boolean | string[]>;

    return taskService.create({
      userId,
      userPublicId,
      planMaxConcurrency,
      capability: task.capability,
      modelId: task.modelId,
      prompt: task.prompt,
      negativePrompt: task.negativePrompt ?? undefined,
      inputAssetIds: task.inputAssetIds,
      params,
      idempotencyKey,
    });
  },
};

/** 按模型历史耗时给出前端预估（PRD §6.3 能力矩阵出片耗时） */
const ESTIMATED_SEC: Record<string, number> = {
  'gk-video-3': 80,
  'gk-video-3.5': 85,
  'hailuo-h3': 480,
  'hailuo-h3-quannengcankao': 700,
  'omni-1.1': 120,
  'omni-flash': 120,
  'seedance-2.0-guanfang': 300,
  'seedance-2.5-guanfang': 330,
  'happyhorse-i2v': 100,
  'wan3.0-video': 600,
  'tt-image-2': 20,
  'tt-image-2.5': 25,
};

export function estimateSeconds(modelCode: string): number {
  return ESTIMATED_SEC[modelCode] ?? 120;
}

function isUniqueViolation(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: string }).code === 'P2002';
}

// ---------------------------------------------------------------- 游标分页

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

export { notifyTaskFailed };
