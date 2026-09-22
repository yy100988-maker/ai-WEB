/**
 * 注册/找回风控（反机器批量刷号）。
 *
 * 威胁模型：攻击者用脚本 + LLM 批量注册，目的是白拿注册赠送积分、或把平台当免费
 * 邮件发送器（发码接口 = 免费的邮件群发通道）。原有防护只有"同邮箱 1/min、
 * 同 IP 10/min"——**换 IP 即可绕过**，且不识别一次性邮箱。
 *
 * 纵深四层（任何一层拦截即拒）：
 *   L1 一次性邮箱域名      → 命中即拒（运营可配，DB + 内置基线）
 *   L2 配额                → 同 IP 小时/天 + 全局天级发信熔断（保护 Resend 额度与信誉）
 *   L3 行为信号            → 蜜罐字段被填 / 表单提交过快 / Turnstile（有配置时强制）
 *   L4 审计                → 每次决策落 signup_risk_logs，供复盘与误杀申诉
 *
 * ⚠️ 设计原则：**宁可放过不可错杀**。行为信号（蜜罐/耗时）单独命中时只记审计不拒绝
 * （无密码管理器/无障碍工具会误伤），只有 Turnstile 明确失败或配额超限才拒。
 * 校验失败一律给**统一话术**，不暴露"你被哪条规则拦了"，避免攻击者逐条试探。
 */

import { db } from '../../core/db.js';
import { redis } from '../../core/redis.js';
import { childLogger } from '../../core/logger.js';
import { getConfig } from '../../core/config.js';
import { err } from '../../core/errors.js';
import { sha256 } from '../../core/crypto.js';

const log = childLogger({ mod: 'signup-risk' });

// ---------------------------------------------------------------- 常量

/** 同 IP 每小时发码上限 */
export const IP_HOUR_MAX = 5;
/** 同 IP 每天发码上限 */
export const IP_DAY_MAX = 15;
/** 全局每天发码上限（保护 Resend 额度与发信域名信誉） */
export const GLOBAL_DAY_MAX = 500;
/** 表单从加载到提交的最短合理耗时（秒）；低于此值高度可疑但**不直接拒** */
export const MIN_FORM_ELAPSED_SEC = 3;

export type RiskStage = 'register' | 'verify' | 'set_password' | 'recovery_request' | 'recovery_confirm';
export type RiskVerdict = 'allow' | 'block' | 'challenge';

export interface RiskSignals {
  /** 蜜罐字段是否被填写（人类看不见的隐藏字段，机器人常无脑填） */
  honeypotFilled?: boolean;
  /** 表单加载到提交的秒数 */
  formElapsedSec?: number;
  /** Turnstile 校验结果 */
  turnstile?: 'pass' | 'fail' | 'absent' | 'not_configured';
  /** 邮箱域是否一次性 */
  disposableDomain?: boolean;
  /** 命中的具体配额维度 */
  quota?: string;
}

export interface RiskDecision {
  verdict: RiskVerdict;
  reason?: string;
  signals: RiskSignals;
}

// ---------------------------------------------------------------- L1 一次性邮箱

/**
 * 内置基线（DB 表未就绪或查询失败时的兜底）。
 * 保持精简：真正的大名单在 `disposable_email_domains` 表，运营可随时增删。
 */
export const BUILTIN_DISPOSABLE_DOMAINS = [
  'mailinator.com',
  'guerrillamail.com',
  '10minutemail.com',
  'tempmail.com',
  'temp-mail.org',
  'yopmail.com',
  'sharklasers.com',
  'getnada.com',
  'trashmail.com',
  'maildrop.cc',
  'dispostable.com',
  'fakeinbox.com',
  'mailnesia.com',
  'mintemail.com',
  'spamgourmet.com',
  'emailondeck.com',
  'moakt.com',
  'tempr.email',
];

/** 一次性域名缓存（60s，避免每次发码查库） */
let domainCache: { at: number; set: Set<string> } | null = null;
const DOMAIN_CACHE_TTL_MS = 60_000;

async function loadDomains(): Promise<Set<string>> {
  if (domainCache && Date.now() - domainCache.at < DOMAIN_CACHE_TTL_MS) {
    return domainCache.set;
  }
  let rows: Array<{ domain: string }> = [];
  try {
    rows = await db().$queryRaw<Array<{ domain: string }>>`
      SELECT domain FROM disposable_email_domains WHERE active = true
    `;
  } catch (e) {
    // 表不存在/DB 抖动 → 用内置基线，绝不因此放行全部
    log.warn({ err: e }, 'load disposable domains failed, using builtin baseline');
  }
  const set = new Set<string>([
    ...BUILTIN_DISPOSABLE_DOMAINS,
    ...rows.map((r) => r.domain.toLowerCase()),
  ]);
  domainCache = { at: Date.now(), set };
  return set;
}

/** 测试用：清缓存 */
export function resetDomainCache(): void {
  domainCache = null;
}

/**
 * 邮箱域是否一次性。
 * 匹配规则：完全相等 **或** 以 `.域名` 结尾（覆盖 `x.mailinator.com` 这类子域）。
 */
export async function isDisposableEmail(email: string): Promise<boolean> {
  const at = email.lastIndexOf('@');
  if (at < 0) return false;
  const domain = email.slice(at + 1).toLowerCase();
  const set = await loadDomains();
  if (set.has(domain)) return true;
  for (const d of set) {
    if (domain.endsWith(`.${d}`)) return true;
  }
  return false;
}

// ---------------------------------------------------------------- L2 配额

async function incr(key: string, ttlSec: number): Promise<number> {
  const n = await redis().incr(key);
  if (n === 1) await redis().expire(key, ttlSec);
  return n;
}

export interface QuotaResult {
  allowed: boolean;
  dimension?: string;
  retryAfter?: number;
}

/**
 * IP + 全局配额检查（窗口为自然滑动近似：固定窗口 incr）。
 * Redis 故障 → fail-open 并记 warn（可用性优先；此时 Turnstile 仍是硬门槛）。
 */
export async function checkSendQuota(ip: string | undefined): Promise<QuotaResult> {
  try {
    const globalDay = await incr('risk:send:global:day', 86400);
    if (globalDay > GLOBAL_DAY_MAX) {
      log.error({ globalDay }, 'P0: global daily verification-send cap reached');
      return { allowed: false, dimension: 'global_day', retryAfter: 3600 };
    }
    if (ip) {
      const ipHour = await incr(`risk:send:ip:hour:${ip}`, 3600);
      if (ipHour > IP_HOUR_MAX) {
        const ttl = await redis().ttl(`risk:send:ip:hour:${ip}`);
        return { allowed: false, dimension: 'ip_hour', retryAfter: ttl > 0 ? ttl : 3600 };
      }
      const ipDay = await incr(`risk:send:ip:day:${ip}`, 86400);
      if (ipDay > IP_DAY_MAX) {
        const ttl = await redis().ttl(`risk:send:ip:day:${ip}`);
        return { allowed: false, dimension: 'ip_day', retryAfter: ttl > 0 ? ttl : 86400 };
      }
    }
    return { allowed: true };
  } catch (e) {
    log.warn({ err: e }, 'quota store unavailable, fail-open');
    return { allowed: true };
  }
}

/** 测试/运维：重置某 IP 的配额（误封申诉用） */
export async function resetIpQuota(ip: string): Promise<void> {
  await redis().del(`risk:send:ip:hour:${ip}`, `risk:send:ip:day:${ip}`);
}

// ---------------------------------------------------------------- L3 Turnstile

interface TurnstileResponse {
  success?: boolean;
  'error-codes'?: string[];
}

/**
 * Cloudflare Turnstile 校验。
 * - 未配置 TURNSTILE_SECRET_KEY → `not_configured`（调用方按策略决定是否放行）
 * - 网络失败 → `fail` 但调用方应视为"无法判定"；这里返回 absent 以示区分
 */
export async function verifyTurnstile(
  token: string | undefined,
  ip: string | undefined,
): Promise<'pass' | 'fail' | 'absent' | 'not_configured'> {
  const cfg = getConfig();
  if (!cfg.TURNSTILE_SECRET_KEY) return 'not_configured';
  if (!token) return 'absent';

  try {
    const body = new URLSearchParams({ secret: cfg.TURNSTILE_SECRET_KEY, response: token });
    if (ip) body.set('remoteip', ip);
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      log.warn({ status: res.status }, 'turnstile verify http error');
      return 'absent';
    }
    const data = (await res.json()) as TurnstileResponse;
    if (data.success === true) return 'pass';
    log.warn({ errorCodes: data['error-codes'] }, 'turnstile rejected');
    return 'fail';
  } catch (e) {
    log.warn({ err: e }, 'turnstile verify failed (treated as absent)');
    return 'absent';
  }
}

// ---------------------------------------------------------------- L4 审计

export interface AuditInput {
  identifier: string;
  stage: RiskStage;
  verdict: RiskVerdict;
  reason?: string;
  ip?: string;
  signals?: RiskSignals;
}

/**
 * 落审计。**永不抛错**（审计失败不能阻断注册主流程），只记 warn。
 * identifier 只存 sha256 前 32 位，不存明文邮箱。
 */
export async function recordRiskDecision(input: AuditInput): Promise<void> {
  const at = input.identifier.lastIndexOf('@');
  const domain = at >= 0 ? input.identifier.slice(at + 1).toLowerCase() : null;
  try {
    await db().$executeRaw`
      INSERT INTO signup_risk_logs (identifier, domain, ip, stage, verdict, reason, signals)
      VALUES (
        ${sha256(input.identifier).slice(0, 32)},
        ${domain},
        ${input.ip ?? null},
        ${input.stage},
        ${input.verdict},
        ${input.reason ?? null},
        ${JSON.stringify(input.signals ?? {})}::jsonb
      )
    `;
  } catch (e) {
    log.warn({ err: e, stage: input.stage, verdict: input.verdict }, 'audit insert failed (non-blocking)');
  }
}

// ---------------------------------------------------------------- 汇总决策

export interface SignupRiskInput {
  email: string;
  ip?: string;
  /** 蜜罐字段值（前端隐藏字段，正常用户为空） */
  honeypot?: string;
  /** 表单加载到提交的秒数（前端上报） */
  formElapsedSec?: number;
  /** Turnstile token */
  turnstileToken?: string;
  stage: RiskStage;
}

/**
 * 组合决策。返回 block 时调用方抛统一错误（不暴露具体规则）。
 */
export async function assessSignupRisk(input: SignupRiskInput): Promise<RiskDecision> {
  const cfg = getConfig();
  const signals: RiskSignals = {};

  // L3-a Turnstile（最硬的机器判定，优先跑）
  const turnstile = await verifyTurnstile(input.turnstileToken, input.ip);
  signals.turnstile = turnstile;
  if (cfg.TURNSTILE_SECRET_KEY && (turnstile === 'fail' || turnstile === 'absent')) {
    return { verdict: 'block', reason: 'turnstile_failed', signals };
  }

  // L1 一次性域名
  const disposable = await isDisposableEmail(input.email);
  signals.disposableDomain = disposable;
  if (disposable) {
    return { verdict: 'block', reason: 'disposable_domain', signals };
  }

  // L2 配额
  const quota = await checkSendQuota(input.ip);
  if (!quota.allowed) {
    signals.quota = quota.dimension;
    return { verdict: 'block', reason: quota.dimension ?? 'quota', signals };
  }

  // L3-b 行为信号：**只记不拒**（误伤真实用户的风险高于收益）
  if (input.honeypot && input.honeypot.trim().length > 0) {
    signals.honeypotFilled = true;
  }
  if (typeof input.formElapsedSec === 'number') {
    signals.formElapsedSec = input.formElapsedSec;
  }
  const behaviouralSuspicious =
    signals.honeypotFilled === true ||
    (typeof input.formElapsedSec === 'number' && input.formElapsedSec < MIN_FORM_ELAPSED_SEC);

  if (behaviouralSuspicious) {
    log.warn({ signals, stage: input.stage }, 'signup behavioural signal (audit only, not blocking)');
  }

  return { verdict: 'allow', signals };
}

/** 对外统一错误：不透露具体拦截原因（防逐条试探） */
export function blockedError(): Error {
  return err.forbidden({ reason: 'signup_blocked' });
}
