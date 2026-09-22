/**
 * 注册反刷号单测（全内存，不连 DB/Redis/外网）。
 *
 * 覆盖四层防护：
 *  L1 一次性邮箱域名（精确 + 子域匹配；DB 故障回落内置基线）
 *  L2 同 IP 小时/天配额 + 全局日熔断
 *  L3 行为信号（蜜罐/耗时**只记不拒**，避免误伤）+ Turnstile 强制
 *  L4 审计永不抛错
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  isDisposableEmail,
  checkSendQuota,
  verifyTurnstile,
  assessSignupRisk,
  recordRiskDecision,
  resetDomainCache,
  blockedError,
  IP_HOUR_MAX,
  GLOBAL_DAY_MAX,
  MIN_FORM_ELAPSED_SEC,
} from './signup-risk.js';
import { setRateLimitStore, resetRateLimitStore } from './rate-limit.js';
import { resetConfig, loadConfig } from '../../core/config.js';

// 内存 Redis（覆盖 incr/expire/ttl/del）
const mem = new Map<string, { v: string; exp: number }>();
function memRedis() {
  return {
    async incr(key: string) {
      const cur = mem.get(key);
      const next = (cur && cur.exp > Date.now() ? Number.parseInt(cur.v, 10) : 0) + 1;
      mem.set(key, { v: String(next), exp: cur?.exp ?? 0 });
      return next;
    },
    async expire(key: string, ttlSec: number) {
      const cur = mem.get(key);
      if (cur) cur.exp = Date.now() + ttlSec * 1000;
      return 1;
    },
    async ttl(key: string) {
      const cur = mem.get(key);
      if (!cur || cur.exp <= Date.now()) return -2;
      return Math.ceil((cur.exp - Date.now()) / 1000);
    },
    async del(key: string) {
      mem.delete(key);
      return 1;
    },
    async get(key: string) {
      const cur = mem.get(key);
      return cur && cur.exp > Date.now() ? cur.v : null;
    },
    async set(key: string, v: string, ttlSec: number) {
      mem.set(key, { v, exp: Date.now() + ttlSec * 1000 });
    },
  };
}

// 内存 DB：只服务一次性域名表查询
let disposableRows: Array<{ domain: string }> = [];
let dbShouldThrow = false;

vi.mock('../../core/db.js', () => ({
  db: () => ({
    $queryRaw: async () => {
      if (dbShouldThrow) throw new Error('db down');
      return disposableRows;
    },
    $executeRaw: async () => 1,
  }),
  transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({}),
}));

// signup-risk 直接 import redis()，这里整体替换
vi.mock('../../core/redis.js', () => ({
  redis: () => memRedis(),
  createRedis: () => memRedis(),
  REDIS_KEYS: { loginFail: (k: string) => `loginfail:${k}`, verification: (k: string) => `verify:${k}` },
}));

beforeEach(() => {
  mem.clear();
  disposableRows = [];
  dbShouldThrow = false;
  resetDomainCache();
  setRateLimitStore(memRedis() as never);
  process.env.DATABASE_URL ??= 'postgresql://t:t@localhost:5432/t';
  process.env.REDIS_URL ??= 'redis://localhost:6379';
  process.env.JWT_SECRET = 'unit-test-secret-at-least-32-bytes-long';
  process.env.ADMIN_TOKEN ??= 'test-admin';
  delete process.env.TURNSTILE_SECRET_KEY;
  delete process.env.TURNSTILE_SITE_KEY;
  resetConfig();
  loadConfig();
});

afterEach(() => {
  resetRateLimitStore();
  resetDomainCache();
  resetConfig();
  loadConfig();
});

// ---------------------------------------------------------------- L1

describe('L1 一次性邮箱域名', () => {
  it('内置基线命中（mailinator.com）', async () => {
    expect(await isDisposableEmail('a@mailinator.com')).toBe(true);
  });

  it('子域命中（x.mailinator.com）', async () => {
    expect(await isDisposableEmail('a@x.mailinator.com')).toBe(true);
  });

  it('DB 表命中也算', async () => {
    disposableRows = [{ domain: 'my-temp.example' }];
    expect(await isDisposableEmail('a@my-temp.example')).toBe(true);
  });

  it('正常邮箱放行（gmail / 企业域）', async () => {
    expect(await isDisposableEmail('a@gmail.com')).toBe(false);
    expect(await isDisposableEmail('a@vutu.cc')).toBe(false);
  });

  it('DB 故障 → 回落内置基线，绝不放行全部', async () => {
    dbShouldThrow = true;
    resetDomainCache();
    expect(await isDisposableEmail('a@mailinator.com')).toBe(true);
    expect(await isDisposableEmail('a@gmail.com')).toBe(false);
  });

  it('大小写不敏感', async () => {
    expect(await isDisposableEmail('A@MAILINATOR.COM')).toBe(true);
  });

  it('后缀欺骗不误判（notmailinator.com 不是 mailinator.com 子域）', async () => {
    expect(await isDisposableEmail('a@notmailinator.com')).toBe(false);
  });
});

// ---------------------------------------------------------------- L2

describe('L2 配额', () => {
  it('同 IP 第 6 次触发小时上限', async () => {
    const ip = '1.2.3.4';
    for (let i = 0; i < IP_HOUR_MAX; i++) {
      const r = await checkSendQuota(ip);
      expect(r.allowed).toBe(true);
    }
    const over = await checkSendQuota(ip);
    expect(over.allowed).toBe(false);
    expect(over.dimension).toBe('ip_hour');
  });

  it('不同 IP 互不影响', async () => {
    for (let i = 0; i < IP_HOUR_MAX; i++) await checkSendQuota('1.1.1.1');
    const other = await checkSendQuota('2.2.2.2');
    expect(other.allowed).toBe(true);
  });

  it('全局日上限触发（保护 Resend 额度与域名信誉）', async () => {
    // 每个 IP 只发 1 次，绕开 IP 限制，逼近全局上限
    for (let i = 0; i < GLOBAL_DAY_MAX; i++) {
      await checkSendQuota(`10.0.0.${i % 250}.${i}`);
    }
    const over = await checkSendQuota('99.99.99.99');
    expect(over.allowed).toBe(false);
    expect(over.dimension).toBe('global_day');
  });

  it('无 IP 时只走全局计数', async () => {
    const r = await checkSendQuota(undefined);
    expect(r.allowed).toBe(true);
  });
});

// ---------------------------------------------------------------- L3

describe('L3 行为信号与 Turnstile', () => {
  it('未配置 Turnstile → not_configured，不阻断', async () => {
    expect(await verifyTurnstile(undefined, '1.2.3.4')).toBe('not_configured');
  });

  it('配置了 Secret 但缺 token → absent（调用方视为失败）', async () => {
    process.env.TURNSTILE_SECRET_KEY = 'sk_test';
    resetConfig();
    loadConfig();
    expect(await verifyTurnstile(undefined, '1.2.3.4')).toBe('absent');
  });

  it('蜜罐被填：只记信号不拒绝（避免误伤密码管理器/无障碍工具）', async () => {
    const d = await assessSignupRisk({
      email: 'a@gmail.com',
      ip: '5.5.5.5',
      honeypot: 'bot-filled',
      stage: 'register',
    });
    expect(d.verdict).toBe('allow');
    expect(d.signals.honeypotFilled).toBe(true);
  });

  it('提交过快：同样只记不拒', async () => {
    const d = await assessSignupRisk({
      email: 'a@gmail.com',
      ip: '6.6.6.6',
      formElapsedSec: MIN_FORM_ELAPSED_SEC - 2,
      stage: 'register',
    });
    expect(d.verdict).toBe('allow');
    expect(d.signals.formElapsedSec).toBe(MIN_FORM_ELAPSED_SEC - 2);
  });

  it('一次性域名 → block 且 reason 明确（供审计，但不回传前端）', async () => {
    const d = await assessSignupRisk({
      email: 'a@yopmail.com',
      ip: '7.7.7.7',
      stage: 'register',
    });
    expect(d.verdict).toBe('block');
    expect(d.reason).toBe('disposable_domain');
  });

  it('配额超限 → block', async () => {
    const ip = '8.8.8.8';
    for (let i = 0; i < IP_HOUR_MAX; i++) await checkSendQuota(ip);
    const d = await assessSignupRisk({ email: 'a@gmail.com', ip, stage: 'register' });
    expect(d.verdict).toBe('block');
    expect(d.reason).toBe('ip_hour');
  });

  it('正常用户 → allow', async () => {
    const d = await assessSignupRisk({
      email: 'real@gmail.com',
      ip: '9.9.9.9',
      formElapsedSec: 12,
      stage: 'register',
    });
    expect(d.verdict).toBe('allow');
  });
});

// ---------------------------------------------------------------- L4 + 统一话术

describe('L4 审计与对外话术', () => {
  it('审计写入失败不抛错（不能阻断注册主流程）', async () => {
    await expect(
      recordRiskDecision({
        identifier: 'a@gmail.com',
        stage: 'register',
        verdict: 'block',
        reason: 'disposable_domain',
        ip: '1.1.1.1',
        signals: { disposableDomain: true },
      }),
    ).resolves.toBeUndefined();
  });

  it('对外错误不暴露具体拦截规则（防逐条试探）', () => {
    const e = blockedError() as { code?: string; details?: Record<string, unknown> };
    expect(e.code).toBe('FORBIDDEN');
    expect(e.details?.reason).toBe('signup_blocked');
    // 不得出现可区分的规则名
    expect(JSON.stringify(e.details)).not.toContain('disposable');
    expect(JSON.stringify(e.details)).not.toContain('quota');
  });
});
