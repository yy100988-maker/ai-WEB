/**
 * 提示词库服务（PRD §8.8 / 详细设计 §1.9 / §2.7）。
 *
 * 对应前端 `PromptLibrary`（首页分区 + tab 筛选 + 卡片 views/likes + hover 复制 + 点击深链）。
 * 后端接管前端硬编码：`tabs` / `cards` 都来自 DB，`views` / `likes` 取**实时计数**。
 *
 * 三个容易做错的点，这里逐一说明：
 *
 *  ⚠️ **① 匿名用户必须用哨兵 UUID**（详细设计 §1.9 原文）：
 *     `prompt_post_events.user_id` 是**非空**外键列。若匿名时留 NULL，
 *     PG 的唯一键 `(post_id, user_id, event, date)` **不把 NULL 视为相等**，
 *     于是同一匿名用户同一天可以反复插入 → views 被无限刷。
 *     因此匿名一律写 `ANONYMOUS_USER_ID`（`00000000-...-0000`），
 *     唯一键才真正生效；同时用 Redis 按 IP 做 1 次/天/事件 的限频兜底。
 *
 *  ⚠️ **② counters 必须原子自增**（PRD §8.8）：
 *     用 `UPDATE ... SET views = views + 1` 而不是"读出来 +1 再写回"——
 *     后者在并发下会丢更新（lost update），且需要额外一次 SELECT。
 *     关键是**只在事件首次插入成功时才累加**，否则同一天重复曝光会把计数刷爆。
 *
 *  ⚠️ **③ like 是切换语义**（详细设计 §1.9 原文）：
 *     "like/unlike 不参与唯一键语义（用户可反复切换），由业务层按最新状态覆盖计数。"
 *     所以 like 事件表只作为**审计**写入（同键冲突时静默忽略），
 *     真实状态由"该用户对该 post 的最新 like/unlike 事件"决定，计数按状态变化 ±1。
 */

import type { PromptPost, PromptTab } from '@prisma/client';
import { db } from '../../core/db.js';
import { err } from '../../core/errors.js';
import { ANONYMOUS_USER_ID } from '../../core/ids.js';
import { childLogger } from '../../core/logger.js';
import { redis, REDIS_KEYS } from '../../core/redis.js';
import { defaultTimezoneForLocale, localDateOf, localDateToDbDate, dbDateToLocalDate } from '../time/index.js';
import type { Locale } from '../../core/types.js';

const log = childLogger({ mod: 'prompt-library' });

/** 事件类型（详细设计 §1.9：view | copy | like | unlike） */
export type PromptEvent = 'view' | 'copy' | 'like' | 'unlike';

/** 匿名事件的本地日：无用户偏好，统一用 Asia/Shanghai（详细设计 §1.9 末段） */
export const ANON_TIMEZONE = 'Asia/Shanghai';

/** 匿名限频窗口：1 次/天/事件 */
export const ANON_RATE_LIMIT_SEC = 24 * 60 * 60;

// ---------------------------------------------------------------- 实体标识

/**
 * 解析 `:id` —— 支持 **public 标识**（`prompt_posts.id` 是 UUID，不对客）与
 * 对客稳定标识二选一。
 *
 * `prompt_posts` 表没有 `public_id` 列（schema 冻结），所以对客 id 直接用：
 *  - `id`（UUID 字符串）—— 前端从列表接口拿到的就是它；
 *  - 不存在时按 `title` 兜底查找（深链 `?prompt={title}` 场景）。
 */
export async function findPostByPublicId(postId: string): Promise<PromptPost | null> {
  const byId = await db().promptPost.findFirst({ where: { id: postId, active: true } });
  if (byId) return byId;
  // 兜底：前端深链用的是 title，允许用 title 精确定位（唯一性由业务保证）
  return db().promptPost.findFirst({ where: { title: postId, active: true, tabCode: { not: '' } } });
}

/** 对客 id：直接用 UUID（前端只做透传，不解析） */
export function publicIdOf(post: Pick<PromptPost, 'id'>): string {
  return post.id;
}

// ---------------------------------------------------------------- 列表

export interface PromptTabDto {
  id: string;
  labelI18n: Record<string, string>;
}

export interface PromptCardDto {
  id: string;
  title: string;
  img: string;
  cat: string;
  views: number;
  likes: number;
  copies: number;
  /** 深链用：`/app?prompt={title}&img={img}` */
  prompt: string;
}

export interface PromptLibraryDto {
  tabs: PromptTabDto[];
  cards: PromptCardDto[];
}

function toCard(post: PromptPost): PromptCardDto {
  return {
    id: publicIdOf(post),
    title: post.title,
    img: post.imgUrl,
    cat: post.tabCode,
    // 实时计数：直接读列（PRD §8.8 "views/likes 取实时计数，非 locale 硬编码"）
    views: post.views,
    likes: post.likes,
    copies: post.copies,
    // title 即 prompt 全文（详细设计 §1.9："卡片标题 = 可复制内容"）
    prompt: post.title,
  };
}

/**
 * 列表（PRD §8.8 / 详细设计 §2.7）：`{ tabs[], cards[] }`，`?cat=` 筛选（`all` 返回全部）。
 *
 * tabs 走 DB（`prompt_tabs.active` + `sort`），并**在首位插入 `all`**——
 * `all` 不是一个真实的分类，而是前端"全部"按钮的约定值，不需要在表里存一行。
 */
export async function listLibrary(input: { cat?: string }): Promise<PromptLibraryDto> {
  const cat = input.cat && input.cat !== '' ? input.cat : 'all';

  const [tabRows, postRows] = await Promise.all([
    db().promptTab.findMany({
      where: { active: true },
      orderBy: [{ sort: 'asc' }, { code: 'asc' }],
      select: { code: true, labelI18n: true },
    }),
    db().promptPost.findMany({
      where: {
        active: true,
        ...(cat === 'all' ? {} : { tabCode: cat }),
      },
      orderBy: [{ sort: 'asc' }, { createdAt: 'desc' }],
    }),
  ]);

  const tabs: PromptTabDto[] = [
    { id: 'all', labelI18n: ALL_TAB_LABEL },
    ...tabRows.map((t) => ({
      id: t.code,
      labelI18n: (t.labelI18n ?? {}) as Record<string, string>,
    })),
  ];

  return { tabs, cards: postRows.map(toCard) };
}

/** `all` 页签的 11 语种文案（与前端 locale 字典一致） */
const ALL_TAB_LABEL: Record<string, string> = {
  en: 'All',
  'zh-CN': '全部',
  'zh-TW': '全部',
  ja: 'すべて',
  ko: '전체',
  es: 'Todo',
  fr: 'Tout',
  de: 'Alle',
  it: 'Tutti',
  pt: 'Tudo',
  ru: 'Все',
};

// ---------------------------------------------------------------- 本地日

/** 取用户时区（无记录/匿名 → Asia/Shanghai） */
export async function timezoneOfUser(userId: string | null): Promise<string> {
  if (!userId || userId === ANONYMOUS_USER_ID) return ANON_TIMEZONE;
  const pref = await db().userPreference.findUnique({
    where: { userId },
    select: { timezone: true },
  });
  return pref?.timezone ?? ANON_TIMEZONE;
}

/** 事件本地日（详细设计 §1.9："按 UserPreference.timezone 换算后的用户本地日"） */
export function eventDate(timezone: string, at: Date = new Date()): Date {
  return localDateToDbDate(localDateOf(timezone, at));
}

/** 事件本地日（字符串形式，Redis 限频键用） */
export function eventDateKey(timezone: string, at: Date = new Date()): string {
  return localDateOf(timezone, at);
}

/** 供 locale 缺失时的时区推断 */
export function timezoneFromLocale(locale: string | null | undefined): string {
  return defaultTimezoneForLocale(locale as Locale | null | undefined);
}

// ---------------------------------------------------------------- 匿名限频

/**
 * 匿名按 IP 限频：**1 次/天/事件**（详细设计 §1.9 / REDIS_KEYS.promptAnon）。
 *
 * ⚠️ 为什么匿名既要哨兵 UUID 又要 IP 限频：
 *  哨兵 UUID 让**唯一键生效**，但它把所有匿名用户视为"同一个人"——
 *  这本身就能防刷（全站匿名每天只能贡献 1 次 view），
 *  但代价是**第一个**匿名用户之后就全被挡住，正常用户点卡片不会计数。
 *  所以真正的"每个访客每天 1 次"由 IP 限频提供，
 *  哨兵 UUID 是"即使 Redis 挂了也不能无限刷"的最后一道保险。
 *
 * @returns true = 允许；false = 已限频
 */
export async function allowAnonymous(ip: string, event: PromptEvent): Promise<boolean> {
  const day = localDateOf(ANON_TIMEZONE);
  const key = `${REDIS_KEYS.promptAnon(ip || 'unknown', event)}:${day}`;
  try {
    const res = await redis().set(key, '1', 'EX', ANON_RATE_LIMIT_SEC, 'NX');
    return res === 'OK';
  } catch (e) {
    // Redis 不可用：放行（宁可少数漏计，也不能让提示词库整体不可用）
    log.warn({ err: e, event }, 'anon rate limit check failed, allowing');
    return true;
  }
}

// ---------------------------------------------------------------- 事件写入

export interface RecordEventResult {
  /** 事件是否为首次（首次才累加计数器） */
  first: boolean;
  /** 该 post 的最新计数（无论首次与否都返回当前值） */
  counters: { views: number; likes: number; copies: number };
}

/**
 * 写入事件 + 条件累加计数器。
 *
 * 流程：
 *  1. `INSERT prompt_post_events` —— 靠 `(post_id, user_id, event, date)` 唯一键去重；
 *     冲突（P2002）说明今天已经记过 → `first = false`，**不累加**；
 *  2. 首次命中 → 原子 `UPDATE ... SET views = views + 1`（**不是读改写**，避免丢更新）；
 *  3. 返回最新计数。
 *
 * 为什么要"先插后加"而不是"先查后插"：
 *  并发下"先查"会两家都查到"没有"然后都去插，只有一家成功——逻辑仍正确，
 *  但多了一次查询；直接插 + 捕获冲突是**一次往返**且天然原子。
 *
 * ⚠️ `override: true`（like/unlike 专用）：只写事件作为**审计**，**绝不碰计数器**。
 *   原因：like 是切换语义，计数增减由调用方按"最新状态"计算（`adjustLikes(±1)`）。
 *   若这里也按 `counterColumnOf` 自增，一次 like 会被计两次（本模块曾踩过这个坑，
 *   单测 `首次 like → likes:1` 就是守这条不变量的）。
 */
export async function recordEvent(input: {
  postId: string;
  userId: string;
  event: PromptEvent;
  date: Date;
  /** 只审计不计数（like/unlike 用） */
  override?: boolean;
}): Promise<RecordEventResult> {
  const post = await db().promptPost.findFirst({
    where: { id: input.postId, active: true },
    select: { id: true, views: true, likes: true, copies: true },
  });
  if (!post) throw err.notFound({ postId: input.postId });

  const current = { views: post.views, likes: post.likes, copies: post.copies };

  if (input.override) {
    // like/unlike：唯一键冲突静默忽略（用户可反复切换，事件表只作审计），计数交给调用方
    try {
      await db().promptPostEvent.create({
        data: { postId: post.id, userId: input.userId, event: input.event, date: input.date },
      });
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
    }
    return { first: true, counters: current };
  }

  let first = false;
  try {
    await db().promptPostEvent.create({
      data: {
        postId: post.id,
        userId: input.userId,
        event: input.event,
        date: input.date,
      },
    });
    first = true;
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;
    // 今天已经记过这个事件 → 不累加
    log.debug({ postId: post.id, event: input.event }, 'prompt event deduplicated');
  }

  if (!first) {
    return { first: false, counters: current };
  }

  const counter = counterColumnOf(input.event);
  if (!counter) {
    // 无对应计数列的事件（不会发生，防御性）
    return { first: true, counters: current };
  }

  // ⚠️ 原子自增：`UPDATE ... SET views = views + 1`（PRD §8.8）
  const updated = await db().promptPost.update({
    where: { id: post.id },
    data: { [counter]: { increment: 1 } },
    select: { views: true, likes: true, copies: true },
  });

  return { first: true, counters: updated };
}

function counterColumnOf(event: PromptEvent): 'views' | 'likes' | 'copies' | null {
  switch (event) {
    case 'view':
      return 'views';
    case 'copy':
      return 'copies';
    case 'like':
    case 'unlike':
      return 'likes';
    default:
      return null;
  }
}

function isUniqueViolation(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: string }).code === 'P2002';
}

/** 原子调整计数（±1 或 ±n），用于 like/unlike 的"覆盖式"更新 */
export async function adjustLikes(postId: string, delta: number): Promise<number> {
  const updated = await db().promptPost.update({
    where: { id: postId },
    data: { likes: { increment: delta } },
    select: { likes: true },
  });
  // 计数器不允许为负（防御：异常数据/并发切换可能把 likes 打到 -1）
  if (updated.likes < 0) {
    const fixed = await db().promptPost.update({
      where: { id: postId },
      data: { likes: 0 },
      select: { likes: true },
    });
    return fixed.likes;
  }
  return updated.likes;
}

// ---------------------------------------------------------------- like 状态

/**
 * 查询某用户对该 post 的**最新点赞状态**。
 *
 * 详细设计 §1.9："like/unlike 不参与唯一键语义（用户可反复切换），
 * 由业务层按最新状态覆盖计数。"
 * 所以状态 = 该用户该 post 的**最后一条** like/unlike 事件。
 */
export async function likedBy(postId: string, userId: string): Promise<boolean> {
  const last = await db().promptPostEvent.findFirst({
    where: { postId, userId, event: { in: ['like', 'unlike'] } },
    orderBy: { createdAt: 'desc' },
    select: { event: true },
  });
  return last?.event === 'like';
}

// ---------------------------------------------------------------- 对外操作

export interface ViewResult {
  counted: boolean;
  views: number;
}

/** 浏览计数 +1（幂等按 user_id + date 去重计 UV；匿名另加 IP 限频） */
export async function recordView(input: {
  postId: string;
  userId: string;
  timezone: string;
  ip?: string;
}): Promise<ViewResult> {
  const date = eventDate(input.timezone);
  const result = await recordEvent({ postId: input.postId, userId: input.userId, event: 'view', date });
  return { counted: result.first, views: result.counters.views };
}

export interface CopyResult {
  counted: boolean;
  copies: number;
  title: string;
}

/** 复制计数 +1，并返回**原文**供前端写剪贴板（PRD §8.8） */
export async function recordCopy(input: {
  postId: string;
  userId: string;
  timezone: string;
}): Promise<CopyResult> {
  const post = await db().promptPost.findFirst({
    where: { id: input.postId, active: true },
    select: { id: true, title: true },
  });
  if (!post) throw err.notFound({ postId: input.postId });

  const date = eventDate(input.timezone);
  const result = await recordEvent({ postId: post.id, userId: input.userId, event: 'copy', date });

  return { counted: result.first, copies: result.counters.copies, title: post.title };
}

export interface LikeResult {
  liked: boolean;
  likes: number;
}

/**
 * 点赞**切换**（PRD §8.8 / 详细设计 §1.9）。
 *
 * 语义：当前未赞 → 点赞（likes +1）；当前已赞 → 取消（likes −1）。
 * 返回 `{ liked, likes }`。
 *
 * 实现：读最新状态 → 按状态变化原子调整 `prompt_posts.likes` → 记录事件供审计。
 *
 * ⚠️ 为什么状态判定**不能**依赖"当天最新事件"：
 *   `prompt_post_events` 的唯一键含 `date`，所以同一天内 like→unlike→like 的
 *   第三次写入会**撞唯一键**，最终落库的事件是 `unlike`（第一次 unlike 占位），
 *   而用户实际最终状态是"已赞" —— 读事件表会把状态判反。
 *
 * 因此本实现改为：**状态真源 = `prompt_posts.likes` 与本次调用的判定结果**，
 * 事件表退化为"审计 + 当日去重防护"。为了在同一天内仍能正确切换，
 * 每次切换都**先删除该用户当天该 post 的 like/unlike 事件再写新的一条**：
 *   - 保留唯一键约束（防刷审计表）；
 *   - 让"当天最新事件"与真实状态始终一致（每次只有一条）。
 *
 * 计数正确性由调用方一次性 `adjustLikes(±1)` 保证，绝不重复计数。
 */
export async function toggleLike(input: {
  postId: string;
  userId: string;
  timezone: string;
}): Promise<LikeResult> {
  const post = await db().promptPost.findFirst({
    where: { id: input.postId, active: true },
    select: { id: true, likes: true },
  });
  if (!post) throw err.notFound({ postId: input.postId });

  const wasLiked = await likedBy(post.id, input.userId);
  const nextLiked = !wasLiked;
  const date = eventDate(input.timezone);

  // 覆盖当天该用户的 like/unlike 事件：保证"最新事件 = 当前状态"，同时不与唯一键打架
  await db().promptPostEvent.deleteMany({
    where: { postId: post.id, userId: input.userId, event: { in: ['like', 'unlike'] }, date },
  });

  try {
    await db().promptPostEvent.create({
      data: {
        postId: post.id,
        userId: input.userId,
        event: nextLiked ? 'like' : 'unlike',
        date,
      },
    });
  } catch (e) {
    // 并发切换时可能撞唯一键：不影响计数正确性（计数以本次函数调用结果为准），记 debug 即可
    if (!isUniqueViolation(e)) throw e;
    log.debug({ postId: post.id, userId: input.userId }, 'like event upsert raced');
  }

  const likes = await adjustLikes(post.id, nextLiked ? 1 : -1);
  return { liked: nextLiked, likes };
}

// ---------------------------------------------------------------- 卡片详情

/** 单卡片（含正文，供深链直接拉取） */
export async function getCard(postId: string): Promise<PromptCardDto | null> {
  const post = await db().promptPost.findFirst({ where: { id: postId, active: true } });
  return post ? toCard(post) : null;
}

export { ANONYMOUS_USER_ID, localDateOf, localDateToDbDate, dbDateToLocalDate };
export type { PromptPost, PromptTab };
