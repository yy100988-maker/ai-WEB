/**
 * 运行时配置（详细设计 §8.1 环境变量清单）。
 * 所有密钥只来自环境变量，绝不落库/落日志/下发前端。
 */

import { z } from 'zod';

function bool(defaultValue: boolean) {
  return z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? defaultValue : v === 'true' || v === '1'));
}

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(8080),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.string().default('info'),

  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),

  // 对象存储（S3 协议，默认同机 MinIO）
  S3_ENDPOINT: z.string().default('http://minio:9000'),
  S3_REGION: z.string().default('us-east-1'),
  S3_ACCESS_KEY: z.string().default(''),
  S3_SECRET_KEY: z.string().default(''),
  S3_BUCKET: z.string().default('vutu'),
  S3_FORCE_PATH_STYLE: bool(true),
  /** 预签名 URL 的对外可达基址（跑在容器里时不能用 http://minio:9000 给上游/浏览器） */
  S3_PUBLIC_ENDPOINT: z.string().optional(),

  // 认证
  JWT_SECRET: z.string().min(16),
  ACCESS_TOKEN_TTL_SEC: z.coerce.number().int().positive().default(900), // 15min
  REFRESH_TOKEN_TTL_SEC: z.coerce.number().int().positive().default(2592000), // 30d
  BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(15).default(12),

  ADMIN_TOKEN: z.string().min(8),

  // 邮件发送（Resend HTTP API，用于注册/找回验证码）
  /** 为空时：非生产记日志联调；生产直接报 EMAIL_NOT_CONFIGURED（不断头） */
  RESEND_API_KEY: z.string().default(''),
  /**
   * 发件人。未绑定自有域名前只能用 Resend 测试域，
   * 且测试域**只能发给 Resend 账户主邮箱**——全量前必须绑域名。
   */
  MAIL_FROM: z.string().default('Vutu <onboarding@resend.dev>'),
  /**
   * true = 抑制一切真实发信（只写日志）。
   * 用于 CI / 集成测试 / 压测：避免假邮箱被上游拒投导致测试失败，也避免误发真实邮件。
   */
  MAIL_SUPPRESS: bool(false),
  // Google OAuth（ID token JWKS 验签用；只需要 Client ID，不需要 Secret）
  GOOGLE_CLIENT_ID: z.string().default(''),

  // ---------- 注册反刷号（Turnstile 人机验证） ----------
  /**
   * Cloudflare Turnstile Secret Key。配置后，注册/找回发码**强制**校验人机验证；
   * 未配置则降级为"蜜罐 + 表单耗时 + 域名黑名单 + IP 配额"（全部无需第三方）。
   * Site Key 由后端经 /v1/auth/oauth-providers 之外的公开端点下发（见 signup-config）。
   */
  TURNSTILE_SECRET_KEY: z.string().default(''),
  /** 前端渲染 Turnstile 用的 Site Key（可公开） */
  TURNSTILE_SITE_KEY: z.string().default(''),

  // 上游渠道（首期唯一：灵客 AI / LK888）
  LK_BASE_URL: z.string().default('https://api.lk888.ai/api'),
  /** JSON 数组或逗号分隔的多 Key 池；顺序即优先级 */
  LK_API_KEYS: z.string().default('[]'),
  LK_KEY_STRATEGY: z.enum(['price_first', 'success_first', 'custom']).default('price_first'),
  LK_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),
  LK_RATE_LIMIT_RPM: z.coerce.number().int().positive().default(120),

  /** true = 全部生成走 MockProvider（CI/staging/压测强制），零上游费用 */
  MOCK_PROVIDER: bool(false),
  MOCK_LATENCY_MS: z.coerce.number().int().min(0).default(3000),
  /** 允许通过 X-Mock-Fail 头注入失败（需配合 MOCK_PROVIDER=true） */
  MOCK_FAIL_INJECTION: bool(true),
  /**
   * Mock fixture 的**可达基址**（worker 容器下载产物用）。
   * 容器内 `localhost` 指向自己，必须指向挂了 /mock-fixture 的 api 容器
   * （compose 环境填 `http://api:8080`）。
   */
  MOCK_FIXTURE_BASE_URL: z.string().default('http://localhost:8080'),

  // 定价三常数（改此即改全站价）
  USD_TO_CNY: z.coerce.number().positive().default(6.9),
  MARKUP: z.coerce.number().positive().default(1.3),
  CREDITS_PER_USD: z.coerce.number().positive().default(100),

  // 业务常量
  SIGNUP_GRANT_CREDITS: z.coerce.number().int().nonnegative().default(100),
  SIGNUP_GRANT_TTL_DAYS: z.coerce.number().int().positive().default(7),
  CHECKIN_CREDITS: z.coerce.number().int().nonnegative().default(5),
  TASK_TIMEOUT_MIN: z.coerce.number().int().positive().default(30),
  TASK_MAX_RETRY: z.coerce.number().int().nonnegative().default(3),
  POLL_INTERVAL_SEC: z.coerce.number().int().positive().default(15),
  DELIVERY_URL_TTL_SEC: z.coerce.number().int().positive().default(14400), // 4h
  VIEW_URL_TTL_SEC: z.coerce.number().int().positive().default(900), // 15min
  UPLOAD_URL_TTL_SEC: z.coerce.number().int().positive().default(900), // 15min

  // 内容审核
  MODERATION_L1_ENABLED: bool(true),
  MODERATION_L2_ENABLED: bool(true),
  MODERATION_L2_TIMEOUT_MS: z.coerce.number().int().positive().default(3000),
  MODERATION_CACHE_TTL_SEC: z.coerce.number().int().positive().default(86400),

  /** 任务保留期（PRD §9 隐私合规） */
  RETENTION_FREE_DAYS: z.coerce.number().int().positive().default(30),
  RETENTION_PRO_DAYS: z.coerce.number().int().positive().default(90),

  /** 暴露 /docs（OpenAPI）与 dev 万能验证码 */
  SENTRY_DSN: z.string().optional(),
});

export type Config = z.infer<typeof schema> & {
  /** 已解析的多 Key 池 */
  lkApiKeys: string[];
};

let cached: Config | null = null;

export function loadConfig(overrides: Record<string, string | undefined> = {}): Config {
  const merged: Record<string, string | undefined> = { ...process.env, ...overrides };
  const parsed = schema.safeParse(merged);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid configuration:\n${issues}`);
  }
  const cfg = parsed.data;
  const resolved: Config = { ...cfg, lkApiKeys: parseApiKeys(cfg.LK_API_KEYS) };
  // 同步更新缓存：调用方（如测试的 withEnv 辅助）期望 loadConfig 之后 getConfig()
  // 就能拿到新值，否则同一进程里会读到旧配置，导致环境相关的断言失真。
  cached = resolved;
  return resolved;
}

export function getConfig(): Config {
  if (!cached) cached = loadConfig();
  return cached;
}

/** 测试用：注入自定义配置 */
export function setConfig(cfg: Config): void {
  cached = cfg;
}

export function resetConfig(): void {
  cached = null;
}

function parseApiKeys(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith('[')) {
    try {
      const arr: unknown = JSON.parse(trimmed);
      if (Array.isArray(arr)) {
        return arr
          .map((x) => (typeof x === 'string' ? x : typeof x === 'object' && x && 'key' in x ? String((x as { key: unknown }).key) : ''))
          .filter((x) => x.length > 0);
      }
    } catch {
      /* 回落逗号分隔 */
    }
  }
  return trimmed
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** 日志脱敏：sk-abcdef...ae56 → sk-***ae56 */
export function maskSecret(secret: string): string {
  if (!secret) return '';
  if (secret.length <= 8) return '***';
  return `${secret.slice(0, 3)}***${secret.slice(-4)}`;
}

export const STORAGE_PREFIX = {
  upload: 'uploads',
  output: 'outputs',
} as const;
