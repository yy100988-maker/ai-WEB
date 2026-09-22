/**
 * 结构化日志（详细设计 §6.1）。
 * - 全链路 requestId
 * - 敏感字段脱敏：API Key、prompt 全文、邮箱/手机
 */

import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import pino from 'pino';
import type { Logger } from 'pino';
import { getConfig } from './config.js';

let root: Logger | null = null;

/** 脱敏路径：API Key / Cookie / 密码 / token 永不进日志（详细设计 §6.1） */
const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'headers.authorization',
  'password',
  'oldPassword',
  'newPassword',
  'apiKey',
  'refreshToken',
  'accessToken',
  '*.apiKey',
  '*.refreshToken',
  '*.accessToken',
];

/**
 * pino 配置（**唯一真源**）。
 *
 * Fastify 与应用侧（childLogger）必须用同一份配置，否则日志格式会分叉：
 * `buildApp()` 把本函数的返回值作为 Fastify 的 `logger` 选项传入。
 *
 * ⚠️ 为什么不直接传 pino 实例给 Fastify：
 *  - `logger: pinoInstance` → 抛 FST_ERR_LOG_INVALID_LOGGER_CONFIG（只收配置对象）；
 *  - `loggerInstance: pinoInstance` → Fastify 的 Logger 泛型被推断为具体 pino Logger，
 *    与 FastifyInstance 默认的 FastifyBaseLogger 不兼容，route 注册处报 TS2345。
 * 传配置对象则两边都干净。
 */
export function loggerOptions(): pino.LoggerOptions {
  const cfg = getConfig();
  return {
    level: cfg.LOG_LEVEL,
    base: undefined,
    timestamp: pino.stdTimeFunctions.isoTime,
    // 生产/测试一律 JSON（容器 json-file 采集）。
    // 开发环境仅在 **已安装** pino-pretty 时启用美化，否则回落 JSON ——
    // pino-pretty 是可选依赖，未安装时构造 transport 会抛
    // "unable to determine transport target" 导致进程直接起不来。
    ...(cfg.NODE_ENV === 'development' && hasPinoPretty()
      ? {
          transport: {
            target: 'pino-pretty',
            options: { colorize: true, translateTime: 'HH:MM:ss' },
          },
        }
      : {}),
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
  };
}

export function logger(): Logger {
  if (!root) {
    root = pino(loggerOptions());
  }
  return root;
}

/** 测试/配置变更后重建 */
export function resetLogger(): void {
  root = null;
}

/** pino-pretty 是可选依赖，仅开发环境用；缺失时静默回落 JSON 输出 */
function hasPinoPretty(): boolean {
  try {
    createRequire(import.meta.url).resolve('pino-pretty');
    return true;
  } catch {
    return false;
  }
}

export function childLogger(bindings: Record<string, unknown>): Logger {
  return logger().child(bindings);
}

/** 邮箱/手机掩码：ab***@x.com / 138****8888 */
export function maskEmail(v: string | null | undefined): string {
  if (!v) return '';
  const at = v.indexOf('@');
  if (at <= 0) return maskPhone(v);
  const name = v.slice(0, at);
  const domain = v.slice(at);
  const head = name.slice(0, Math.min(2, name.length));
  return `${head}***${domain}`;
}

export function maskPhone(v: string | null | undefined): string {
  if (!v) return '';
  if (v.length < 7) return '***';
  return `${v.slice(0, 3)}****${v.slice(-4)}`;
}

/** 用户输入摘要：只记 sha256 前缀，不记原文（详细设计 §6.1） */
export function digest(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex').slice(0, 16);
}
