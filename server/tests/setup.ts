/**
 * Vitest 全局 setup：注入测试环境变量。
 *
 * 为什么需要：`getConfig()` 在模块加载期（childLogger → logger → getConfig）就会被调用，
 * 缺 DATABASE_URL/JWT_SECRET 等必填项会让**整个测试套件**在 import 阶段炸掉。
 * 这里给一套最小可用的假配置；单元测试不会真的连库（DB/Redis 都按需 mock）。
 *
 * `MOCK_PROVIDER` 默认 **false**：
 * - 契约测试必须能在"真 Provider"模式下跑（否则 LingkeProvider 的硬保险会拒绝出网）。
 * - 需要 Mock 的用例自己 `loadConfig({ MOCK_PROVIDER: 'true' })` 显式开启，
 *   避免"测试全局躺在一个开关上"导致断言失真。
 *
 * 注意：契约测试**绝不出网** —— undici MockAgent + disableNetConnect 保证未注册请求抛错。
 */

process.env['NODE_ENV'] = 'test';
// 默认指向 docker-compose.test.yml 暴露的端口（PG 5433 / Redis 6380），
// 与生产 compose 的 5432/6379 区分，避免误连本机已有的 PG/Redis。
process.env['DATABASE_URL'] ??=
  process.env['TEST_DATABASE_URL'] ?? 'postgresql://vutu:vutu@127.0.0.1:5433/vutu?schema=public';
process.env['REDIS_URL'] ??= process.env['TEST_REDIS_URL'] ?? 'redis://127.0.0.1:6380';
process.env['JWT_SECRET'] ??= 'test-jwt-secret-at-least-32-bytes-long-000000';
process.env['ADMIN_TOKEN'] ??= 'test-admin-token';
process.env['BCRYPT_ROUNDS'] ??= '4';

// Mock Provider 相关默认值（单测里按需覆盖）
process.env['MOCK_PROVIDER'] ??= 'false';
process.env['MOCK_LATENCY_MS'] ??= '0';
process.env['MOCK_FAIL_INJECTION'] ??= 'true';

// 测试环境一律抑制真实发信：
// ① E2E 用假邮箱（e2e-xxx@example.com），真发会被 Resend 拒投 → 503，
//    测试就挂在与被测逻辑无关的外部依赖上；
// ② 防止 CI/本地跑测试时误发真实验证码邮件给用户。
process.env['MAIL_SUPPRESS'] ??= 'true';

// 对象存储假凭据（transfer/资产用例需要；不会真连）
process.env['S3_ENDPOINT'] ??= 'http://127.0.0.1:9000';
process.env['S3_PUBLIC_ENDPOINT'] ??= 'http://127.0.0.1:9000';
process.env['S3_ACCESS_KEY'] ??= 'vutuadmin';
process.env['S3_SECRET_KEY'] ??= 'vutusecret';
process.env['S3_BUCKET'] ??= 'vutu';

// 定价三常数
process.env['USD_TO_CNY'] ??= '6.9';
process.env['MARKUP'] ??= '1.3';
process.env['CREDITS_PER_USD'] ??= '100';

// 让日志保持安静（单测不关心 info 级输出）
process.env['LOG_LEVEL'] ??= 'silent';
