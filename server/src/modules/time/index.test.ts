/**
 * 时区纯函数单测（详细设计 §1.6 四条规则的可执行证明）。
 *
 * 覆盖点：
 *  - 东八区/西五区/UTC 的"今天"判定差异（规则 1）
 *  - 次日 00:00 的 UTC 换算（规则 4）
 *  - 夏令时切换（America/New_York 3 月/11 月）边界不崩、结果单调
 *  - 非法时区回落 Asia/Shanghai
 *  - @db.Date 往返
 */

import { describe, expect, it } from 'vitest';
import {
  allLocaleTimezones,
  dbDateToLocalDate,
  defaultTimezoneForLocale,
  isValidTimezone,
  localDateOf,
  localDateToDbDate,
  localWallClockToUtc,
  nextLocalMidnightUtc,
  normalizeTimezone,
  utcOffsetMinutes,
} from './index.js';

describe('normalizeTimezone / isValidTimezone', () => {
  it('接受 IANA 时区名', () => {
    expect(isValidTimezone('Asia/Shanghai')).toBe(true);
    expect(isValidTimezone('America/New_York')).toBe(true);
    expect(isValidTimezone('UTC')).toBe(true);
  });

  it('拒绝垃圾串并回落 Asia/Shanghai', () => {
    expect(normalizeTimezone('Not/AZone')).toBe('Asia/Shanghai');
    expect(normalizeTimezone('')).toBe('Asia/Shanghai');
    expect(normalizeTimezone(null)).toBe('Asia/Shanghai');
    expect(normalizeTimezone(undefined)).toBe('Asia/Shanghai');
    expect(normalizeTimezone('x'.repeat(200))).toBe('Asia/Shanghai');
  });

  it('合法时区原样返回', () => {
    expect(normalizeTimezone('Asia/Tokyo')).toBe('Asia/Tokyo');
  });
});

describe('utcOffsetMinutes', () => {
  it('东八区 = +480', () => {
    expect(utcOffsetMinutes('Asia/Shanghai', new Date('2025-06-01T00:00:00Z'))).toBe(480);
  });

  it('UTC = 0', () => {
    expect(utcOffsetMinutes('UTC', new Date('2025-06-01T00:00:00Z'))).toBe(0);
  });

  it('美东夏令时 = -240、冬令时 = -300', () => {
    expect(utcOffsetMinutes('America/New_York', new Date('2025-07-01T12:00:00Z'))).toBe(-240);
    expect(utcOffsetMinutes('America/New_York', new Date('2025-01-15T12:00:00Z'))).toBe(-300);
  });
});

describe('localDateOf —— 规则 1：用用户时区算"今天"', () => {
  it('UTC 17:00 在东八区已是次日', () => {
    expect(localDateOf('Asia/Shanghai', new Date('2025-01-01T17:00:00Z'))).toBe('2025-01-02');
  });

  it('UTC 15:59 在东八区仍是当日', () => {
    expect(localDateOf('Asia/Shanghai', new Date('2025-01-01T15:59:59Z'))).toBe('2025-01-01');
  });

  it('同一瞬时在不同时区得到不同"今天"（跨日边界）', () => {
    const at = new Date('2025-01-01T17:00:00Z');
    expect(localDateOf('Asia/Shanghai', at)).toBe('2025-01-02'); // +8 → 次日 01:00
    expect(localDateOf('UTC', at)).toBe('2025-01-01'); // +0 → 当日 17:00
    expect(localDateOf('America/New_York', at)).toBe('2025-01-01'); // -5 → 当日 12:00
  });

  it('美东在 UTC 03:00 时仍是前一天', () => {
    expect(localDateOf('America/New_York', new Date('2025-01-02T03:00:00Z'))).toBe('2025-01-01');
  });

  it('输出恒为 YYYY-MM-DD（个位数月日补零）', () => {
    expect(localDateOf('Asia/Shanghai', new Date('2025-03-05T02:00:00Z'))).toBe('2025-03-05');
  });

  it('非法时区回落 Asia/Shanghai', () => {
    const at = new Date('2025-01-01T17:00:00Z');
    expect(localDateOf('Bogus/Zone', at)).toBe(localDateOf('Asia/Shanghai', at));
  });
});

describe('nextLocalMidnightUtc —— 规则 4：过期点 = 该时区次日 00:00', () => {
  it('东八区次日 00:00 = 当日 16:00Z', () => {
    const at = new Date('2025-01-01T10:00:00Z'); // 本地 1/1 18:00
    expect(nextLocalMidnightUtc('Asia/Shanghai', at).toISOString()).toBe('2025-01-01T16:00:00.000Z');
  });

  it('东八区凌晨（本地 00:30）的次日 00:00 是 24 小时后', () => {
    const at = new Date('2025-01-01T16:30:00Z'); // 本地 1/2 00:30
    expect(nextLocalMidnightUtc('Asia/Shanghai', at).toISOString()).toBe('2025-01-02T16:00:00.000Z');
  });

  it('过期点严格晚于参照瞬时', () => {
    const at = new Date('2025-06-15T07:33:21Z');
    for (const tz of ['Asia/Shanghai', 'America/New_York', 'Europe/Berlin', 'UTC', 'Asia/Tokyo']) {
      expect(nextLocalMidnightUtc(tz, at).getTime()).toBeGreaterThan(at.getTime());
    }
  });

  it('过期点与该时区的本地日一致（跨时区自洽）', () => {
    const at = new Date('2025-01-01T17:00:00Z'); // 东八区 = 1/2
    const midnight = nextLocalMidnightUtc('Asia/Shanghai', at);
    // 次日 00:00 减 1 毫秒仍在"今天"（1/2）
    expect(localDateOf('Asia/Shanghai', new Date(midnight.getTime() - 1))).toBe('2025-01-02');
    expect(localDateOf('Asia/Shanghai', midnight)).toBe('2025-01-03');
  });

  it('UTC 时区次日 00:00 = 次日 00:00Z', () => {
    expect(nextLocalMidnightUtc('UTC', new Date('2025-01-01T05:00:00Z')).toISOString()).toBe(
      '2025-01-02T00:00:00.000Z',
    );
  });

  it('跨月边界正确（1/31 → 2/1）', () => {
    const at = new Date('2025-01-31T10:00:00Z'); // 东八区 1/31 18:00
    expect(nextLocalMidnightUtc('Asia/Shanghai', at).toISOString()).toBe('2025-01-31T16:00:00.000Z');
  });

  it('跨年边界正确（12/31 → 1/1）', () => {
    const at = new Date('2025-12-31T10:00:00Z');
    const midnight = nextLocalMidnightUtc('Asia/Shanghai', at);
    expect(localDateOf('Asia/Shanghai', midnight)).toBe('2026-01-01');
  });

  it('闰年 2/28 之后是 2/29', () => {
    const at = new Date('2024-02-28T10:00:00Z'); // 东八区 2/28 18:00
    const midnight = nextLocalMidnightUtc('Asia/Shanghai', at);
    expect(localDateOf('Asia/Shanghai', midnight)).toBe('2024-02-29');
  });

  it('美东夏令时切换日不崩且严格递增', () => {
    // 2025-03-09 美东 02:00 → 03:00（跳过一小时）
    const at = new Date('2025-03-09T05:00:00Z'); // 本地 3/9 00:00 EST
    const m = nextLocalMidnightUtc('America/New_York', at);
    expect(m.getTime()).toBeGreaterThan(at.getTime());
    expect(localDateOf('America/New_York', m)).toBe('2025-03-10');
  });

  it('美东冬令时回拨日不崩', () => {
    // 2025-11-02 美东 02:00 → 01:00（重复一小时）
    const at = new Date('2025-11-02T04:00:00Z');
    const m = nextLocalMidnightUtc('America/New_York', at);
    expect(m.getTime()).toBeGreaterThan(at.getTime());
    expect(localDateOf('America/New_York', m)).toBe('2025-11-03');
  });
});

describe('localWallClockToUtc', () => {
  it('东八区本地 2025-01-02 00:00 → 2025-01-01T16:00Z', () => {
    expect(localWallClockToUtc('Asia/Shanghai', 2025, 1, 2).toISOString()).toBe(
      '2025-01-01T16:00:00.000Z',
    );
  });

  it('带时分秒', () => {
    expect(localWallClockToUtc('Asia/Shanghai', 2025, 1, 2, 8, 30, 15).toISOString()).toBe(
      '2025-01-02T00:30:15.000Z',
    );
  });
});

describe('@db.Date 往返', () => {
  it('localDateToDbDate → UTC 00:00 的 Date', () => {
    expect(localDateToDbDate('2025-03-05').toISOString()).toBe('2025-03-05T00:00:00.000Z');
  });

  it('dbDateToLocalDate 反向一致', () => {
    for (const d of ['2025-01-01', '2025-02-28', '2024-02-29', '2025-12-31']) {
      expect(dbDateToLocalDate(localDateToDbDate(d))).toBe(d);
    }
  });

  it('非法字符串抛错', () => {
    expect(() => localDateToDbDate('2025/03/05')).toThrow();
  });
});

describe('locale → 时区（规则 4 映射表）', () => {
  it('11 语种全部有映射', () => {
    const map = allLocaleTimezones();
    expect(Object.keys(map)).toHaveLength(11);
    expect(map['zh-CN']).toBe('Asia/Shanghai');
    expect(map['en']).toBe('America/New_York');
    expect(map['ja']).toBe('Asia/Tokyo');
  });

  it('未覆盖 locale 回落 Asia/Shanghai', () => {
    expect(defaultTimezoneForLocale('xx-XX')).toBe('Asia/Shanghai');
    expect(defaultTimezoneForLocale(null)).toBe('Asia/Shanghai');
  });
});
