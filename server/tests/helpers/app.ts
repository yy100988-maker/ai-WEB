/**
 * E2E / 集成测试的 HTTP 客户端与用户工厂。
 * 直接对内存中的 Fastify 实例发请求（light-my-request），不占端口。
 */

import type { FastifyInstance } from 'fastify';
import { buildApp, type RouteModule } from '../../src/core/http.js';
import { loadConfig, setConfig, type Config } from '../../src/core/config.js';
import { testDb } from './db.js';

/** 测试用配置：Mock Provider 强制开启，降低延迟 */
export function testConfig(overrides: Record<string, string | undefined> = {}): Config {
  return loadConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL,
    REDIS_URL: process.env.TEST_REDIS_URL ?? process.env.REDIS_URL,
    JWT_SECRET: 'test-secret-at-least-32-bytes-long-xxxxx',
    ADMIN_TOKEN: 'test-admin-token',
    MOCK_PROVIDER: 'true',
    MOCK_LATENCY_MS: '150',
    MOCK_FAIL_INJECTION: 'true',
    POLL_INTERVAL_SEC: '1',
    BCRYPT_ROUNDS: '4',
    S3_ENDPOINT: 'http://127.0.0.1:9000',
    S3_PUBLIC_ENDPOINT: 'http://127.0.0.1:9000',
    S3_ACCESS_KEY: 'vutuadmin',
    S3_SECRET_KEY: 'vutusecret',
    ...overrides,
  });
}

export interface TestContext {
  app: FastifyInstance;
  request: (opts: {
    method: string;
    url: string;
    payload?: unknown;
    headers?: Record<string, string>;
    token?: string;
  }) => Promise<{ statusCode: number; body: any; headers: Record<string, unknown> }>;
}

export async function createTestApp(routes: RouteModule[], overrides: Record<string, string | undefined> = {}): Promise<TestContext> {
  const cfg = testConfig(overrides);
  process.env.DATABASE_URL = cfg.DATABASE_URL;
  process.env.REDIS_URL = cfg.REDIS_URL;
  setConfig(cfg);

  const app = await buildApp({ routes, disableRateLimit: true });
  await app.ready();

  const request: TestContext['request'] = async ({ method, url, payload, headers, token }) => {
    // 只有真正带 body 时才声明 content-type。
    // 若对无 body 的 POST 也发 `content-type: application/json`，Fastify 会抛
    // FST_ERR_CTP_EMPTY_JSON_BODY（"Body cannot be empty when content-type is set to
    // 'application/json'"）→ 500。真实前端对无 body 的 POST 也不会发该头。
    const hasBody = payload !== undefined && payload !== null;

    const res = await app.inject({
      method: method as 'GET',
      url,
      ...(hasBody ? { payload: payload as object } : {}),
      headers: {
        ...(hasBody ? { 'content-type': 'application/json' } : {}),
        'accept-language': 'en',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(headers ?? {}),
      },
    });
    let body: unknown = null;
    try {
      body = res.body ? JSON.parse(res.body) : null;
    } catch {
      body = res.body;
    }
    return { statusCode: res.statusCode, body, headers: res.headers as Record<string, unknown> };
  };

  return { app, request };
}

/** 直连 DB 造用户（绕过验证码流程），返回 userId + accessToken */
export async function createTestUser(input?: {
  email?: string;
  credits?: number;
  planCode?: 'free' | 'pro';
  locale?: string;
}): Promise<{ userId: string; publicId: string; email: string; accessToken: string }> {
  const db = testDb();
  const email = input?.email ?? `test-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
  const planCode = input?.planCode ?? 'free';

  const plan = await db.plan.findUnique({ where: { code: planCode } });
  if (!plan) throw new Error(`plan ${planCode} not seeded; run prisma/seed.ts`);

  const user = await db.user.create({
    data: {
      publicId: `usr_test${Math.floor(Math.random() * 1e9)}`,
      email,
      locale: input?.locale ?? 'en',
      planId: plan.id,
      profile: { create: { displayName: 'Test User' } },
      preferences: { create: { locale: input?.locale ?? 'en', timezone: 'Asia/Shanghai' } },
    },
  });

  if (input?.credits && input.credits > 0) {
    await db.creditLedger.create({
      data: {
        userId: user.id,
        delta: input.credits,
        type: 'admin_adjust',
        balanceAfter: input.credits,
        idempotencyKey: `test-grant:${user.id}`,
        note: 'test setup',
      },
    });
  }

  const { signAccessToken } = await import('../../src/modules/auth/tokens.js');
  const accessToken = signAccessToken({
    publicId: user.publicId,
    id: user.id,
    planCode: plan.code,
    locale: user.locale,
  });

  return { userId: user.id, publicId: user.publicId, email, accessToken };
}
