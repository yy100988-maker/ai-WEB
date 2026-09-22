/**
 * 通知服务（PRD §8.6 / 详细设计 §2.7 / §1.8）。
 *
 * 两条设计原则：
 *  ① **不阻塞主流程**：通知是"事后告知"，绝不能因为站内信写库失败而让任务提交/结算失败。
 *     因此 `notifyTaskCompleted` / `notifyTaskFailed` / `notify` **永不抛异常**，失败只记日志
 *     （PRD §8.6："通知存储：user_notifications 表（异步写入，不阻塞主流程）"）。
 *  ② **i18n 内联存储**：`title_i18n` / `body_i18n` 是**11 语种 JSON 对象**，
 *     至少 en + zh-CN 必填，其余可回落 —— 用户切换语言时无需回填历史通知。
 */

import type { NotificationType, Prisma } from '@prisma/client';
import { db } from '../../core/db.js';
import { err } from '../../core/errors.js';
import { childLogger } from '../../core/logger.js';
import { LOCALES, type Locale } from '../../core/types.js';

const log = childLogger({ mod: 'notifications' });

/** 11 语种 JSON 对象（`en` 必填，其余可选回落） */
export type I18nText = Partial<Record<Locale, string>> & { en: string };

/**
 * 把部分语种补齐成完整 11 语种对象（缺失回落 en）。
 *
 * 为什么补齐而不是只存已翻译的几种：
 *  - 前端按 `bodyI18n[locale] ?? bodyI18n.en` 取值，需要对象里至少有 en；
 *  - 补齐后每行结构一致，便于运营用 SQL 批量校对，也让契约测试能断言 11 个 key 齐全。
 */
export function completeI18n(partial: I18nText): Record<string, string> {
  // `en` 由 I18nText 类型强制存在（`& { en: string }`），因此它就是回落源；
  // 不写 `partial[DEFAULT_LOCALE]` 是因为 noUncheckedIndexedAccess 会把它推成 string | undefined。
  const fallback = partial.en;
  const out: Record<string, string> = {};
  for (const locale of LOCALES) {
    out[locale] = partial[locale] ?? fallback;
  }
  return out;
}

/** 校验 i18n 对象至少含非空 `en`（PRD 要求） */
export function assertI18n(partial: I18nText, field: string): void {
  if (!partial || typeof partial.en !== 'string' || partial.en.length === 0) {
    throw new Error(`${field} must include 'en'`);
  }
}

// ---------------------------------------------------------------- 任务完成

export interface NotifyTaskCompletedInput {
  userId: string;
  taskPublicId: string;
  results: Array<{ assetId: string; url: string; mimeType: string }>;
  settledCredits: number;
}

/**
 * 任务完成通知（PRD §8.6：`task_completed`，**含结果资产链接**）。
 *
 * ⚠️ **绝不抛异常**（不阻塞任务结算主流程）：所有失败只记日志。
 * 返回值仅用于测试观测（写入成功返回通知 id，失败返回 null）。
 *
 * 结果链接写的是**资产公开 ID**（`assetId`）而不是签名 URL：
 * 浏览 URL 15min 就过期，写进通知里等于存了一个必然失效的链接。
 * 前端拿 assetId 后自己调 `GET /v1/assets/:id` 换取**当时**有效的 viewUrl。
 */
export async function notifyTaskCompleted(
  input: NotifyTaskCompletedInput,
): Promise<string | null> {
  const count = input.results.length;
  const firstAssetId = input.results[0]?.assetId ?? '';

  const titleI18n: I18nText = {
    en: 'Your creation is ready',
    'zh-CN': '你的作品已生成',
    'zh-TW': '你的作品已生成',
    ja: '作品の準備ができました',
    ko: '작품이 완성되었습니다',
    es: 'Tu creación está lista',
    fr: 'Votre création est prête',
    de: 'Deine Kreation ist fertig',
    it: 'La tua creazione è pronta',
    pt: 'A tua criação está pronta',
    ru: 'Ваша работа готова',
  };

  const bodyI18n: I18nText = {
    en: `${count} result${count === 1 ? '' : 's'} generated. Tap to view and download.`,
    'zh-CN': `已生成 ${count} 个结果，点击查看与下载。`,
    'zh-TW': `已生成 ${count} 個結果，點擊檢視與下載。`,
    ja: `${count} 件の結果を生成しました。タップして表示・ダウンロード。`,
    ko: `${count}개의 결과가 생성되었습니다. 탭하여 확인하고 다운로드하세요.`,
    es: `Se generaron ${count} resultados. Toca para ver y descargar.`,
    fr: `${count} résultat(s) généré(s). Touchez pour voir et télécharger.`,
    de: `${count} Ergebnis(se) erstellt. Tippen zum Ansehen und Herunterladen.`,
    it: `Generati ${count} risultati. Tocca per visualizzare e scaricare.`,
    pt: `Gerados ${count} resultados. Toque para ver e baixar.`,
    ru: `Создано результатов: ${count}. Нажмите, чтобы посмотреть и скачать.`,
  };

  return safeCreate({
    userId: input.userId,
    type: 'task_completed',
    titleI18n: completeI18n(titleI18n),
    bodyI18n: completeI18n(bodyI18n),
    meta: {
      taskId: input.taskPublicId,
      assetId: firstAssetId,
      assets: input.results.map((r) => ({ assetId: r.assetId, mimeType: r.mimeType })),
      settledCredits: input.settledCredits,
    },
    tag: 'task_completed',
  });
}

// ---------------------------------------------------------------- 任务失败

export interface NotifyTaskFailedInput {
  userId: string;
  taskPublicId: string;
  error: { code: string; message: string };
  refundedCredits: number;
}

/**
 * 任务失败通知（PRD §8.6：`task_failed`，**含错误原因和退款金额**）。
 *
 * 同样**绝不抛异常**。退款金额 > 0 时正文里明确写出，用户不必去账本查。
 */
export async function notifyTaskFailed(input: NotifyTaskFailedInput): Promise<string | null> {
  const refund = input.refundedCredits;

  const titleI18n: I18nText = {
    en: 'Creation failed',
    'zh-CN': '作品生成失败',
    'zh-TW': '作品生成失敗',
    ja: '生成に失敗しました',
    ko: '생성 실패',
    es: 'La creación falló',
    fr: 'Échec de la création',
    de: 'Erstellung fehlgeschlagen',
    it: 'Creazione non riuscita',
    pt: 'Falha na criação',
    ru: 'Не удалось создать',
  };

  const reasonLine: Record<string, string> = {
    en: 'The task could not be completed. Please try again or adjust your prompt.',
    'zh-CN': '任务未能完成，请重试或调整提示词。',
    'zh-TW': '任務未能完成，請重試或調整提示詞。',
    ja: 'タスクを完了できませんでした。再試行するかプロンプトを調整してください。',
    ko: '작업을 완료하지 못했습니다. 다시 시도하거나 프롬프트를 조정하세요.',
    es: 'La tarea no se pudo completar. Inténtalo de nuevo o ajusta el prompt.',
    fr: 'La tâche n’a pas pu être terminée. Réessayez ou ajustez votre prompt.',
    de: 'Die Aufgabe konnte nicht abgeschlossen werden. Bitte erneut versuchen.',
    it: 'Impossibile completare l’attività. Riprova o modifica il prompt.',
    pt: 'A tarefa não foi concluída. Tente novamente ou ajuste o prompt.',
    ru: 'Задача не выполнена. Повторите попытку или измените запрос.',
  };

  const refundLine: Record<string, string> =
    refund > 0
      ? {
          en: `${refund} credits have been refunded.`,
          'zh-CN': `已退还 ${refund} 积分。`,
          'zh-TW': `已退還 ${refund} 積分。`,
          ja: `${refund} クレジットを返還しました。`,
          ko: `${refund} 크레딧이 환불되었습니다.`,
          es: `Se reembolsaron ${refund} créditos.`,
          fr: `${refund} crédits ont été remboursés.`,
          de: `${refund} Credits wurden erstattet.`,
          it: `Rimborsati ${refund} crediti.`,
          pt: `Reembolsados ${refund} créditos.`,
          ru: `Возвращено кредитов: ${refund}.`,
        }
      : {
          en: 'No credits were charged.',
          'zh-CN': '本次未扣减积分。',
          'zh-TW': '本次未扣減積分。',
          ja: 'クレジットは消費されていません。',
          ko: '크레딧이 차감되지 않았습니다.',
          es: 'No se cobraron créditos.',
          fr: 'Aucun crédit débité.',
          de: 'Es wurden keine Credits abgebucht.',
          it: 'Nessun credito addebitato.',
          pt: 'Nenhum crédito foi cobrado.',
          ru: 'Кредиты не списаны.',
        };

  const bodyI18n: Record<string, string> = {};
  for (const locale of LOCALES) {
    const reason = reasonLine[locale] ?? reasonLine['en']!;
    const refundText = refundLine[locale] ?? refundLine['en']!;
    bodyI18n[locale] = `${reason} ${refundText}`;
  }

  return safeCreate({
    userId: input.userId,
    type: 'task_failed',
    titleI18n: completeI18n(titleI18n),
    bodyI18n,
    meta: {
      taskId: input.taskPublicId,
      errorCode: input.error.code,
      errorMessage: input.error.message,
      refundedCredits: refund,
    },
    tag: 'task_failed',
  });
}

// ---------------------------------------------------------------- 通用写入

export interface NotifyInput {
  userId: string;
  type: NotificationType;
  titleI18n: I18nText;
  bodyI18n: I18nText;
  meta?: Record<string, unknown>;
  /** 日志归类标签，便于定位是哪条业务线写的 */
  tag?: string;
}

/**
 * 通用写入（订阅到期 `subscription_expiry` / 活动 `promo` 等）。
 * 同样**永不抛异常**；i18n 缺 en 时直接跳过并记 warn（不写半成品数据）。
 */
export async function notify(input: NotifyInput): Promise<string | null> {
  try {
    assertI18n(input.titleI18n, 'titleI18n');
    assertI18n(input.bodyI18n, 'bodyI18n');
  } catch (e) {
    log.warn({ err: e, userId: input.userId, type: input.type }, 'notification i18n invalid, skipped');
    return null;
  }

  return safeCreate({
    userId: input.userId,
    type: input.type,
    titleI18n: completeI18n(input.titleI18n),
    bodyI18n: completeI18n(input.bodyI18n),
    meta: input.meta ?? {},
    tag: input.tag ?? input.type,
  });
}

interface CreateInput {
  userId: string;
  type: NotificationType;
  titleI18n: Record<string, string>;
  bodyI18n: Record<string, string>;
  meta: Record<string, unknown>;
  tag: string;
}

/**
 * 唯一的写库出口。**吞掉所有异常** —— 这是"不阻塞主流程"的落点。
 *
 * Prisma 的 `user_notifications` 只有 type/title/body/readAt 列，**没有 meta 列**；
 * 把 meta 硬塞进 bodyI18n 会污染对客文案，因此 meta 只进日志（保留排障信息，如 taskId/assetId）。
 */
async function safeCreate(input: CreateInput): Promise<string | null> {
  try {
    const row = await db().userNotification.create({
      data: {
        userId: input.userId,
        type: input.type,
        titleI18n: input.titleI18n as Prisma.InputJsonValue,
        bodyI18n: input.bodyI18n as Prisma.InputJsonValue,
      },
      select: { id: true },
    });
    log.info({ userId: input.userId, type: input.type, tag: input.tag }, 'notification created');
    return row.id;
  } catch (e) {
    log.error(
      { err: e, userId: input.userId, type: input.type, tag: input.tag, meta: input.meta },
      'notification write failed (non-blocking)',
    );
    return null;
  }
}

// ---------------------------------------------------------------- 查询

export interface SerializedNotification {
  id: string;
  type: string;
  titleI18n: Record<string, string>;
  bodyI18n: Record<string, string>;
  read: boolean;
  readAt: string | null;
  createdAt: string;
}

export function serializeNotification(row: {
  id: string;
  type: string;
  titleI18n: unknown;
  bodyI18n: unknown;
  readAt: Date | null;
  createdAt: Date;
}): SerializedNotification {
  return {
    id: row.id,
    type: row.type,
    titleI18n: (row.titleI18n ?? {}) as Record<string, string>,
    bodyI18n: (row.bodyI18n ?? {}) as Record<string, string>,
    read: row.readAt !== null,
    readAt: row.readAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

/** 游标编解码（与 tasks/assets 同构，倒序翻页） */
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

/** 通知列表（倒序游标分页，PRD §8.6 / §2.1） */
export async function listNotifications(input: {
  userId: string;
  cursor?: string;
  limit?: number;
}): Promise<{ items: SerializedNotification[]; nextCursor: string | null }> {
  const limit = Math.min(Math.max(input.limit ?? 20, 1), 100);
  const cursor = decodeCursor(input.cursor);

  const rows = await db().userNotification.findMany({
    where: {
      userId: input.userId,
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
    items: page.map(serializeNotification),
    nextCursor: hasMore && last ? encodeCursor(last.createdAt, last.id) : null,
  };
}

/** 未读数（驱动前端红点，PRD §8.6 / §13 #17） */
export async function unreadCount(userId: string): Promise<number> {
  return db().userNotification.count({ where: { userId, readAt: null } });
}

/**
 * 标记单条已读。**幂等**：已读的再标一次不改变 `readAt`（保留首次阅读时间）。
 * 非本人的通知 id → 404（不泄露存在性）。
 */
export async function markRead(input: {
  userId: string;
  notificationId: string;
}): Promise<{ read: boolean; readAt: string | null }> {
  const row = await db().userNotification.findFirst({
    where: { id: input.notificationId, userId: input.userId },
    select: { id: true, readAt: true },
  });
  if (!row) throw err.notFound({ notificationId: input.notificationId });

  if (row.readAt) {
    return { read: true, readAt: row.readAt.toISOString() };
  }

  const now = new Date();
  await db().userNotification.update({ where: { id: row.id }, data: { readAt: now } });
  return { read: true, readAt: now.toISOString() };
}

/** 全部已读（幂等；返回本次更新条数） */
export async function markAllRead(userId: string): Promise<{ updated: number }> {
  const res = await db().userNotification.updateMany({
    where: { userId, readAt: null },
    data: { readAt: new Date() },
  });
  return { updated: res.count };
}
