/**
 * 签到模块单测（PRD §8.7 / 详细设计 §1.6 四条时区规则）。
 *
 * 用**内存假 DB** 替换 Prisma，验证：
 *  - 规则 1：用用户时区算"今天"再写 date（东八区/美东/UTC 各自不同的日期）
 *  - 规则 3：改时区后新时区"今天"已签到 → 409，不补签不回溯
 *  - 规则 4：expiresAt = 该时区次日 00:00 的 UTC
 *  - 并发双击：同一天两次请求只能一次成功（唯一键兜底）
 *  - 余额口径：SUM(delta) 全量，**不过滤 expires_at**
 *  - CHECKIN_CREDITS 从 getConfig() 取
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------- 内存假 DB

interface FakeCheckin {
  userId: string;
  date: Date;
  credits: number;
  createdAt: Date;
}
interface FakeLedger {
  userId: string;
  delta: number;
  type: string;
  balanceAfter: number;
  idempotencyKey: string;
  expiresAt: Date | null;
  note: string | null;
  taskId?: string | null;
  orderId?: string | null;
}
interface FakeGrant {
  id: string;
  userId: string;
  type: string;
  amount: number;
  lastGrantedAt: Date;
  nextGrantAt: Date;
  expiresAt: Date | null;
}

const store = {
  timezone: 'Asia/Shanghai' as string | null,
  checkins: [] as FakeCheckin[],
  ledger: [] as FakeLedger[],
  grants: [] as FakeGrant[],
  /** 模拟并发：create 前先 await 一次微任务，让两个请求交错 */
  interleave: false,
};

function dateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

class P2002 extends Error {
  code = 'P2002';
}

function makeTx() {
  return {
    dailyCheckin: {
      create: async ({ data }: { data: FakeCheckin }) => {
        if (store.interleave) await Promise.resolve();
        const dup = store.checkins.find(
          (c) => c.userId === data.userId && dateKey(c.date) === dateKey(data.date),
        );
        if (dup) throw new P2002('Unique constraint failed on the fields: (`user_id`,`date`)');
        const row = { ...data, createdAt: new Date() };
        store.checkins.push(row);
        return row;
      },
      findUnique: async ({ where }: { where: { userId_date: { userId: string; date: Date } } }) => {
        const { userId, date } = where.userId_date;
        const hit = store.checkins.find(
          (c) => c.userId === userId && dateKey(c.date) === dateKey(date),
        );
        return hit ?? null;
      },
      findMany: async ({ where, take }: { where: { userId: string }; take: number }) =>
        store.checkins
          .filter((c) => c.userId === where.userId)
          .sort((a, b) => b.date.getTime() - a.date.getTime())
          .slice(0, take),
      count: async ({ where }: { where: { userId: string } }) =>
        store.checkins.filter((c) => c.userId === where.userId).length,
    },
    creditLedger: {
      create: async ({ data }: { data: FakeLedger }) => {
        store.ledger.push({ ...data });
        return data;
      },
    },
    grant: {
      findFirst: async ({ where }: { where: { userId: string; type: string } }) =>
        store.grants.find((g) => g.userId === where.userId && g.type === where.type) ?? null,
      update: async ({ where, data }: { where: { id: string }; data: Partial<FakeGrant> }) => {
        const g = store.grants.find((x) => x.id === where.id);
        if (g) Object.assign(g, data);
        return g;
      },
      create: async ({ data }: { data: Omit<FakeGrant, 'id'> }) => {
        const row = { ...data, id: `grant-${store.grants.length + 1}` };
        store.grants.push(row);
        return row;
      },
    },
    $queryRaw: async () => {
      // 全量 SUM(delta)，**不过滤 expires_at**
      const total = store.ledger.reduce((a, b) => a + b.delta, 0);
      return [{ bal: BigInt(total) }];
    },
  };
}

const fakeDb = {
  userPreference: {
    findUnique: async (_args: { where: { userId: string } }) =>
      store.timezone === null ? null : { timezone: store.timezone },
  },
  dailyCheckin: makeTx().dailyCheckin,
  $queryRaw: makeTx().$queryRaw,
  $transaction: async <T>(fn: (tx: ReturnType<typeof makeTx>) => Promise<T>): Promise<T> => fn(makeTx()),
};

vi.mock('../../core/db.js', () => ({
  db: () => fakeDb,
  transaction: async <T>(fn: (tx: ReturnType<typeof makeTx>) => Promise<T>): Promise<T> => fn(makeTx()),
}));

/**
 * ⚠️ `vi.mock` 的工厂被**提升**到 import 之前执行，而 service.ts 在模块加载期就调用
 * `childLogger()` → `logger()` → `getConfig()`。若引用普通 `let`，此刻仍处于 TDZ，
 * 会抛 "Cannot access 'mockConfig' before initialization"。用 `vi.hoisted` 保证它在最前。
 */
const configHolder = vi.hoisted(() => ({ value: { CHECKIN_CREDITS: 5 } }));

vi.mock('../../core/config.js', () => ({
  getConfig: () => configHolder.value,
}));

// logger 也打桩：service.ts 在模块加载期就 childLogger()，它会读 getConfig().LOG_LEVEL，
// 而本测试的 config 桩只需要 CHECKIN_CREDITS 一项，没必要为日志补齐全部配置字段。
vi.mock('../../core/logger.js', () => ({
  childLogger: () => ({
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  }),
  logger: () => ({
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  }),
}));

import { checkin, hasCheckedInToday, history, todayStatus, timezoneOf } from './service.js';
import { localDateOf, nextLocalMidnightUtc } from '../time/index.js';

const USER = '11111111-1111-1111-1111-111111111111';

beforeEach(() => {
  store.timezone = 'Asia/Shanghai';
  store.checkins = [];
  store.ledger = [];
  store.grants = [];
  store.interleave = false;
  configHolder.value.CHECKIN_CREDITS = 5;
});

// ================================================================ 规则 1

describe('规则 1：用 UserPreference.timezone 算"今天"', () => {
  it('东八区：UTC 17:00 签到写入次日日期', async () => {
    const at = new Date('2025-01-01T17:00:00Z'); // 东八区 1/2 01:00
    const r = await checkin(USER, at);
    expect(r.date).toBe('2025-01-02');
    expect(dateKey(store.checkins[0]!.date)).toBe('2025-01-02');
  });

  it('同一瞬时在美东仍是当日', async () => {
    store.timezone = 'America/New_York';
    const at = new Date('2025-01-01T17:00:00Z'); // 美东 1/1 12:00
    const r = await checkin(USER, at);
    expect(r.date).toBe('2025-01-01');
  });

  it('UTC 时区用 UTC 日', async () => {
    store.timezone = 'UTC';
    const at = new Date('2025-01-01T17:00:00Z');
    const r = await checkin(USER, at);
    expect(r.date).toBe('2025-01-01');
  });

  it('无 UserPreference 记录 → 默认 Asia/Shanghai', async () => {
    store.timezone = null;
    const at = new Date('2025-01-01T17:00:00Z');
    const r = await checkin(USER, at);
    expect(r.timezone).toBe('Asia/Shanghai');
    expect(r.date).toBe('2025-01-02');
  });

  it('时区非法 → 回落 Asia/Shanghai（不因脏数据 500）', async () => {
    store.timezone = 'Bogus/Zone';
    expect(await timezoneOf(USER)).toBe('Asia/Shanghai');
  });
});

// ================================================================ 规则 4

describe('规则 4：额度过期点 = 该时区次日 00:00', () => {
  it('东八区：次日 00:00 = 当日 16:00Z', async () => {
    const at = new Date('2025-01-01T10:00:00Z');
    const r = await checkin(USER, at);
    expect(r.expiresAt).toBe('2025-01-01T16:00:00.000Z');
    expect(store.ledger[0]!.expiresAt?.toISOString()).toBe('2025-01-01T16:00:00.000Z');
  });

  it('美东：次日 00:00 = 当日 05:00Z（冬令时 EST）', async () => {
    store.timezone = 'America/New_York';
    const at = new Date('2025-01-15T12:00:00Z'); // 本地 1/15 07:00 EST
    const r = await checkin(USER, at);
    expect(r.expiresAt).toBe('2025-01-16T05:00:00.000Z');
  });

  it('UTC：次日 00:00Z', async () => {
    store.timezone = 'UTC';
    const at = new Date('2025-01-01T05:00:00Z');
    const r = await checkin(USER, at);
    expect(r.expiresAt).toBe('2025-01-02T00:00:00.000Z');
  });

  it('expiresAt 与 nextLocalMidnightUtc 完全一致（同一真源）', async () => {
    const at = new Date('2025-06-15T07:33:21Z');
    const r = await checkin(USER, at);
    expect(new Date(r.expiresAt).getTime()).toBe(nextLocalMidnightUtc('Asia/Shanghai', at).getTime());
  });

  it('过期点严格晚于签到时刻', async () => {
    const at = new Date('2025-06-15T07:33:21Z');
    const r = await checkin(USER, at);
    expect(new Date(r.expiresAt).getTime()).toBeGreaterThan(at.getTime());
  });
});

// ================================================================ 规则 3 / 并发

describe('规则 3 + 并发双击：同一天只能签到一次', () => {
  it('同日重复签到 → 409 ALREADY_CHECKED_IN', async () => {
    const at = new Date('2025-01-01T10:00:00Z');
    await checkin(USER, at);
    await expect(checkin(USER, at)).rejects.toMatchObject({
      name: 'AppError',
      code: 'ALREADY_CHECKED_IN',
      status: 409,
    });
  });

  it('只有一条 dailyCheckin 与一条 ledger 记录', async () => {
    const at = new Date('2025-01-01T10:00:00Z');
    await checkin(USER, at);
    await checkin(USER, at).catch(() => undefined);
    expect(store.checkins).toHaveLength(1);
    expect(store.ledger).toHaveLength(1);
  });

  it('⚠️ 并发双击（交错执行）只成功一次', async () => {
    store.interleave = true;
    const at = new Date('2025-01-01T10:00:00Z');

    const results = await Promise.allSettled([checkin(USER, at), checkin(USER, at)]);
    const okCount = results.filter((r) => r.status === 'fulfilled').length;
    const conflictCount = results.filter(
      (r) => r.status === 'rejected' && (r.reason as { code?: string }).code === 'ALREADY_CHECKED_IN',
    ).length;

    expect(okCount).toBe(1);
    expect(conflictCount).toBe(1);
    expect(store.checkins).toHaveLength(1);
  });

  it('⚠️ 规则 3：改时区后新时区"今天"已签到 → 409，不补签不回溯', async () => {
    // 东八区 1/2 01:00 签到（UTC 1/1 17:00）
    const at = new Date('2025-01-01T17:00:00Z');
    await checkin(USER, at);
    expect(store.checkins[0]!.date.toISOString().slice(0, 10)).toBe('2025-01-02');

    // 改时区到 UTC：UTC 的"今天"仍是 1/1 → 可以签（不同日期）
    store.timezone = 'UTC';
    const r2 = await checkin(USER, at);
    expect(r2.date).toBe('2025-01-01');
    expect(store.checkins).toHaveLength(2);

    // 改时区到会撞同一日的地方：America/New_York 的"今天"= 1/1 → 已签到 → 409
    store.timezone = 'America/New_York';
    const before = store.checkins.length;
    await expect(checkin(USER, at)).rejects.toMatchObject({ code: 'ALREADY_CHECKED_IN' });
    expect(store.checkins).toHaveLength(before); // 不新增记录 = 不补签
  });

  it('第二天可以再次签到', async () => {
    await checkin(USER, new Date('2025-01-01T10:00:00Z'));
    const r = await checkin(USER, new Date('2025-01-02T10:00:00Z'));
    expect(r.date).toBe('2025-01-02');
    expect(store.checkins).toHaveLength(2);
  });

  it('不同用户互不影响', async () => {
    await checkin(USER, new Date('2025-01-01T10:00:00Z'));
    await expect(
      checkin('22222222-2222-2222-2222-222222222222', new Date('2025-01-01T10:00:00Z')),
    ).resolves.toBeDefined();
  });
});

// ================================================================ 返回值 / 账本

describe('返回值与账本写入', () => {
  it('★ 返回 { credits: 5, balance }（§13 #3 验收项）', async () => {
    const r = await checkin(USER, new Date('2025-01-01T10:00:00Z'));
    expect(r.credits).toBe(5);
    expect(r.balance).toBe(5);
  });

  it('CHECKIN_CREDITS 从 getConfig() 取（可配置）', async () => {
    // 注意：必须**改 holder 内部对象**（getConfig 桩返回的是同一引用），
    // 直接给局部变量 mockConfig 重新赋值不会影响被测模块。
    configHolder.value.CHECKIN_CREDITS = 12;
    const r = await checkin(USER, new Date('2025-01-01T10:00:00Z'));
    expect(r.credits).toBe(12);
    expect(store.ledger[0]!.delta).toBe(12);
    expect(store.checkins[0]!.credits).toBe(12);
  });

  it('ledger 写入字段正确：delta/type/idempotencyKey/expiresAt', async () => {
    const at = new Date('2025-01-01T10:00:00Z');
    await checkin(USER, at);
    const row = store.ledger[0]!;

    expect(row.delta).toBe(5);
    expect(row.type).toBe('grant_checkin');
    expect(row.idempotencyKey).toBe(`checkin:${USER}:2025-01-01`);
    expect(row.orderId ?? null).toBeNull();
    expect(row.taskId ?? null).toBeNull();
    expect(row.expiresAt).not.toBeNull();
  });

  it('幂等键含**本地日**（不是 UTC 日）', async () => {
    const at = new Date('2025-01-01T17:00:00Z'); // 东八区 1/2
    await checkin(USER, at);
    expect(store.ledger[0]!.idempotencyKey).toBe(`checkin:${USER}:2025-01-02`);
  });

  it('balanceAfter 与累加后的余额一致', async () => {
    await checkin(USER, new Date('2025-01-01T10:00:00Z'));
    await checkin(USER, new Date('2025-01-02T10:00:00Z'));
    expect(store.ledger[0]!.balanceAfter).toBe(5);
    expect(store.ledger[1]!.balanceAfter).toBe(10);
  });

  it('upsert Grant：首次创建，再次更新', async () => {
    await checkin(USER, new Date('2025-01-01T10:00:00Z'));
    expect(store.grants).toHaveLength(1);
    expect(store.grants[0]!.type).toBe('daily');

    await checkin(USER, new Date('2025-01-02T10:00:00Z'));
    expect(store.grants).toHaveLength(1); // 更新而非新增
    expect(store.grants[0]!.lastGrantedAt.toISOString()).toBe('2025-01-02T10:00:00.000Z');
  });
});

// ================================================================ 余额口径

describe('余额口径：SUM(delta) 全量，不过滤 expires_at', () => {
  it('已过期批次的积分仍计入 SUM(delta)（过期由 expire 流水表达）', async () => {
    // 模拟：签到 +5（已过期）
    store.ledger.push({
      userId: USER,
      delta: 5,
      type: 'grant_checkin',
      balanceAfter: 5,
      idempotencyKey: 'old',
      expiresAt: new Date('2020-01-01T00:00:00Z'), // 早就过期
      note: null,
    });

    // 再签到一次，余额应为 10（没有按 expires_at 过滤掉旧的那 5）
    const r = await checkin(USER, new Date('2025-01-01T10:00:00Z'));
    expect(r.balance).toBe(10);
  });

  it('负向流水（扣减）参与求和', async () => {
    store.ledger.push({
      userId: USER,
      delta: -3,
      type: 'task_deduct',
      balanceAfter: 0,
      idempotencyKey: 'spend',
      expiresAt: null,
      note: null,
    });
    const r = await checkin(USER, new Date('2025-01-01T10:00:00Z'));
    expect(r.balance).toBe(2);
  });
});

// ================================================================ today / history

describe('todayStatus（规则 2：前端展示与后端判定同源）', () => {
  it('未签到：checkedIn=false', async () => {
    const s = await todayStatus(USER, new Date('2025-01-01T10:00:00Z'));
    expect(s.checkedIn).toBe(false);
    expect(s.date).toBe('2025-01-01');
    expect(s.timezone).toBe('Asia/Shanghai');
  });

  it('已签到：checkedIn=true + credits 用记录值', async () => {
    await checkin(USER, new Date('2025-01-01T10:00:00Z'));
    const s = await todayStatus(USER, new Date('2025-01-01T12:00:00Z'));
    expect(s.checkedIn).toBe(true);
    expect(s.credits).toBe(5);
  });

  it('返回的 date 与 checkin 写入的 date 完全一致', async () => {
    const at = new Date('2025-01-01T17:00:00Z');
    const r = await checkin(USER, at);
    const s = await todayStatus(USER, at);
    expect(s.date).toBe(r.date);
  });

  it('跨本地日边界后 checkedIn 变回 false', async () => {
    const at = new Date('2025-01-01T10:00:00Z');
    await checkin(USER, at);
    // 次日 00:00 之后（东八区次日 = UTC 当日 16:00）
    const next = await todayStatus(USER, new Date('2025-01-01T16:00:01Z'));
    expect(next.checkedIn).toBe(false);
    expect(next.date).toBe('2025-01-02');
  });

  it('返回 expiresAt（规则 4）', async () => {
    const at = new Date('2025-01-01T10:00:00Z');
    const s = await todayStatus(USER, at);
    expect(s.expiresAt).toBe('2025-01-01T16:00:00.000Z');
  });
});

describe('hasCheckedInToday', () => {
  it('签到前后布尔值正确', async () => {
    const at = new Date('2025-01-01T10:00:00Z');
    expect(await hasCheckedInToday(USER, at)).toBe(false);
    await checkin(USER, at);
    expect(await hasCheckedInToday(USER, at)).toBe(true);
  });
});

describe('history', () => {
  it('倒序返回记录 + total', async () => {
    await checkin(USER, new Date('2025-01-01T10:00:00Z'));
    await checkin(USER, new Date('2025-01-02T10:00:00Z'));
    await checkin(USER, new Date('2025-01-03T10:00:00Z'));

    const h = await history(USER, 10);
    expect(h.records).toHaveLength(3);
    expect(h.total).toBe(3);
    expect(h.records[0]!.date).toBe('2025-01-03');
    expect(h.records[2]!.date).toBe('2025-01-01');
  });

  it('limit 生效', async () => {
    await checkin(USER, new Date('2025-01-01T10:00:00Z'));
    await checkin(USER, new Date('2025-01-02T10:00:00Z'));
    const h = await history(USER, 1);
    expect(h.records).toHaveLength(1);
    expect(h.total).toBe(2); // total 是全部，不受 limit 影响
  });

  it('date 是 YYYY-MM-DD 字符串（@db.Date 往返正确）', async () => {
    await checkin(USER, new Date('2025-01-01T10:00:00Z'));
    const h = await history(USER, 10);
    expect(h.records[0]!.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(h.records[0]!.checkedInAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('无记录返回空数组', async () => {
    const h = await history(USER, 10);
    expect(h.records).toEqual([]);
    expect(h.total).toBe(0);
  });

  it('携带用户时区（前端展示用）', async () => {
    store.timezone = 'Asia/Tokyo';
    const h = await history(USER, 10);
    expect(h.timezone).toBe('Asia/Tokyo');
  });
});

// ================================================================ 时区一致性

describe('时区规则整体自洽', () => {
  it('每个时区：签到日的下一个瞬间仍在同日，过期点在次日', async () => {
    const timezones = ['Asia/Shanghai', 'America/New_York', 'Europe/Berlin', 'Asia/Tokyo', 'UTC'];
    for (const tz of timezones) {
      store.timezone = tz;
      store.checkins = [];
      const at = new Date('2025-06-15T07:33:21Z');
      const r = await checkin(USER, at);

      expect(r.date).toBe(localDateOf(tz, at));
      const midnight = new Date(r.expiresAt);
      expect(localDateOf(tz, new Date(midnight.getTime() - 1))).toBe(r.date);
      expect(localDateOf(tz, midnight)).not.toBe(r.date);
    }
  });
});
