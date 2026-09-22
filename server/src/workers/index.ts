/**
 * Worker 消费者（详细设计 §3.1 队列拓扑 / §3.3 轮询器）。
 *
 * generation 队列：
 *   解析输入 → 置换为 4h 交付 URL → provider.submit() → status=running
 *   → 调度 poll delayed job（15s）
 * poll 队列：
 *   provider.poll() → 更新 progress/externalStatus
 *   → is_final ? 终态处理 : 再调度 delayed 15s
 *
 * 关键：**重试 submit 前必须重新签发交付 URL**（旧 URL 可能已过期，PRD §8.3 / §13 #22）。
 */

import { Worker, type Job } from 'bullmq';
import { db, transaction } from '../core/db.js';
import { childLogger } from '../core/logger.js';
import { getConfig } from '../core/config.js';
import { err } from '../core/errors.js';
import type { AssetRef, Capability, PollResult } from '../core/types.js';
import { presignDelivery } from '../core/storage.js';
import { getProvider, loadModelDescriptor, getChannelCreds } from '../modules/providers/registry.js';
import { circuitBreaker } from '../modules/router/breaker.js';
import {
  QUEUE_NAMES,
  enqueuePoll,
  enqueueTransfer,
  enqueueNotify,
  workerConnection,
  type GenerationJobData,
  type PollJobData,
  type TransferJobData,
  type NotifyJobData,
} from '../modules/tasks/queue.js';
import { transition } from '../modules/tasks/state-machine.js';
import { publishTaskEvent, cacheTaskState } from '../modules/tasks/events.js';
import { refundTaskTerminal, settleSuccess } from './settle.js';
import { transferAll, type TransferOutput } from './transfer.js';
import type { TaskStatus } from '../core/types.js';

const log = childLogger({ mod: 'worker' });

/**
 * 把任务的输入资产置换为**交付 URL**（4h 预签名 GET）。
 *
 * 为什么必须独立于浏览 URL：视频任务平均出片 2~14 分钟 + 排队重试，
 * 15min 的浏览 URL 必然过期 → 供应商下载失败 → 任务失败但平台已预扣费。
 * 每次 submit（含重试）都要重新签发。
 */
async function buildInputs(taskId: string, assetIds: string[]): Promise<AssetRef[]> {
  if (assetIds.length === 0) return [];

  const assets = await db().asset.findMany({
    where: { id: { in: assetIds }, deletedAt: null },
  });

  const refs: AssetRef[] = [];
  for (const a of assets) {
    const deliveryUrl = await presignDelivery(a.storageKey);
    refs.push({
      assetId: a.publicId,
      publicId: a.publicId,
      mimeType: a.mimeType,
      deliveryUrl,
      sizeBytes: Number(a.sizeBytes),
    });
  }

  if (refs.length !== assetIds.length) {
    log.warn({ taskId, expected: assetIds.length, got: refs.length }, 'some input assets missing');
  }
  return refs;
}

// ---------------------------------------------------------------- generation

export async function processGeneration(job: Job<GenerationJobData>): Promise<void> {
  const { taskId, taskPublicId } = job.data;
  const cfg = getConfig();

  const task = await db().task.findUnique({ where: { id: taskId } });
  if (!task) {
    log.warn({ taskId }, 'generation: task not found');
    return;
  }
  if (task.status !== 'queued') {
    log.info({ taskId, status: task.status }, 'generation: task not queued, skipped');
    return;
  }

  // queued → running（条件更新，避免与 cancel 竞争）
  const moved = await transaction(async (tx) =>
    transition(tx, { taskId, from: 'queued', to: 'running', progress: 1, message: 'submitted to provider' }),
  );
  if (!moved) {
    log.info({ taskId }, 'generation: lost race to another writer, skipped');
    return;
  }

  await publishTaskEvent({ taskPublicId, status: 'running', progress: 1 });
  await cacheTaskState({ taskPublicId, status: 'running', progress: 1 });

  try {
    const model = await loadModelDescriptor(task.modelId);
    const provider = getProvider(model.channelCode);
    const creds = await getChannelCreds(task.channelId);
    const inputs = await buildInputs(taskId, task.inputAssetIds);

    const params = task.params as Record<string, string | number | boolean | string[]>;

    const submitResult = await provider.submit(
      {
        taskId,
        capability: task.capability as Capability,
        prompt: task.prompt,
        negativePrompt: task.negativePrompt ?? undefined,
        inputs,
        params,
        idempotencyKey: task.idempotencyKey,
        modelCode: model.code,
        channelCode: model.channelCode,
      },
      model,
      creds,
    );

    await db().task.update({
      where: { id: taskId },
      data: {
        externalJobId: submitResult.externalJobId,
        externalStatus: (submitResult.raw ?? {}) as object,
        attempts: { increment: 1 },
      },
    });

    await circuitBreaker.recordSuccess(model.code).catch(() => undefined);

    // 调度首次轮询
    await enqueuePoll(
      { taskId, taskPublicId, externalJobId: submitResult.externalJobId, attempt: 0 },
      cfg.POLL_INTERVAL_SEC * 1000,
    );
  } catch (e) {
    const mapped = mapProviderError(e);
    await circuitBreaker.recordFailure(
      (await loadModelDescriptorSafe(task.modelId))?.code ?? 'unknown',
    ).catch(() => undefined);

    log.error({ err: e, taskId, code: mapped.code }, 'generation submit failed');

    // 提交阶段失败：直接终态 + 全额返还
    await refundTaskTerminal({
      taskId,
      taskPublicId,
      toStatus: 'failed',
      error: { code: mapped.code, message: mapped.userMessage, retryable: mapped.retryable },
    });
  }
}

// ---------------------------------------------------------------- poll

export async function processPoll(job: Job<PollJobData>): Promise<void> {
  const { taskId, taskPublicId, externalJobId, attempt } = job.data;
  const cfg = getConfig();

  const task = await db().task.findUnique({ where: { id: taskId } });
  if (!task) return;
  if (task.status !== 'running') {
    log.info({ taskId, status: task.status }, 'poll: task no longer running, stop polling');
    return;
  }

  // 超时兜底：startedAt + TASK_TIMEOUT_MIN 未终态 → timeout + refund
  const startedAt = task.startedAt ?? task.createdAt;
  const elapsedMin = (Date.now() - startedAt.getTime()) / 60000;
  if (elapsedMin >= cfg.TASK_TIMEOUT_MIN) {
    log.warn({ taskId, elapsedMin }, 'poll: task timeout');
    await refundTaskTerminal({
      taskId,
      taskPublicId,
      toStatus: 'timeout',
      error: { code: 'TASK_TIMEOUT', message: 'generation timed out', retryable: true },
    });
    return;
  }

  let result: PollResult;
  try {
    const model = await loadModelDescriptor(task.modelId);
    const provider = getProvider(model.channelCode);
    const creds = await getChannelCreds(task.channelId);
    result = await provider.poll(externalJobId, model, creds);
  } catch (e) {
    const mapped = mapProviderError(e);
    log.warn({ err: e, taskId, code: mapped.code }, 'poll failed');

    // 轮询失败不等于任务失败：上游仍在跑，继续调度（除非不可重试）
    if (mapped.retryable && attempt < cfg.TASK_TIMEOUT_MIN * 4) {
      await enqueuePoll({ taskId, taskPublicId, externalJobId, attempt: attempt + 1 }, cfg.POLL_INTERVAL_SEC * 1000);
      return;
    }
    await refundTaskTerminal({
      taskId,
      taskPublicId,
      toStatus: 'failed',
      error: { code: mapped.code, message: mapped.userMessage, retryable: false },
    });
    return;
  }

  // 更新 external_status（保留平台原始 status/status_group/is_final）
  await db().task.update({
    where: { id: taskId },
    data: {
      externalStatus: (result.raw ?? {}) as object,
      ...(result.progress !== undefined ? { progress: Math.min(99, Math.max(1, result.progress)) } : {}),
    },
  });

  // **终态判定必须看 is_final**（不能只看 status 文本 —— PRD 附录 D）
  if (result.isFinal !== true) {
    const progress = result.progress ?? estimateProgress(startedAt);
    await publishTaskEvent({ taskPublicId, status: 'running', progress });
    await cacheTaskState({ taskPublicId, status: 'running', progress });
    await enqueuePoll({ taskId, taskPublicId, externalJobId, attempt: attempt + 1 }, cfg.POLL_INTERVAL_SEC * 1000);
    return;
  }

  if (result.state === 'succeeded') {
    await settleSuccess({
      taskId,
      taskPublicId,
      costUnits: result.costUnits,
      channelGroup: result.channelGroup,
      refundedByPlatform: result.refunded,
      durationSeconds: Math.round((Date.now() - startedAt.getTime()) / 1000),
      rawUsage: (result.raw ?? {}) as Record<string, unknown>,
    });

    await publishTaskEvent({ taskPublicId, status: 'succeeded', progress: 100 });
    await cacheTaskState({ taskPublicId, status: 'succeeded', progress: 100 });

    // 终态后触发产物转存（即使转存失败也不影响用户看到 succeeded）
    const outputs = (result.outputs ?? []).map<TransferOutput>((o) => ({
      mimeType: o.mimeType,
      ...(o.remoteUrl ? { remoteUrl: o.remoteUrl } : {}),
      ...(o.base64 ? { base64: o.base64 } : {}),
      ...(o.meta ? { meta: o.meta } : {}),
    }));

    if (outputs.length > 0) {
      await enqueueTransfer({ taskId, taskPublicId, userId: task.userId, outputs });
    }

    await enqueueNotify({ taskId, taskPublicId, userId: task.userId, status: 'succeeded' });
    return;
  }

  if (result.state === 'cancelled') {
    await refundTaskTerminal({ taskId, taskPublicId, toStatus: 'cancelled' });
    return;
  }

  // failed
  const error = result.error ?? { code: 'PROVIDER_ERROR', message: 'generation failed', retryable: false };
  log.warn({ taskId, error, platformRefunded: result.refunded }, 'task failed at provider');

  if (result.costUnits !== undefined && result.costUnits > 0) {
    await recordFailedCost(taskId, result);
  }

  await refundTaskTerminal({
    taskId,
    taskPublicId,
    toStatus: 'failed',
    error: { code: error.code, message: error.message, retryable: error.retryable },
  });
}

// ---------------------------------------------------------------- transfer

export async function processTransfer(job: Job<TransferJobData>): Promise<void> {
  const { taskId, taskPublicId, userId, outputs } = job.data;
  try {
    const results = await transferAll({ userId, taskId, taskPublicId, outputs });
    log.info({ taskId, count: results.length }, 'transfer completed');
    // 转存完成后补发一次 succeeded（含 results），修复前端在首次 succeeded 时拿到空结果后不再更新的问题。
    if (results.length > 0) {
      const payloadResults = results.map((r) => ({
        assetId: r.assetPublicId,
        url: r.viewUrl,
        mimeType: r.mimeType,
      }));
      await publishTaskEvent({ taskPublicId, status: 'succeeded', progress: 100, results: payloadResults });
      await cacheTaskState({ taskPublicId, status: 'succeeded', progress: 100, results: payloadResults });
    }
  } catch (e) {
    // 转存失败只告警，绝不重提生成任务（平台已扣费）
    log.error({ err: e, taskId }, 'transfer failed (generation NOT retried)');
  }
}

// ---------------------------------------------------------------- notify

export async function processNotify(job: Job<NotifyJobData>): Promise<void> {
  const { taskId, taskPublicId, userId, status } = job.data;

  const task = await db().task.findUnique({
    where: { id: taskId },
    include: { model: true },
  });
  if (!task) return;

  const assets = task.resultAssetIds.length
    ? await db().asset.findMany({ where: { id: { in: task.resultAssetIds }, deletedAt: null } })
    : [];

  const { notifyTaskCompleted, notifyTaskFailed } = await import('../modules/notifications/service.js');

  try {
    if (status === 'succeeded') {
      await notifyTaskCompleted({
        userId,
        taskPublicId,
        settledCredits: task.settledCredits,
        results: assets.map((a) => ({
          assetId: a.publicId,
          url: `/api/v1/assets/${a.publicId}`,
          mimeType: a.mimeType,
        })),
      });
    } else {
      const error = (task.error ?? {}) as { code?: string; message?: string };
      await notifyTaskFailed({
        userId,
        taskPublicId,
        error: { code: error.code ?? 'PROVIDER_ERROR', message: error.message ?? 'generation failed' },
        refundedCredits: task.refunded ? task.quotedCredits : 0,
      });
    }
    log.info({ taskId, status }, 'notify written');
  } catch (e) {
    log.warn({ err: e, taskId }, 'notify failed');
    throw e; // 交给 BullMQ 重试
  }
}

// ---------------------------------------------------------------- 辅助

async function recordFailedCost(taskId: string, result: PollResult): Promise<void> {
  const task = await db().task.findUnique({
    where: { id: taskId },
    select: { channelId: true, modelId: true },
  });
  if (!task) return;

  await db().taskCost.upsert({
    where: { taskId },
    create: {
      taskId,
      channelId: task.channelId,
      modelId: task.modelId,
      billingMethod: 'per_call',
      costUnits: result.costUnits ?? 0,
      channelGroup: result.channelGroup ?? null,
      platformRefunded: result.refunded ?? false,
      refundedAmount: result.refunded ? (result.costUnits ?? 0) : 0,
      rawUsage: (result.raw ?? {}) as object,
    },
    update: {
      costUnits: result.costUnits ?? 0,
      platformRefunded: result.refunded ?? false,
      refundedAmount: result.refunded ? (result.costUnits ?? 0) : 0,
    },
  });
}

function estimateProgress(startedAt: Date): number {
  const elapsed = (Date.now() - startedAt.getTime()) / 1000;
  // 按 120s 估算线性推进，上限 95%（真实终态由 is_final 决定）
  return Math.min(95, Math.max(2, Math.round((elapsed / 120) * 95)));
}

async function loadModelDescriptorSafe(modelId: string) {
  try {
    return await loadModelDescriptor(modelId);
  } catch {
    return null;
  }
}

/** Provider/未知错误 → 统一错误映射（错误码 + 是否可重试 + 用户可读消息） */
export function mapProviderError(e: unknown): { code: string; retryable: boolean; userMessage: string } {
  if (typeof e === 'object' && e !== null && 'code' in e && 'status' in e) {
    const appErr = e as { code: string; details?: Record<string, unknown> };
    return {
      code: appErr.code,
      retryable: appErr.code === 'RATE_LIMITED' || appErr.code === 'PROVIDER_ERROR',
      userMessage: appErr.code,
    };
  }
  const msg = e instanceof Error ? e.message : String(e);
  return { code: 'PROVIDER_ERROR', retryable: true, userMessage: msg.slice(0, 200) };
}

// ---------------------------------------------------------------- 启动

export function startWorkers(): Worker[] {
  const conn = workerConnection();
  const cfg = getConfig();

  // generation 并发按渠道限流；Worker 数量受 LK_RATE_LIMIT_RPM 约束
  const generation = new Worker(QUEUE_NAMES.generation, processGeneration, {
    connection: conn,
    concurrency: Math.max(1, Math.min(10, Math.floor(cfg.LK_RATE_LIMIT_RPM / 12))),
  });

  const poll = new Worker(QUEUE_NAMES.poll, processPoll, {
    connection: workerConnection(),
    concurrency: 50,
  });

  const transfer = new Worker(QUEUE_NAMES.transfer, processTransfer, {
    connection: workerConnection(),
    concurrency: 10,
  });

  const notify = new Worker(QUEUE_NAMES.notify, processNotify, {
    connection: workerConnection(),
    concurrency: 20,
  });

  const all = [generation, poll, transfer, notify];
  for (const w of all) {
    w.on('failed', (job, e) => {
      log.error({ err: e, queue: w.name, jobId: job?.id }, 'job failed');
    });
    w.on('stalled', (jobId) => {
      log.warn({ queue: w.name, jobId }, 'job stalled (BullMQ will requeue)');
    });
    w.on('error', (e) => {
      log.error({ err: e, queue: w.name }, 'worker error');
    });
  }

  log.info('workers started');
  return all;
}

export { err };
export type { TaskStatus };
