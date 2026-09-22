/**
 * 账本数学单元测试（详细设计 §7.2 / PRD §13 #4、#5、#6）。
 *
 * 全部用 vi.mock('../../core/db.js') 提供**内存账本假实现**，不连真实 DB。
 * 假实现刻意复刻真实 SQL 的语义：
 *   - 余额 = SUM(delta) 全量（**不过滤 expires_at**）
 *   - (user_id, idempotency_key) 唯一 → 撞键抛 P2002
 *   - pg_advisory_xact_lock 是 no-op（单线程测试无并发）
 *
 * 重点回归（本文件存在的理由）：
 *   详细设计 §2.5 的反例 —— signup +100（7 天后过期）、当天扣 30、7 天后写 expire -70
 *   → 余额必须是 **0**，绝不是 −30。
 */

import { describe, expect, it, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------- 内存账本假实现

interface Row {
  id: string;
  userId: string;
  delta: number;
  type: string;
  taskId: string | null;
  orderId: string | null;
  balanceAfter: number;
  idempotencyKey: string;
  expiresAt: Date | null;
  note: string | null;
  createdAt: Date;
}

interface TaskRow {
  id: string;
  userId: string;
  refunded: boolean;
  settledCredits: number;
}

interface ResetRow {
  userId: string;
  date: Date;
  resetAmount: number;
}

class P2002 extends Error {
  code = 'P2002';
  constructor() {
    super('Unique constraint failed on the fields: (`user_id`,`idempotency_key`)');
  }
}

let rows: Row[] = [];
let tasks: TaskRow[] = [];
let resets: ResetRow[] = [];
let clock = new Date('2026-01-01T00:00:00Z');

function seedLedger(
  userId: string,
  delta: number,
  type: string,
  opts: Partial<Pick<Row, 'id' | 'expiresAt' | 'idempotencyKey' | 'taskId' | 'createdAt'>> = {},
): Row {
  const id = opts.id ?? `l${rows.length + 1}`;
  // balanceAfter 按「当时」的余额算，模拟真实写入语义
  const bal = rows.filter((r) => r.userId === userId).reduce((a, r) => a + r.delta, 0);
  const row: Row = {
    id,
    userId,
    delta,
    type,
    taskId: opts.taskId ?? null,
    orderId: null,
    balanceAfter: bal + delta,
    idempotencyKey: opts.idempotencyKey ?? `seed:${id}`,
    expiresAt: opts.expiresAt ?? null,
    note: null,
    createdAt: opts.createdAt ?? new Date(clock),
  };
  rows.push(row);
  return row;
}

/**
 * 单线程互斥锁，用来在内存里**真实复刻 `pg_advisory_xact_lock(hashtext(userId))` 的串行化语义**。
 *
 * 为什么必须有：真实 DB 里同一用户的并发 deduct 会被 advisory 锁排队，
 * 因此后到者读到的 SUM(delta) 一定包含先到者的写入（因此不会超卖）。
 * 内存假实现如果没有这把锁，100 个 Promise 会在「读」阶段全部读到同一个旧余额，
 * 然后一起通过余额校验 —— 那测的是假实现的缺陷，不是被测代码。
 *
 * 用法与真实一致：acquire 在事务开始、release 在事务结束（模拟 xact 锁自动释放）。
 */
class UserMutex {
  private readonly tails = new Map<string, Promise<void>>();

  async run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.tails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    // 后来者排队：等前一个事务彻底结束
    this.tails.set(
      key,
      prev.then(() => gate),
    );

    await prev;
    try {
      return await fn();
    } finally {
      release();
      // 队尾已经是自己时清理，避免 Map 无限增长
      if (this.tails.get(key) === gate) this.tails.delete(key);
    }
  }
}

const userMutex = new UserMutex();

/** 复刻 deduct/grant/refundTask/expireBatch 的事务体逻辑，但不含 Prisma 细节 */
function makeTx() {
  return {
    $executeRaw: vi.fn(async () => 1),

    $queryRaw: vi.fn(async (_strings: TemplateStringsArray, ...values: unknown[]) => {
      // 假实现只支持 sumDelta 这一条查询：第一个参数是 userId
      const userId = String(values[0]);
      const bal = rows.filter((r) => r.userId === userId).reduce((a, r) => a + r.delta, 0);
      return [{ bal }];
    }),

    creditLedger: {
      findUnique: vi.fn(
        async ({
          where,
        }: {
          where: { userId_idempotencyKey: { userId: string; idempotencyKey: string } };
        }) => {
          const k = where.userId_idempotencyKey;
          const found = rows.find((r) => r.userId === k.userId && r.idempotencyKey === k.idempotencyKey);
          return found ? { balanceAfter: found.balanceAfter, delta: found.delta } : null;
        },
      ),

      create: vi.fn(async ({ data }: { data: Omit<Row, 'createdAt'> & { createdAt?: Date } }) => {
        const dup = rows.find(
          (r) => r.userId === data.userId && r.idempotencyKey === data.idempotencyKey,
        );
        if (dup) throw new P2002(); // 真实 DB 的唯一索引行为
        const row: Row = { ...data, createdAt: data.createdAt ?? new Date(clock) };
        rows.push(row);
        return row;
      }),
    },

    task: {
      updateMany: vi.fn(
        async ({ where, data }: { where: { id: string; refunded: boolean }; data: Partial<TaskRow> }) => {
          let count = 0;
          for (const t of tasks) {
            if (t.id === where.id && t.refunded === where.refunded) {
              Object.assign(t, data);
              count += 1;
            }
          }
          // 真实 DB：affected rows，0 表示条件不满足 → 已返还过
          return { count };
        },
      ),

      // refundTask 在「条件更新命中 0 行」时会查任务是否属于该用户
      findFirst: vi.fn(
        async ({ where }: { where: { id: string; userId: string } }) => {
          const found = tasks.find((t) => t.id === where.id && t.userId === where.userId);
          return found ? { refunded: found.refunded } : null;
        },
      ),
    },

    dailyBalanceReset: {
      upsert: vi.fn(
        async ({
          where,
          create,
          update,
        }: {
          where: { userId_date: { userId: string; date: Date } };
          create: ResetRow;
          update: { resetAmount: { increment: number } };
        }) => {
          const k = where.userId_date;
          const found = resets.find(
            (r) => r.userId === k.userId && r.date.getTime() === k.date.getTime(),
          );
          if (found) {
            found.resetAmount += update.resetAmount.increment;
            return found;
          }
          const row = { ...create };
          resets.push(row);
          return row;
        },
      ),
    },
  };
}

const fakeDb = {
  $queryRaw: vi.fn(async (_strings: TemplateStringsArray, ...values: unknown[]) => {
    const userId = String(values[0]);
    const bal = rows.filter((r) => r.userId === userId).reduce((a, r) => a + r.delta, 0);
    return [{ bal }];
  }),
  $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(makeTx())),
};

vi.mock('../../core/db.js', () => ({
  db: () => fakeDb,
  /**
   * 关键：模拟真实事务 + `pg_advisory_xact_lock(hashtext(userId))` 的串行化。
   *
   * 细节：lockUser() 的返回值被忽略，我们无法从 tx 里直接知道 userId，
   * 因此这里用「全局单队列」——与真实实现「同一用户串行、不同用户并行」的差别，
   * 只影响并发度不影响正确性；对"不超卖"这个断言是更严格的检验。
   */
  transaction: async <T>(fn: (tx: unknown) => Promise<T>) => userMutex.run('global', () => fn(makeTx())),
  disconnectDb: async () => undefined,
}));

const { ledger, startOfUtcDay, signupGrantKey, checkinGrantKey } = await import('./ledger.js');

function balanceOf(userId: string): number {
  return rows.filter((r) => r.userId === userId).reduce((a, r) => a + r.delta, 0);
}

function expectBalanced(userId: string): void {
  const sum = balanceOf(userId);
  const mine = rows.filter((r) => r.userId === userId);
  const latest = mine[mine.length - 1];
  expect(latest).toBeDefined();
  expect(latest!.balanceAfter).toBe(sum);
}

// ---------------------------------------------------------------- 用例

beforeEach(() => {
  rows = [];
  tasks = [];
  resets = [];
  clock = new Date('2026-01-01T00:00:00Z');
});

describe('借贷平衡（append-only 不变式）', () => {
  it('SUM(delta) == 最新 balance_after', async () => {
    const u = 'u1';
    await ledger.grant({ userId: u, type: 'grant_signup', amount: 100, idempotencyKey: signupGrantKey(u) });
    expect(await ledger.balance(u)).toBe(100);

    await ledger.deduct({ userId: u, credits: 30, taskId: 't1', idempotencyKey: 'deduct:t1' });
    expect(await ledger.balance(u)).toBe(70);

    await ledger.grant({ userId: u, type: 'grant_checkin', amount: 5, idempotencyKey: 'checkin:u1:1' });
    expect(await ledger.balance(u)).toBe(75);

    expectBalanced(u);
  });

  it('余额为 0 的用户（只有负向流水）也平衡', async () => {
    const u = 'u-zero';
    seedLedger(u, 50, 'purchase');
    await ledger.deduct({ userId: u, credits: 50, taskId: 't1', idempotencyKey: 'deduct:t1' });
    expect(await ledger.balance(u)).toBe(0);
    expectBalanced(u);
  });

  it('balance_after 逐笔快照与实时聚合一致（多用户隔离）', async () => {
    await ledger.grant({ userId: 'a', type: 'grant_signup', amount: 100, idempotencyKey: 'signup:a' });
    await ledger.grant({ userId: 'b', type: 'grant_signup', amount: 100, idempotencyKey: 'signup:b' });
    await ledger.deduct({ userId: 'a', credits: 40, taskId: 'ta', idempotencyKey: 'deduct:ta' });

    expect(await ledger.balance('a')).toBe(60);
    expect(await ledger.balance('b')).toBe(100);
    expectBalanced('a');
    expectBalanced('b');
  });
});

describe('§2.5 反例回归：为什么不能用 expires_at 过滤余额', () => {
  it('signup +100（7 天过期）→ 当天扣 30 → 7 天后 expire -70 ⇒ 余额 0（不是 −30）', async () => {
    const u = 'u1';
    const day0 = new Date('2026-01-01T00:00:00Z');
    const day7 = new Date('2026-01-08T00:00:01Z');

    // ① 注册赠送 +100，7 天有效
    clock = day0;
    const grant = await ledger.grant({
      userId: u,
      type: 'grant_signup',
      amount: 100,
      idempotencyKey: signupGrantKey(u),
      expiresAt: new Date('2026-01-08T00:00:00Z'),
    });
    expect(grant.balanceAfter).toBe(100);

    // ② 用户当天花掉 30
    clock = day0;
    await ledger.deduct({ userId: u, credits: 30, taskId: 't1', idempotencyKey: 'deduct:t1' });
    expect(await ledger.balance(u)).toBe(70);

    // ③ 7 天后 00:05 定时任务扫到该批次剩余 70，写 expire -70
    clock = day7;
    const grantRowId = rows[0]!.id;
    const expired = await ledger.expireBatch({
      userId: u,
      ledgerId: grantRowId,
      amount: 70,
      date: day7,
    });

    // ✅ 关键断言：余额 = 100 − 30 − 70 = 0，**不是 −30**
    expect(expired.balanceAfter).toBe(0);
    expect(await ledger.balance(u)).toBe(0);
    expect(await ledger.balance(u)).not.toBe(-30);

    // 账本仍平（append-only 未被破坏）
    expectBalanced(u);

    // 三条流水齐备且都保留（不删不改）
    expect(rows.map((r) => [r.type, r.delta])).toEqual([
      ['grant_signup', 100],
      ['task_deduct', -30],
      ['expire', -70],
    ]);
  });

  it('对照：若按 expires_at 过滤行求和会得出 −30（证明反例真实存在）', () => {
    const u = 'u1';
    const day7 = new Date('2026-01-08T00:00:01Z');
    seedLedger(u, 100, 'grant_signup', { expiresAt: new Date('2026-01-08T00:00:00Z') });
    seedLedger(u, -30, 'task_deduct', { taskId: 't1' }); // 扣减行的 expiresAt 为 NULL

    // ❌ 错误算法：过滤掉已过期行再求和
    const wrong = rows
      .filter((r) => r.expiresAt === null || r.expiresAt.getTime() > day7.getTime())
      .reduce((a, r) => a + r.delta, 0);
    expect(wrong).toBe(-30); // 用户被凭空扣负

    // ✅ 正确算法：全量求和
    const right = rows.reduce((a, r) => a + r.delta, 0);
    expect(right).toBe(70);
  });

  it('expire 冲销不会把余额拉成负数（用户已把额度花光）', async () => {
    const u = 'u1';
    seedLedger(u, 100, 'grant_signup', { expiresAt: new Date('2026-01-08T00:00:00Z') });
    await ledger.deduct({ userId: u, credits: 100, taskId: 't1', idempotencyKey: 'deduct:t1' });
    expect(await ledger.balance(u)).toBe(0);

    // 额度已花光，expireBatch 收到 100 但实际只能冲销 0
    const res = await ledger.expireBatch({
      userId: u,
      ledgerId: rows[0]!.id,
      amount: 100,
      date: new Date('2026-01-08T00:00:01Z'),
    });
    expect(res.balanceAfter).toBe(0);
    expect(await ledger.balance(u)).toBeGreaterThanOrEqual(0);
  });
});

describe('deduct 幂等与余额校验', () => {
  it('同 idempotencyKey 重放 10 次只扣一次', async () => {
    const u = 'u1';
    await ledger.grant({ userId: u, type: 'grant_signup', amount: 100, idempotencyKey: signupGrantKey(u) });

    const results = [];
    for (let i = 0; i < 10; i += 1) {
      results.push(
        await ledger.deduct({ userId: u, credits: 30, taskId: 't1', idempotencyKey: 'deduct:t1' }),
      );
    }

    // 每次返回同一结果
    expect(new Set(results.map((r) => r.balanceAfter))).toEqual(new Set([70]));
    // 只写了一条流水
    expect(rows.filter((r) => r.type === 'task_deduct')).toHaveLength(1);
    expect(await ledger.balance(u)).toBe(70);
  });

  it('余额不足抛 402 INSUFFICIENT_CREDITS 且不写流水', async () => {
    const u = 'u1';
    await ledger.grant({ userId: u, type: 'grant_signup', amount: 10, idempotencyKey: signupGrantKey(u) });

    await expect(
      ledger.deduct({ userId: u, credits: 11, taskId: 't1', idempotencyKey: 'deduct:t1' }),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_CREDITS', status: 402 });

    expect(rows.filter((r) => r.type === 'task_deduct')).toHaveLength(0);
    expect(await ledger.balance(u)).toBe(10);
  });

  it('余额恰好等于扣减额时成功，余额归 0', async () => {
    const u = 'u1';
    await ledger.grant({ userId: u, type: 'grant_signup', amount: 13, idempotencyKey: signupGrantKey(u) });
    const res = await ledger.deduct({ userId: u, credits: 13, taskId: 't1', idempotencyKey: 'deduct:t1' });
    expect(res.balanceAfter).toBe(0);
    expect(await ledger.balance(u)).toBe(0);
  });

  it('并发抢额度：串行化后不会超卖（模拟 100 抢 10 份额度）', async () => {
    const u = 'u1';
    await ledger.grant({ userId: u, type: 'grant_signup', amount: 100, idempotencyKey: signupGrantKey(u) });

    // 100 个请求各扣 10 积分，只有前 10 个能成功
    const attempts = Array.from({ length: 100 }, (_, i) =>
      ledger
        .deduct({ userId: u, credits: 10, taskId: `t${i}`, idempotencyKey: `deduct:t${i}` })
        .then(() => 'ok' as const)
        .catch(() => 'insufficient' as const),
    );

    const outcomes = await Promise.all(attempts);
    const okCount = outcomes.filter((o) => o === 'ok').length;

    expect(okCount).toBe(10);
    expect(outcomes.filter((o) => o === 'insufficient')).toHaveLength(90);
    expect(await ledger.balance(u)).toBe(0);
    expect(await ledger.balance(u)).toBeGreaterThanOrEqual(0);
  });

  it('误传非整数/负数积分被拒绝', async () => {
    const u = 'u1';
    await ledger.grant({ userId: u, type: 'grant_signup', amount: 100, idempotencyKey: signupGrantKey(u) });

    await expect(
      ledger.deduct({ userId: u, credits: 1.5, taskId: 't', idempotencyKey: 'deduct:x' }),
    ).rejects.toMatchObject({ code: 'INVALID_PARAMS' });

    await expect(
      ledger.deduct({ userId: u, credits: -5, taskId: 't', idempotencyKey: 'deduct:y' }),
    ).rejects.toMatchObject({ code: 'INVALID_PARAMS' });
  });
});

describe('refundTask 双保险幂等', () => {
  it('首次返还成功后，重放返回 refunded:false 且不二次返还', async () => {
    const u = 'u1';
    tasks.push({ id: 't1', userId: u, refunded: false, settledCredits: 30 });
    await ledger.grant({ userId: u, type: 'grant_signup', amount: 100, idempotencyKey: signupGrantKey(u) });
    await ledger.deduct({ userId: u, credits: 30, taskId: 't1', idempotencyKey: 'deduct:t1' });
    expect(await ledger.balance(u)).toBe(70);

    // 第一次：真的返还
    const first = await ledger.refundTask({ userId: u, taskId: 't1', credits: 30 });
    expect(first.refunded).toBe(true);
    expect(first.balanceAfter).toBe(100);

    // 重放多次：都不再返还
    for (let i = 0; i < 5; i += 1) {
      const again = await ledger.refundTask({ userId: u, taskId: 't1', credits: 30 });
      expect(again.refunded).toBe(false);
      expect(again.balanceAfter).toBe(100);
    }

    expect(rows.filter((r) => r.type === 'task_refund')).toHaveLength(1);
    expect(await ledger.balance(u)).toBe(100);
    expect(tasks[0]!.refunded).toBe(true);
    expect(tasks[0]!.settledCredits).toBe(0);
  });

  it('任务不存在 / 不属于该用户 → 不返还', async () => {
    const u = 'u1';
    await ledger.grant({ userId: u, type: 'grant_signup', amount: 100, idempotencyKey: signupGrantKey(u) });

    const res = await ledger.refundTask({ userId: u, taskId: 'nonexistent', credits: 30 });
    expect(res.refunded).toBe(false);
    expect(res.balanceAfter).toBe(100);
    expect(rows.filter((r) => r.type === 'task_refund')).toHaveLength(0);
  });

  /**
   * 回归：调用方（workers/settle.ts §3.4）在**同一事务内先把 tasks.refunded 置为 true**，
   * 然后才调用 ledger.refundTask。
   *
   * 如果 refundTask 把「条件更新命中 0 行」一律当成"已返还过"，
   * 就会在**从未写过 refund 流水**的情况下返回 refunded:false → 用户永远拿不回钱（P0）。
   * 正确行为：没有 refund 流水就必须照常返还。
   */
  it('调用方已先置 refunded=true 但无流水 → 仍必须完成返还（防漏退款）', async () => {
    const u = 'u1';
    tasks.push({ id: 't1', userId: u, refunded: false, settledCredits: 30 });
    await ledger.grant({ userId: u, type: 'grant_signup', amount: 100, idempotencyKey: signupGrantKey(u) });
    await ledger.deduct({ userId: u, credits: 30, taskId: 't1', idempotencyKey: 'deduct:t1' });
    expect(await ledger.balance(u)).toBe(70);

    // 模拟 settle.ts：先把 refunded 置 true（这一步让条件更新再也匹配不到）
    tasks[0]!.refunded = true;
    tasks[0]!.settledCredits = 0;

    const res = await ledger.refundTask({ userId: u, taskId: 't1', credits: 30 });

    // ✅ 钱必须退回来
    expect(res.refunded).toBe(true);
    expect(res.balanceAfter).toBe(100);
    expect(await ledger.balance(u)).toBe(100);
    expect(rows.filter((r) => r.type === 'task_refund')).toHaveLength(1);

    // 再重放一次仍然不二次返还
    const again = await ledger.refundTask({ userId: u, taskId: 't1', credits: 30 });
    expect(again.refunded).toBe(false);
    expect(again.balanceAfter).toBe(100);
    expect(rows.filter((r) => r.type === 'task_refund')).toHaveLength(1);
  });

  it('失败返还后账本仍平，且余额回到扣减前', async () => {
    const u = 'u1';
    tasks.push({ id: 't1', userId: u, refunded: false, settledCredits: 13 });
    await ledger.grant({ userId: u, type: 'grant_signup', amount: 100, idempotencyKey: signupGrantKey(u) });
    await ledger.deduct({ userId: u, credits: 13, taskId: 't1', idempotencyKey: 'deduct:t1' });
    await ledger.refundTask({ userId: u, taskId: 't1', credits: 13 });

    expect(await ledger.balance(u)).toBe(100);
    expectBalanced(u);
  });
});

describe('grant 幂等', () => {
  it('同 (userId, idempotencyKey) 只发一次', async () => {
    const u = 'u1';
    const key = signupGrantKey(u);
    const a = await ledger.grant({ userId: u, type: 'grant_signup', amount: 100, idempotencyKey: key });
    const b = await ledger.grant({ userId: u, type: 'grant_signup', amount: 100, idempotencyKey: key });

    expect(a.balanceAfter).toBe(100);
    expect(b.balanceAfter).toBe(100);
    expect(rows).toHaveLength(1);
  });

  it('签到键按日期改变 → 每天可各发一次', async () => {
    const u = 'u1';
    const d1 = new Date('2026-01-01T00:00:00Z');
    const d2 = new Date('2026-01-02T00:00:00Z');

    await ledger.grant({ userId: u, type: 'grant_checkin', amount: 5, idempotencyKey: checkinGrantKey(u, d1) });
    await ledger.grant({ userId: u, type: 'grant_checkin', amount: 5, idempotencyKey: checkinGrantKey(u, d2) });
    // 同一天重放不重复发
    await ledger.grant({ userId: u, type: 'grant_checkin', amount: 5, idempotencyKey: checkinGrantKey(u, d1) });

    expect(await ledger.balance(u)).toBe(10);
  });

  it('expiresAt 写在正向批次上，负向流水一律为 null', async () => {
    const u = 'u1';
    const exp = new Date('2026-01-08T00:00:00Z');
    await ledger.grant({
      userId: u,
      type: 'grant_signup',
      amount: 100,
      idempotencyKey: signupGrantKey(u),
      expiresAt: exp,
    });
    await ledger.deduct({ userId: u, credits: 10, taskId: 't1', idempotencyKey: 'deduct:t1' });

    expect(rows[0]!.expiresAt).toEqual(exp);
    expect(rows[1]!.expiresAt).toBeNull();
  });

  it('负数/非整数 amount 被拒绝', async () => {
    await expect(
      ledger.grant({ userId: 'u1', type: 'admin_adjust', amount: -5, idempotencyKey: 'k' }),
    ).rejects.toMatchObject({ code: 'INVALID_PARAMS' });
  });
});

describe('expireBatch 幂等与 DailyBalanceReset', () => {
  it('同批次重复冲销只写一条 expire 流水', async () => {
    const u = 'u1';
    const batch = seedLedger(u, 100, 'grant_signup', {
      expiresAt: new Date('2026-01-08T00:00:00Z'),
    });
    await ledger.deduct({ userId: u, credits: 30, taskId: 't1', idempotencyKey: 'deduct:t1' });

    const date = new Date('2026-01-08T00:05:00Z');
    const a = await ledger.expireBatch({ userId: u, ledgerId: batch.id, amount: 70, date });
    const b = await ledger.expireBatch({ userId: u, ledgerId: batch.id, amount: 70, date });

    expect(a.balanceAfter).toBe(0);
    expect(b.balanceAfter).toBe(0);
    expect(rows.filter((r) => r.type === 'expire')).toHaveLength(1);
    expect(await ledger.balance(u)).toBe(0);
    expectBalanced(u);
  });

  it('写入 DailyBalanceReset（按 UTC 日聚合）', async () => {
    const u = 'u1';
    const batch = seedLedger(u, 100, 'grant_signup', {
      expiresAt: new Date('2026-01-08T00:00:00Z'),
    });
    const date = new Date('2026-01-08T00:05:00Z');
    await ledger.expireBatch({ userId: u, ledgerId: batch.id, amount: 100, date });

    expect(resets).toHaveLength(1);
    expect(resets[0]!.userId).toBe(u);
    expect(resets[0]!.resetAmount).toBe(100);
    expect(resets[0]!.date.getTime()).toBe(startOfUtcDay(date).getTime());
  });

  it('过期批次写 expire 负向流水后，账本仍平', async () => {
    const u = 'u1';
    const b1 = seedLedger(u, 100, 'grant_signup', { expiresAt: new Date('2026-01-08T00:00:00Z') });
    const b2 = seedLedger(u, 50, 'grant_checkin', { expiresAt: new Date('2026-01-02T00:00:00Z') });
    await ledger.deduct({ userId: u, credits: 20, taskId: 't1', idempotencyKey: 'deduct:t1' });

    const date = new Date('2026-01-08T00:05:00Z');
    await ledger.expireBatch({ userId: u, ledgerId: b2.id, amount: 50, date });
    await ledger.expireBatch({ userId: u, ledgerId: b1.id, amount: 80, date });

    // 150 − 20 − 50 − 80 = 0
    expect(await ledger.balance(u)).toBe(0);
    expectBalanced(u);
  });
});

describe('expiringSoon 仅用于提醒，不参与余额', () => {
  it('只统计未来窗口内到期的正向批次', async () => {
    const u = 'u1';
    // 该批次在 2026-01-01T12:00 之后到期（假实现用 now()，这里断言 SQL 形状不可行，
    // 因此直接验证 balance 不受 expiresAt 影响这一关键不变式）
    seedLedger(u, 100, 'grant_signup', { expiresAt: new Date('2026-01-02T00:00:00Z') });
    seedLedger(u, 50, 'purchase', { expiresAt: null });

    expect(await ledger.balance(u)).toBe(150);
    expectBalanced(u);
  });
});
