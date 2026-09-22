/**
 * 提示词库单测（PRD §8.8 / 详细设计 §1.9）。
 *
 * 重点验证：
 *  - **匿名哨兵 UUID**（§1.9 核心：否则 PG 唯一键失效、可无限刷 views）
 *  - **原子计数器**（只在事件首次插入时累加；同天重复不重复计数）
 *  - **like 切换语义**（liked/likes 随状态变化，事件不去重）
 *  - **date 按用户时区换算**（匿名用 Asia/Shanghai）
 *  - `copy` 返回原文供剪贴板
 *  - tabs 首位插入 `all`
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------- 内存假 DB

interface FakePost {
  id: string;
  tabCode: string;
  title: string;
  imgUrl: string;
  assetId: string | null;
  views: number;
  likes: number;
  copies: number;
  sort: number;
  active: boolean;
  createdAt: Date;
}
interface FakeEvent {
  id: string;
  postId: string;
  userId: string;
  event: string;
  date: Date;
  createdAt: Date;
}

const store = {
  timezone: 'Asia/Shanghai' as string | null,
  posts: [] as FakePost[],
  tabs: [] as Array<{ code: string; labelI18n: unknown; sort: number; active: boolean }>,
  events: [] as FakeEvent[],
  eventSeq: 0,
};

class P2002 extends Error {
  code = 'P2002';
}

function dateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

const fakeDb = {
  promptTab: {
    findMany: async () =>
      store.tabs.filter((t) => t.active).sort((a, b) => a.sort - b.sort || a.code.localeCompare(b.code)),
  },
  promptPost: {
    findMany: async ({ where }: { where: { active: boolean; tabCode?: string } }) =>
      store.posts
        .filter((p) => p.active && (where.tabCode === undefined || p.tabCode === where.tabCode))
        .sort((a, b) => a.sort - b.sort || b.createdAt.getTime() - a.createdAt.getTime()),
    findFirst: async ({
      where,
    }: {
      where: { id?: string; title?: string; active?: boolean; tabCode?: unknown };
    }) => {
      return (
        store.posts.find(
          (p) =>
            (where.id === undefined || p.id === where.id) &&
            (where.title === undefined || p.title === where.title) &&
            (where.active === undefined || p.active === where.active),
        ) ?? null
      );
    },
    update: async ({
      where,
      data,
    }: {
      where: { id: string };
      data: Record<string, { increment: number } | number>;
    }) => {
      const p = store.posts.find((x) => x.id === where.id);
      if (!p) throw new Error('post not found');
      for (const [k, v] of Object.entries(data)) {
        if (typeof v === 'object' && v !== null && 'increment' in v) {
          (p as unknown as Record<string, number>)[k] =
            ((p as unknown as Record<string, number>)[k] ?? 0) + v.increment;
        } else if (typeof v === 'number') {
          (p as unknown as Record<string, number>)[k] = v;
        }
      }
      return { views: p.views, likes: p.likes, copies: p.copies };
    },
  },
  promptPostEvent: {
    create: async ({ data }: { data: Omit<FakeEvent, 'id' | 'createdAt'> }) => {
      // 唯一键 (postId, userId, event, date)
      const dup = store.events.find(
        (e) =>
          e.postId === data.postId &&
          e.userId === data.userId &&
          e.event === data.event &&
          dateKey(e.date) === dateKey(data.date),
      );
      if (dup) throw new P2002('Unique constraint failed');
      store.eventSeq += 1;
      const row = { ...data, id: `ev-${store.eventSeq}`, createdAt: new Date(Date.now() + store.eventSeq) };
      store.events.push(row);
      return row;
    },
    findFirst: async ({
      where,
    }: {
      where: { postId: string; userId: string; event: { in: string[] } };
      orderBy: { createdAt: 'desc' };
    }) => {
      const hits = store.events.filter(
        (e) =>
          e.postId === where.postId &&
          e.userId === where.userId &&
          where.event.in.includes(e.event),
      );
      if (hits.length === 0) return null;
      hits.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      return { event: hits[0]!.event };
    },
    deleteMany: async ({
      where,
    }: {
      where: { postId: string; userId: string; event: { in: string[] }; date: Date };
    }) => {
      const before = store.events.length;
      store.events = store.events.filter(
        (e) =>
          !(
            e.postId === where.postId &&
            e.userId === where.userId &&
            where.event.in.includes(e.event) &&
            dateKey(e.date) === dateKey(where.date)
          ),
      );
      return { count: before - store.events.length };
    },
  },
  userPreference: {
    findUnique: async () => (store.timezone === null ? null : { timezone: store.timezone }),
  },
};

vi.mock('../../core/db.js', () => ({
  db: () => fakeDb,
  transaction: async <T>(fn: (tx: typeof fakeDb) => Promise<T>): Promise<T> => fn(fakeDb),
}));

vi.mock('../../core/logger.js', () => ({
  childLogger: () => ({
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  }),
}));

/** Redis 限频桩：内存 Map */
const redisStore = new Map<string, string>();
vi.mock('../../core/redis.js', () => ({
  redis: () => ({
    set: async (key: string, val: string, _ex: string, _ttl: number, _nx: string) => {
      if (redisStore.has(key)) return null;
      redisStore.set(key, val);
      return 'OK';
    },
    get: async (key: string) => redisStore.get(key) ?? null,
  }),
  REDIS_KEYS: {
    promptAnon: (ip: string, event: string) => `pl:anon:${event}:${ip}`,
  },
}));

import {
  ANON_TIMEZONE,
  allowAnonymous,
  eventDate,
  eventDateKey,
  likedBy,
  listLibrary,
  recordCopy,
  recordEvent,
  recordView,
  toggleLike,
} from './service.js';
import { ANONYMOUS_USER_ID } from '../../core/ids.js';

const POST_ID = 'post-1';
const USER = '11111111-1111-1111-1111-111111111111';
const USER2 = '22222222-2222-2222-2222-222222222222';

function seedPost(over: Partial<FakePost> = {}): FakePost {
  const p: FakePost = {
    id: POST_ID,
    tabCode: 'ai',
    title: 'Million-View AI cat dance video',
    imgUrl: '/sites/vutu/showcase/row-03.jpg',
    assetId: null,
    views: 0,
    likes: 0,
    copies: 0,
    sort: 0,
    active: true,
    createdAt: new Date('2025-01-01T00:00:00Z'),
    ...over,
  };
  store.posts.push(p);
  return p;
}

beforeEach(() => {
  store.timezone = 'Asia/Shanghai';
  store.posts = [];
  store.tabs = [];
  store.events = [];
  store.eventSeq = 0;
  redisStore.clear();
});

// ================================================================ 列表

describe('GET /v1/prompt-library 数据形状', () => {
  beforeEach(() => {
    store.tabs = [
      { code: 'game', labelI18n: { en: 'Game', 'zh-CN': '游戏' }, sort: 1, active: true },
      { code: 'music', labelI18n: { en: 'Music', 'zh-CN': '音乐' }, sort: 2, active: true },
      { code: 'inactive', labelI18n: {}, sort: 3, active: false },
    ];
    seedPost({ id: 'p1', tabCode: 'game', title: 'Game CG', views: 210000, likes: 8100 });
    seedPost({ id: 'p2', tabCode: 'music', title: 'Fashion MV', views: 150000, likes: 5400 });
  });

  it('返回 { tabs, cards }', async () => {
    const lib = await listLibrary({});
    expect(Array.isArray(lib.tabs)).toBe(true);
    expect(Array.isArray(lib.cards)).toBe(true);
  });

  it('tabs 首位恒为 all（前端"全部"按钮的约定值）', async () => {
    const lib = await listLibrary({});
    expect(lib.tabs[0]?.id).toBe('all');
    expect(lib.tabs[0]?.labelI18n['zh-CN']).toBe('全部');
    expect(lib.tabs[0]?.labelI18n['en']).toBe('All');
  });

  it('all 的 11 语种文案齐全', async () => {
    const lib = await listLibrary({});
    const all = lib.tabs[0]!;
    for (const l of ['en', 'zh-TW', 'zh-CN', 'ja', 'ko', 'es', 'fr', 'de', 'it', 'pt', 'ru']) {
      expect(all.labelI18n[l], l).toBeTruthy();
    }
  });

  it('只返回 active tab（inactive 被过滤）', async () => {
    const lib = await listLibrary({});
    expect(lib.tabs.map((t) => t.id)).toEqual(['all', 'game', 'music']);
  });

  it('cards 含 id/title/img/cat/views/likes', async () => {
    const lib = await listLibrary({});
    const card = lib.cards.find((c) => c.id === 'p1')!;
    expect(card).toMatchObject({
      id: 'p1',
      title: 'Game CG',
      img: '/sites/vutu/showcase/row-03.jpg',
      cat: 'game',
      views: 210000,
      likes: 8100,
    });
  });

  it('★ views/likes 取**实时计数**（读列，不硬编码）', async () => {
    const before = await listLibrary({});
    expect(before.cards.find((c) => c.id === 'p1')!.views).toBe(210000);

    // 模拟计数变化
    store.posts.find((p) => p.id === 'p1')!.views = 999999;
    const after = await listLibrary({});
    expect(after.cards.find((c) => c.id === 'p1')!.views).toBe(999999);
  });

  it('?cat= 筛选生效', async () => {
    const lib = await listLibrary({ cat: 'game' });
    expect(lib.cards).toHaveLength(1);
    expect(lib.cards[0]!.cat).toBe('game');
  });

  it('?cat=all 返回全部', async () => {
    expect((await listLibrary({ cat: 'all' })).cards).toHaveLength(2);
  });

  it('cards 含 prompt（= title，供深链预填）', async () => {
    const lib = await listLibrary({});
    expect(lib.cards[0]!.prompt).toBe(lib.cards[0]!.title);
  });

  it('空库返回空 cards 但仍有 all tab', async () => {
    store.posts = [];
    store.tabs = [];
    const lib = await listLibrary({});
    expect(lib.cards).toEqual([]);
    expect(lib.tabs).toHaveLength(1);
    expect(lib.tabs[0]?.id).toBe('all');
  });

  it('inactive post 不下发', async () => {
    seedPost({ id: 'p3', active: false });
    const lib = await listLibrary({});
    expect(lib.cards.find((c) => c.id === 'p3')).toBeUndefined();
  });
});

// ================================================================ 匿名哨兵

describe('⚠️ 匿名哨兵 UUID（详细设计 §1.9）', () => {
  beforeEach(() => seedPost());

  it('哨兵常量是约定的全零 UUID', () => {
    expect(ANONYMOUS_USER_ID).toBe('00000000-0000-0000-0000-000000000000');
  });

  it('匿名 view 写入的是哨兵 UUID（**不是 NULL**）', async () => {
    await recordView({ postId: POST_ID, userId: ANONYMOUS_USER_ID, timezone: ANON_TIMEZONE });
    expect(store.events).toHaveLength(1);
    expect(store.events[0]!.userId).toBe(ANONYMOUS_USER_ID);
    expect(store.events[0]!.userId).not.toBeNull();
  });

  it('★ 同一匿名用户同一天重复 view 不累加（唯一键因哨兵 UUID 而生效）', async () => {
    const at = new Date('2025-01-01T10:00:00Z');
    const d = eventDate(ANON_TIMEZONE, at);

    const r1 = await recordEvent({ postId: POST_ID, userId: ANONYMOUS_USER_ID, event: 'view', date: d });
    const r2 = await recordEvent({ postId: POST_ID, userId: ANONYMOUS_USER_ID, event: 'view', date: d });

    expect(r1.first).toBe(true);
    expect(r1.counters.views).toBe(1);
    expect(r2.first).toBe(false); // 去重
    expect(r2.counters.views).toBe(1); // ★ 没有被刷到 2
    expect(store.events).toHaveLength(1);
  });

  it('★ 反例证明：若 userId 为 NULL 唯一键失效（模拟 PG 语义）', async () => {
    // PG 中 NULL != NULL，唯一键不会拦住重复的 NULL 行。
    // 这里用一个"不检查 NULL 重复"的假 DB 证明后果，从而固化"必须用哨兵 UUID"这一结论。
    const nullevents: FakeEvent[] = [];
    const pgSemantics = (a: string | null, b: string | null) => a !== null && b !== null && a === b;

    for (let i = 0; i < 5; i += 1) {
      const dup = nullevents.find(
        (e) => e.postId === POST_ID && pgSemantics(e.userId as string | null, null) && e.event === 'view',
      );
      expect(dup).toBeUndefined(); // 永远找不到重复 → 永远插入成功
      nullevents.push({
        id: `n-${i}`,
        postId: POST_ID,
        userId: null as unknown as string,
        event: 'view',
        date: new Date(),
        createdAt: new Date(),
      });
    }
    expect(nullevents).toHaveLength(5); // 可无限刷
  });

  it('哨兵模式下同样只能计 1 次（与上面的反例对照）', async () => {
    const at = new Date('2025-01-01T10:00:00Z');
    const d = eventDate(ANON_TIMEZONE, at);
    for (let i = 0; i < 5; i += 1) {
      await recordEvent({ postId: POST_ID, userId: ANONYMOUS_USER_ID, event: 'view', date: d });
    }
    expect(store.events).toHaveLength(1);
    expect(store.posts[0]!.views).toBe(1);
  });
});

describe('匿名 IP 限频（Redis 1 次/天/事件）', () => {
  it('首次放行，同日重复被拒', async () => {
    expect(await allowAnonymous('1.2.3.4', 'view')).toBe(true);
    expect(await allowAnonymous('1.2.3.4', 'view')).toBe(false);
  });

  it('不同事件各自独立计数', async () => {
    expect(await allowAnonymous('1.2.3.4', 'view')).toBe(true);
    expect(await allowAnonymous('1.2.3.4', 'copy')).toBe(true);
  });

  it('不同 IP 各自独立', async () => {
    expect(await allowAnonymous('1.2.3.4', 'view')).toBe(true);
    expect(await allowAnonymous('5.6.7.8', 'view')).toBe(true);
  });

  it('Redis 挂掉时放行（不因限流组件故障导致提示词库不可用）', async () => {
    const redisMod = await import('../../core/redis.js');
    const spy = vi.spyOn(redisMod, 'redis').mockReturnValue({
      set: async () => {
        throw new Error('redis down');
      },
    } as unknown as ReturnType<typeof redisMod.redis>);
    expect(await allowAnonymous('9.9.9.9', 'view')).toBe(true);
    spy.mockRestore();
  });
});

// ================================================================ 计数器

describe('⚠️ 原子计数器（PRD §8.8）', () => {
  beforeEach(() => seedPost());

  it('首次 view 使 views +1', async () => {
    const r = await recordView({ postId: POST_ID, userId: USER, timezone: 'Asia/Shanghai' });
    expect(r.counted).toBe(true);
    expect(r.views).toBe(1);
  });

  it('同用户同日重复 view（同本地日）不累加', async () => {
    const at = new Date('2025-01-01T10:00:00Z');
    const d = eventDate('Asia/Shanghai', at);
    await recordEvent({ postId: POST_ID, userId: USER, event: 'view', date: d });
    const r2 = await recordEvent({ postId: POST_ID, userId: USER, event: 'view', date: d });
    expect(r2.first).toBe(false);
    expect(r2.counters.views).toBe(1);
  });

  it('不同用户各计一次', async () => {
    const at = new Date('2025-01-01T10:00:00Z');
    const d = eventDate('Asia/Shanghai', at);
    await recordEvent({ postId: POST_ID, userId: USER, event: 'view', date: d });
    await recordEvent({ postId: POST_ID, userId: USER2, event: 'view', date: d });
    expect(store.posts[0]!.views).toBe(2);
  });

  it('同一用户不同日各计一次（第二天可再计）', async () => {
    await recordEvent({
      postId: POST_ID,
      userId: USER,
      event: 'view',
      date: eventDate('Asia/Shanghai', new Date('2025-01-01T10:00:00Z')),
    });
    await recordEvent({
      postId: POST_ID,
      userId: USER,
      event: 'view',
      date: eventDate('Asia/Shanghai', new Date('2025-01-02T10:00:00Z')),
    });
    expect(store.posts[0]!.views).toBe(2);
  });

  it('copy 计数走 copies 列（不动 views）', async () => {
    const r = await recordCopy({ postId: POST_ID, userId: USER, timezone: 'Asia/Shanghai' });
    expect(r.copies).toBe(1);
    expect(store.posts[0]!.views).toBe(0);
    expect(store.posts[0]!.copies).toBe(1);
  });

  it('copy 返回原文 title（供剪贴板）', async () => {
    const r = await recordCopy({ postId: POST_ID, userId: USER, timezone: 'Asia/Shanghai' });
    expect(r.title).toBe('Million-View AI cat dance video');
  });

  it('view 与 copy 是不同事件，同一天可各计一次', async () => {
    const d = eventDate('Asia/Shanghai', new Date('2025-01-01T10:00:00Z'));
    await recordEvent({ postId: POST_ID, userId: USER, event: 'view', date: d });
    await recordEvent({ postId: POST_ID, userId: USER, event: 'copy', date: d });
    expect(store.posts[0]!.views).toBe(1);
    expect(store.posts[0]!.copies).toBe(1);
  });

  it('post 不存在 → 404 NOT_FOUND', async () => {
    await expect(
      recordEvent({ postId: 'nope', userId: USER, event: 'view', date: new Date() }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

// ================================================================ like 切换

describe('⚠️ like 切换语义（详细设计 §1.9：不参与唯一键去重）', () => {
  beforeEach(() => seedPost());

  it('首次 like → liked:true, likes:1', async () => {
    const r = await toggleLike({ postId: POST_ID, userId: USER, timezone: 'Asia/Shanghai' });
    expect(r).toEqual({ liked: true, likes: 1 });
  });

  it('再次 like → 取消 → liked:false, likes:0', async () => {
    await toggleLike({ postId: POST_ID, userId: USER, timezone: 'Asia/Shanghai' });
    const r = await toggleLike({ postId: POST_ID, userId: USER, timezone: 'Asia/Shanghai' });
    expect(r).toEqual({ liked: false, likes: 0 });
  });

  it('反复切换 10 次后状态正确（奇数次=已赞）', async () => {
    let last = { liked: false, likes: 0 };
    for (let i = 0; i < 10; i += 1) {
      last = await toggleLike({ postId: POST_ID, userId: USER, timezone: 'Asia/Shanghai' });
    }
    expect(last.liked).toBe(false);
    expect(last.likes).toBe(0);

    last = await toggleLike({ postId: POST_ID, userId: USER, timezone: 'Asia/Shanghai' });
    expect(last.liked).toBe(true);
    expect(last.likes).toBe(1);
  });

  it('★ 同一天内多次切换：当天最新事件恒为最终状态（不因唯一键判反）', async () => {
    const tz = 'Asia/Shanghai';
    await toggleLike({ postId: POST_ID, userId: USER, timezone: tz }); // like
    await toggleLike({ postId: POST_ID, userId: USER, timezone: tz }); // unlike
    await toggleLike({ postId: POST_ID, userId: USER, timezone: tz }); // like

    // 事件表按"覆盖当天"维护，只保留一条且与最终状态一致
    const likeEvents = store.events.filter((e) => e.userId === USER && (e.event === 'like' || e.event === 'unlike'));
    expect(likeEvents).toHaveLength(1);
    expect(likeEvents[0]!.event).toBe('like');
    expect(await likedBy(POST_ID, USER)).toBe(true);
  });

  it('不同用户的点赞互不影响，计数累加', async () => {
    await toggleLike({ postId: POST_ID, userId: USER, timezone: 'Asia/Shanghai' });
    const r = await toggleLike({ postId: POST_ID, userId: USER2, timezone: 'Asia/Shanghai' });
    expect(r.likes).toBe(2);
  });

  it('likedBy 反映最新状态', async () => {
    expect(await likedBy(POST_ID, USER)).toBe(false);
    await toggleLike({ postId: POST_ID, userId: USER, timezone: 'Asia/Shanghai' });
    expect(await likedBy(POST_ID, USER)).toBe(true);
    await toggleLike({ postId: POST_ID, userId: USER, timezone: 'Asia/Shanghai' });
    expect(await likedBy(POST_ID, USER)).toBe(false);
  });

  it('计数不会被切换打到负数', async () => {
    // 人为把 likes 置 0 后 unlike（防御异常数据）
    store.posts[0]!.likes = 0;
    const fake = await import('./service.js');
    const likes = await fake.adjustLikes(POST_ID, -1);
    expect(likes).toBe(0);
    expect(store.posts[0]!.likes).toBeGreaterThanOrEqual(0);
  });

  it('post 不存在 → 404', async () => {
    await expect(
      toggleLike({ postId: 'nope', userId: USER, timezone: 'Asia/Shanghai' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

// ================================================================ 本地日

describe('date 按用户时区换算（详细设计 §1.9）', () => {
  it('东八区：UTC 17:00 → 次日', () => {
    const d = eventDate('Asia/Shanghai', new Date('2025-01-01T17:00:00Z'));
    expect(dateKey(d)).toBe('2025-01-02');
  });

  it('美东：UTC 17:00 → 当日', () => {
    const d = eventDate('America/New_York', new Date('2025-01-01T17:00:00Z'));
    expect(dateKey(d)).toBe('2025-01-01');
  });

  it('匿名固定 Asia/Shanghai', () => {
    expect(ANON_TIMEZONE).toBe('Asia/Shanghai');
    const d = eventDate(ANON_TIMEZONE, new Date('2025-01-01T17:00:00Z'));
    expect(dateKey(d)).toBe('2025-01-02');
  });

  it('eventDateKey 与 eventDate 一致（Redis 键与 DB 列同源）', () => {
    const at = new Date('2025-06-15T07:33:21Z');
    expect(eventDateKey('Asia/Tokyo', at)).toBe(eventDate('Asia/Tokyo', at).toISOString().slice(0, 10));
  });

  it('不同时区在跨日边界产生不同事件日（去重口径按用户本地日）', () => {
    const at = new Date('2025-01-01T17:00:00Z');
    expect(dateKey(eventDate('Asia/Shanghai', at))).not.toBe(dateKey(eventDate('America/New_York', at)));
  });
});

// ================================================================ 计数一致性

describe('列表与事件的一致性', () => {
  beforeEach(() => seedPost());

  it('记录 view 后列表返回的 views 同步变化', async () => {
    await recordView({ postId: POST_ID, userId: USER, timezone: 'Asia/Shanghai' });
    const lib = await listLibrary({});
    expect(lib.cards[0]!.views).toBe(1);
  });

  it('记录 copy 后列表返回的 copies 同步变化', async () => {
    await recordCopy({ postId: POST_ID, userId: USER, timezone: 'Asia/Shanghai' });
    const lib = await listLibrary({});
    expect(lib.cards[0]!.copies).toBe(1);
  });

  it('like 后列表返回的 likes 同步变化', async () => {
    await toggleLike({ postId: POST_ID, userId: USER, timezone: 'Asia/Shanghai' });
    const lib = await listLibrary({});
    expect(lib.cards[0]!.likes).toBe(1);
  });
});
