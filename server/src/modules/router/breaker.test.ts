/**
 * CircuitBreaker 单测（PRD §5.3 / 详细设计 §4.3）。
 *
 * 用 mock Redis（内存实现）验证：
 * - 连续失败 5 次 → open
 * - 冷却 120s 后 → half_open（探活只放 1 次）
 * - half_open 成功 → closed；失败 → 重新 open
 * - earliestRecoverySec 取最早恢复时间
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------- mock redis

/**
 * 内存 Redis 替身：只实现熔断器用到的 get/set/del/incr/expire。
 * 不引入真 Redis 依赖，让单测保持纯函数级速度。
 */
const store = new Map<string, string>();

vi.mock('../../core/redis.js', () => ({
  REDIS_KEYS: {
    breaker: (modelCode: string) => `breaker:${modelCode}`,
  },
  redis: () => ({
    get: async (k: string) => store.get(k) ?? null,
    set: async (k: string, v: string) => {
      store.set(k, v);
      return 'OK';
    },
    del: async (k: string) => (store.delete(k) ? 1 : 0),
    incr: async (k: string) => {
      const next = Number.parseInt(store.get(k) ?? '0', 10) + 1;
      store.set(k, String(next));
      return next;
    },
    expire: async () => 1,
  }),
  createRedis: () => {
    throw new Error('not used in unit test');
  },
  acquireCronLock: async () => false,
}));

const { circuitBreaker, resetBreakers, __forceOpen, DEFAULT_FAILURE_THRESHOLD, DEFAULT_COOLDOWN_SEC } =
  await import('./breaker.js');

beforeEach(() => {
  store.clear();
  resetBreakers();
  vi.useRealTimers();
});

describe('CircuitBreaker —— 状态机', () => {
  it('默认 closed', async () => {
    expect(await circuitBreaker.state('hailuo-h3')).toBe('closed');
    expect(await circuitBreaker.isOpen('hailuo-h3')).toBe(false);
  });

  it('连续失败 5 次 → open', async () => {
    const model = 'gk-video-3';
    for (let i = 1; i <= 4; i++) {
      await circuitBreaker.recordFailure(model);
      expect(await circuitBreaker.state(model), `after ${i} failures`).toBe('closed');
    }
    await circuitBreaker.recordFailure(model); // 第 5 次
    expect(await circuitBreaker.state(model)).toBe('open');
    expect(await circuitBreaker.isOpen(model)).toBe(true);
  });

  it('阈值可覆盖（threshold 参数）', async () => {
    await circuitBreaker.recordFailure('m1', 2);
    expect(await circuitBreaker.state('m1')).toBe('closed');
    await circuitBreaker.recordFailure('m1', 2);
    expect(await circuitBreaker.state('m1')).toBe('open');
  });

  it('中途成功会清零连续计数', async () => {
    const model = 'm-reset';
    for (let i = 0; i < 4; i++) await circuitBreaker.recordFailure(model);
    await circuitBreaker.recordSuccess(model);
    // 再失败 4 次仍不应 open（计数已重置）
    for (let i = 0; i < 4; i++) await circuitBreaker.recordFailure(model);
    expect(await circuitBreaker.state(model)).toBe('closed');
  });

  it('冷却 120s 后 → half_open，且探活只放 1 次', async () => {
    const model = 'm-halfopen';
    // 直接构造一个 120s 前就 open 的状态
    __forceOpen(model, Date.now() - (DEFAULT_COOLDOWN_SEC + 1) * 1000);

    // 第一次 isOpen：放行探活（返回 false = 不熔断）
    expect(await circuitBreaker.isOpen(model)).toBe(false);
    // 第二次：探活名额已用掉，继续挡
    expect(await circuitBreaker.isOpen(model)).toBe(true);
  });

  it('冷却未到期仍是 open', async () => {
    const model = 'm-cooling';
    __forceOpen(model, Date.now() - 10 * 1000); // 只过了 10s
    expect(await circuitBreaker.state(model)).toBe('open');
    expect(await circuitBreaker.isOpen(model)).toBe(true);
  });

  it('half_open 成功 → closed', async () => {
    const model = 'm-recover';
    __forceOpen(model, Date.now() - (DEFAULT_COOLDOWN_SEC + 1) * 1000);

    expect(await circuitBreaker.state(model)).toBe('half_open');
    await circuitBreaker.recordSuccess(model);

    expect(await circuitBreaker.state(model)).toBe('closed');
    expect(await circuitBreaker.isOpen(model)).toBe(false);
  });

  it('half_open 失败 → 重新 open', async () => {
    const model = 'm-probe-fail';
    __forceOpen(model, Date.now() - (DEFAULT_COOLDOWN_SEC + 1) * 1000);
    expect(await circuitBreaker.state(model)).toBe('half_open');

    await circuitBreaker.recordFailure(model); // 探活失败
    expect(await circuitBreaker.state(model)).toBe('open');
    expect(await circuitBreaker.isOpen(model)).toBe(true);
  });

  it('恢复后探活名额被重置（可再次进入 half_open）', async () => {
    const model = 'm-reprobe';
    __forceOpen(model, Date.now() - (DEFAULT_COOLDOWN_SEC + 1) * 1000);
    expect(await circuitBreaker.isOpen(model)).toBe(false); // 用掉探活
    await circuitBreaker.recordSuccess(model);
    expect(await circuitBreaker.state(model)).toBe('closed');

    // 再熔断 → 冷却后应能再次探活
    __forceOpen(model, Date.now() - (DEFAULT_COOLDOWN_SEC + 1) * 1000);
    expect(await circuitBreaker.isOpen(model)).toBe(false);
  });
});

describe('CircuitBreaker —— earliestRecoverySec', () => {
  it('无熔断 → 0', async () => {
    expect(await circuitBreaker.earliestRecoverySec()).toBe(0);
  });

  it('返回最早恢复的剩余秒数（多个熔断取最小）', async () => {
    __forceOpen('m-a', Date.now() - 100 * 1000); // 100s 前 open → 还剩 ~20s
    __forceOpen('m-b', Date.now() - 10 * 1000); // 10s 前 open → 还剩 ~110s

    const sec = await circuitBreaker.earliestRecoverySec();
    expect(sec).toBeGreaterThan(15);
    expect(sec).toBeLessThanOrEqual(20);
  });

  it('全部已过冷却 → 0（不再是"熔断中"）', async () => {
    __forceOpen('m-old', Date.now() - (DEFAULT_COOLDOWN_SEC + 60) * 1000);
    // openedAt 已过期，advance 会把它当 half_open；earliestRecoverySec 只算 open
    expect(await circuitBreaker.earliestRecoverySec()).toBe(0);
  });
});

describe('CircuitBreaker —— 多模型隔离', () => {
  it('一个模型熔断不影响另一个（模型级而非渠道级）', async () => {
    for (let i = 0; i < DEFAULT_FAILURE_THRESHOLD; i++) {
      await circuitBreaker.recordFailure('bad-model');
    }
    expect(await circuitBreaker.isOpen('bad-model')).toBe(true);
    expect(await circuitBreaker.isOpen('good-model')).toBe(false);
  });
});

describe('CircuitBreaker —— 常量', () => {
  it('默认阈值 5、冷却 120s（PRD §5.3）', () => {
    expect(DEFAULT_FAILURE_THRESHOLD).toBe(5);
    expect(DEFAULT_COOLDOWN_SEC).toBe(120);
  });
});
