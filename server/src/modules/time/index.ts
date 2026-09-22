/**
 * 用户本地时间换算（详细设计 §1.6 签到 4 条时区规则 / §1.9 提示词库本地日）。
 *
 * 为什么需要这一层：
 *  - `daily_checkins.date` 与 `prompt_post_events.date` 都是 **@db.Date**，写的是"用户本地日"而非 UTC 日；
 *  - 若直接用 UTC 日，美洲用户在 UTC 20:00 之后签到会被算成"第二天"，同一天能签两次、次日全天签不了；
 *  - 规则 ② 要求**前端展示与后端判定同源**：前端不再自行算日期，一律用 `GET /v1/checkin/today` 的返回，
 *    所以这里导出的纯函数是后端唯一的"今天"定义源。
 *
 * 实现约束：**不引第三方日期库**（date-fns-tz / luxon / dayjs-tz 都会引入额外体积与时区数据库假设）。
 * 这里用 `Intl.DateTimeFormat` 反向求解 UTC 偏移，Node 内置 ICU 自带完整 tzdata。
 *
 * 两遍求解的原因：偏移值本身依赖"该时刻"（夏令时切换日偏移会变）。
 * 先用 UTC 时刻估一个偏移得到候选本地时刻，再用候选本地时刻复查一次偏移；
 * 两遍足以收敛，对夏令时跳变边界给出与 wall-clock 语义一致的答案。
 */

import { FALLBACK_TIMEZONE } from '../../core/types.js';
import { LOCALES, LOCALE_TIMEZONE, isLocale } from '../../core/types.js';
import type { Locale } from '../../core/types.js';

// ---------------------------------------------------------------- 时区工具

/** Intl 句柄缓存：`Intl.DateTimeFormat` 构造开销大（要载入 tz 规则），进程内复用 */
const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const cached = formatterCache.get(timeZone);
  if (cached) return cached;
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  formatterCache.set(timeZone, fmt);
  return fmt;
}

/** 校验时区是否被运行时 ICU 认识（不认识就回落，避免用户存了脏时区导致签到 500） */
export function isValidTimezone(timeZone: string): boolean {
  if (!timeZone || typeof timeZone !== 'string') return false;
  try {
    formatterFor(timeZone);
    // 构造成功不代表合法（部分实现会静默回落 UTC），用 format 实测一次
    new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

/**
 * 归一化时区：非法/为空/长度异常一律回落 `Asia/Shanghai`（详细设计 §1.6 规则 1 默认值）。
 * 上限 64 字符防御超长垃圾串进 ICU。
 */
export function normalizeTimezone(timeZone: string | null | undefined): string {
  if (!timeZone || typeof timeZone !== 'string' || timeZone.length > 64) return FALLBACK_TIMEZONE;
  return isValidTimezone(timeZone) ? timeZone : FALLBACK_TIMEZONE;
}

/** 取某 UTC 瞬时在指定时区的壁钟分量 */
function wallClock(timeZone: string, at: Date): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
} {
  const parts = formatterFor(timeZone).formatToParts(at);
  const get = (type: Intl.DateTimeFormatPartTypes): number => {
    const hit = parts.find((p) => p.type === type);
    return hit ? Number.parseInt(hit.value, 10) : 0;
  };
  // hour12:false 在午夜可能返回 "24"，归一到 0
  const hour = get('hour') % 24;
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour,
    minute: get('minute'),
    second: get('second'),
  };
}

/**
 * 该时区在给定瞬时的 UTC 偏移（分钟，东八区 = +480）。
 *
 * 用 `Intl` 给出的壁钟分量构造一个"假装是 UTC"的时间戳，
 * 与真实 UTC 时间戳相减即得偏移。
 */
export function utcOffsetMinutes(timeZone: string, at: Date = new Date()): number {
  const w = wallClock(timeZone, at);
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  // 抹掉毫秒，避免亚秒误差污染偏移
  const real = Math.floor(at.getTime() / 1000) * 1000;
  return Math.round((asUtc - real) / 60000);
}

// ---------------------------------------------------------------- 对外纯函数

/** `YYYY-MM-DD`（本地日） */
function formatDate(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * 用户本地"今天"（签到规则 1 / 提示词库本地日）。
 *
 * @param timezone IANA 时区名（非法则回落 Asia/Shanghai）
 * @param at       参照瞬时，默认 now
 * @returns        `YYYY-MM-DD`
 *
 * 例：`localDateOf('Asia/Shanghai', new Date('2025-01-01T17:00:00Z'))` → `'2025-01-02'`
 *     （UTC 还是 1 日 17:00，东八区已经是 2 日凌晨 1 点）
 */
export function localDateOf(timezone: string, at: Date = new Date()): string {
  const tz = normalizeTimezone(timezone);
  const w = wallClock(tz, at);
  return formatDate(w.year, w.month, w.day);
}

/**
 * 该时区**次日 00:00** 对应的 UTC 瞬时（签到规则 4：签到额度过期点）。
 *
 * 求法：先取当前本地日 Y-M-D，得出"次日"的日历日（用 UTC 算术避免月末/闰年手写判断），
 * 再用两遍偏移求解把该本地壁钟时刻反解成 UTC 瞬时 —— 这就是"本地 00:00"的 UTC 表示。
 */
export function nextLocalMidnightUtc(timezone: string, at: Date = new Date()): Date {
  const tz = normalizeTimezone(timezone);
  const w = wallClock(tz, at);

  // 次日日历日（用 UTC Date 做进位，自动处理 28/29/30/31 与跨年）
  const nextDay = new Date(Date.UTC(w.year, w.month - 1, w.day + 1));
  const y = nextDay.getUTCFullYear();
  const m = nextDay.getUTCMonth() + 1;
  const d = nextDay.getUTCDate();

  return localWallClockToUtc(tz, y, m, d, 0, 0, 0);
}

/**
 * 本地壁钟 (Y-M-D h:m:s) → UTC 瞬时。
 *
 * 两遍求解：
 *   ① guess = Date.UTC(...) − offset(guess 之前先用 guess 本身估) —— 先用 wall 当 UTC 求偏移；
 *   ② 用 guess 复查偏移，若不同（夏令时切换日）再修正一次。
 */
export function localWallClockToUtc(
  timezone: string,
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
): Date {
  const tz = normalizeTimezone(timezone);
  const wallAsUtc = Date.UTC(year, month - 1, day, hour, minute, second);

  const off1 = utcOffsetMinutes(tz, new Date(wallAsUtc));
  let guess = wallAsUtc - off1 * 60000;

  const off2 = utcOffsetMinutes(tz, new Date(guess));
  if (off2 !== off1) {
    guess = wallAsUtc - off2 * 60000;
    // 第三次当且仅当第二遍仍不稳定（极罕见的双跳变日）时兜底复查，取一次修正结果
    const off3 = utcOffsetMinutes(tz, new Date(guess));
    if (off3 !== off2) guess = wallAsUtc - off3 * 60000;
  }

  return new Date(guess);
}

/** 本地日 → 写入 Prisma `@db.Date` 用的 Date（UTC 00:00 表示该日历日） */
export function localDateToDbDate(localDate: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(localDate);
  if (!m) throw new Error(`invalid local date: ${localDate}`);
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

/** Prisma `@db.Date` 读回 → `YYYY-MM-DD`（按 UTC 分量，Date 列不含时区） */
export function dbDateToLocalDate(d: Date): string {
  return formatDate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

// ---------------------------------------------------------------- 语言 → 时区

/**
 * 11 语种默认时区（详细设计 §1.6 规则 4 的映射表，落在 core/types.ts 的 LOCALE_TIMEZONE）。
 * 未覆盖的 locale / 非法 locale → Asia/Shanghai。
 */
export function defaultTimezoneForLocale(locale: string | null | undefined): string {
  if (isLocale(locale)) return LOCALE_TIMEZONE[locale as Locale];
  return FALLBACK_TIMEZONE;
}

/** 全部 11 语种 → 时区映射（seed / 单测用） */
export function allLocaleTimezones(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const l of LOCALES) out[l] = LOCALE_TIMEZONE[l];
  return out;
}
