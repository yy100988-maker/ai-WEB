/**
 * 认证服务（详细设计 §2.2 / PRD §8.1）。
 *
 * 覆盖：注册发码 → 验证码校验（exists/verifiedToken）→ 设密码建号 → 登录 →
 *      找回（申请/确认/重置）→ OAuth → 刷新 → 登出
 *      → 当前用户信息 → 资料更新 → 改密码 → 注销。
 *
 * 事务与幂等要点：
 * - 新建用户（User/UserProfile/UserPreference/CreditLedger/Grant）在**同一 Prisma 事务**内完成；
 * - 注册赠送流水用 `idempotencyKey = 'signup:<userId>'`，配合 `(userId, idempotencyKey)` 唯一索引天然幂等；
 * - 余额 = `SUM(credit_ledger.delta)` **全量求和**，绝不按 `expires_at` 过滤（§2.5 反例）。
 */

import type { Prisma } from '@prisma/client';
import { db, transaction } from '../../core/db.js';
import { err } from '../../core/errors.js';
import { getConfig } from '../../core/config.js';
import { newPublicId } from '../../core/ids.js';
import { childLogger, maskEmail, maskPhone } from '../../core/logger.js';
import { LOCALE_TIMEZONE, isLocale, type Locale } from '../../core/types.js';
import { hashPassword, verifyPassword, validatePasswordPolicy } from './passwords.js';
import {
  createVerification,
  consumeVerification,
  MAX_ATTEMPTS,
  type VerificationRecord,
} from './verification.js';
import { issueVerifiedToken, consumeVerifiedToken } from './verified-token.js';
import { assessSignupRisk, recordRiskDecision, blockedError } from './signup-risk.js';
import { sendVerificationEmail, MailError } from './mailer.js';
import { verifyGoogleIdToken } from './google.js';
import {
  hitIdentifier,
  hitRegisterIp,
  loginFailRemaining,
  recordFailure,
  clearFailures,
} from './rate-limit.js';
import {
  signAccessToken,
  issueRefreshToken,
  rotateRefreshToken,
  revokeRefreshToken,
  revokeAllForUser,
  hashRefreshToken,
  type DbLike,
} from './tokens.js';

const log = childLogger({ mod: 'auth-service' });

/** 未来 24h 内过期提示窗口（ms） */
export const EXPIRING_SOON_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface RegisterInput {
  email?: string;
  phone?: string;
  locale?: Locale;
  ip?: string;
  /** 反刷号行为信号（前端上报，全部可选） */
  honeypot?: string;
  formElapsedSec?: number;
  turnstileToken?: string;
}

export interface VerifyInput {
  verificationId: string;
  code: string;
  ip?: string;
  /** 客户端声明语言（缺省用验证码记录里的 locale） */
  locale?: Locale;
}

export interface LoginInput {
  email?: string;
  phone?: string;
  password: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface PublicUser {
  id: string;
  publicId: string;
  email: string | null;
  phone: string | null;
  displayName: string | null;
  avatarAssetId: string | null;
  locale: string;
  timezone: string;
  planId: string;
  /** 计划 code（free/pro/enterprise），access token 的 plan 声明用它，**不是 planId** */
  planCode: string;
  status: string;
  createdAt: Date;
}

export interface ServiceUser {
  id: string;
  publicId: string;
  email: string | null;
  phone: string | null;
  displayName: string | null;
  avatarAssetId: string | null;
  locale: string;
  timezone: string;
  planId: string;
  status: string;
  createdAt: string;
}

export interface PlanView {
  code: string;
  nameI18n: unknown;
  monthlyCredits: number;
  maxConcurrency: number;
  features: unknown;
}

export interface MeView {
  user: ServiceUser & { plan: PlanView };
  balance: { credits: number; expiringSoon: number };
}

export interface UpdateProfileInput {
  displayName?: string;
  avatarAssetId?: string;
  timezone?: string;
}

// ---------------------------------------------------------------- 内部工具

/** 归一化标识（邮箱小写；手机去空格与连字符） */
export function normalizeIdentifier(input: { email?: string; phone?: string }):
  | { kind: 'email'; value: string }
  | { kind: 'phone'; value: string } {
  if (input.email && input.email.trim().length > 0) {
    return { kind: 'email', value: input.email.trim().toLowerCase() };
  }
  if (input.phone && input.phone.trim().length > 0) {
    return { kind: 'phone', value: input.phone.replace(/[\s-]/g, '') };
  }
  throw err.invalidParams({ field: 'email|phone', message: 'email or phone is required' });
}

/** 标识脱敏（日志用） */
function mask(v: string): string {
  return v.includes('@') ? maskEmail(v) : maskPhone(v);
}

/**
 * 取 free 计划（新用户默认计划），缺失即数据未播种。
 * ⚠️ 返回的 `plan.code` 是 Prisma `PlanCode` 枚举（TS 联合类型），
 * 直接赋给 `planCode: string` 字段没问题，但反过来不行 —— 因此这里显式 String() 收敛。
 */
async function loadFreePlan(client: DbLike) {
  const plan = await client.plan.findUnique({ where: { code: 'free' } });
  if (!plan) throw err.internal({ reason: 'free plan missing; run prisma seed' });
  return { id: plan.id, code: String(plan.code) };
}

function toServiceUser(user: PublicUser): ServiceUser {
  return {
    id: user.publicId,
    publicId: user.publicId,
    email: user.email,
    phone: user.phone,
    displayName: user.displayName,
    avatarAssetId: user.avatarAssetId,
    locale: user.locale,
    timezone: user.timezone,
    planId: user.planId,
    status: user.status,
    createdAt: user.createdAt.toISOString(),
  };
}

/** 由对外用户视图签发 access token（plan 取 code，不是 UUID） */
function accessTokenFor(user: PublicUser): string {
  return signAccessToken({
    id: user.id,
    publicId: user.publicId,
    planCode: user.planCode,
    locale: user.locale,
  });
}

// ---------------------------------------------------------------- 服务

export class AuthService {
  /**
   * 注册第一步：发验证码（限流 + 反刷号风控；已存在用户同样返回，防用户枚举）。
   *
   * 风控顺序：先跑 anti-abuse（域名黑名单 / IP 配额 / Turnstile），再落码与发信 ——
   * 被拦时**不创建验证码、不消耗 Resend 额度**。
   */
  async register(
    input: RegisterInput,
  ): Promise<{ verificationId: string; expiresInSec: number }> {
    const ident = normalizeIdentifier(input);

    // 同一标识 1/min
    const byId = await hitIdentifier(ident.value);
    if (!byId.allowed) throw err.rateLimited(byId.retryAfter);

    // 同一 IP 10/min
    if (input.ip) {
      const byIp = await hitRegisterIp(input.ip);
      if (!byIp.allowed) throw err.rateLimited(byIp.retryAfter);
    }

    if (ident.kind === 'phone' && getConfig().NODE_ENV === 'production') {
      log.warn({ ip: input.ip }, 'register with phone rejected: no SMS channel');
      throw err.smsNotConfigured();
    }

    // ---- 反机器批量刷号（仅邮箱；手机在 production 已上面拦掉）----
    const decision = await assessSignupRisk({
      email: ident.value,
      ...(input.ip ? { ip: input.ip } : {}),
      ...(input.honeypot !== undefined ? { honeypot: input.honeypot } : {}),
      ...(input.formElapsedSec !== undefined ? { formElapsedSec: input.formElapsedSec } : {}),
      ...(input.turnstileToken !== undefined ? { turnstileToken: input.turnstileToken } : {}),
      stage: 'register',
    });
    await recordRiskDecision({
      identifier: ident.value,
      stage: 'register',
      verdict: decision.verdict,
      ...(decision.reason ? { reason: decision.reason } : {}),
      ...(input.ip ? { ip: input.ip } : {}),
      signals: decision.signals,
    });
    if (decision.verdict === 'block') {
      log.warn(
        { identifier: mask(ident.value), ip: input.ip, reason: decision.reason },
        'register blocked by signup risk',
      );
      // 统一话术，不暴露具体规则（防逐条试探）
      throw blockedError();
    }

    const locale: Locale = input.locale ?? 'en';
    const { verificationId, expiresInSec, code } = await createVerification(ident.value, locale, 'register');

    // 真实发送（邮箱）。失败直接抛 → 前端明确展示，不吞。
    if (ident.kind === 'email') {
      await this.dispatchCode(ident.value, code, locale, 'register');
    }

    // 不做存在性判断（否则可枚举用户）：已注册也照发码，verify 时走登录分支
    log.info({ identifier: mask(ident.value), ip: input.ip }, 'register code issued');
    return { verificationId, expiresInSec };
  }

  /**
   * 注册第二步：校验码 → 已存在返回 `{ exists: true }`（去登录/找回），
   * 不存在返回一次性 `{ verifiedToken }`（5min，用于第三步设密码）。
   * 建号动作**只在 set-password 发生**，verify 本身不写用户行。
   */
  async verify(
    input: VerifyInput,
  ): Promise<
    | { exists: true }
    | { exists: false; verifiedToken: string; expiresInSec: number }
  > {
    const result = await consumeVerification(input.verificationId, input.code, 'register');
    if (!result.ok) {
      if (result.reason === 'locked') {
        throw err.rateLimited(result.retryAfterSec ?? MAX_ATTEMPTS * 60);
      }
      if (result.reason === 'not_found') {
        throw err.invalidParams({ reason: 'verification_expired' });
      }
      if (result.reason === 'wrong_purpose') {
        throw err.invalidParams({ reason: 'wrong_purpose' });
      }
      throw err.invalidParams({ reason: 'code_mismatch', attemptsLeft: result.attemptsLeft ?? 0 });
    }

    const record: VerificationRecord = result.record;
    const locale: Locale = input.locale ?? (isLocale(record.locale) ? record.locale : 'en');
    const isEmail = record.identifier.includes('@');

    const existing = await db().user.findFirst({
      where: isEmail ? { email: record.identifier } : { phone: record.identifier },
      select: { id: true },
    });
    if (existing) {
      return { exists: true };
    }

    const verifiedToken = await issueVerifiedToken({
      identifier: record.identifier,
      locale,
      purpose: 'register',
    });
    const { VERIFIED_TOKEN_TTL_SEC } = await import('./verified-token.js');
    return { exists: false, verifiedToken, expiresInSec: VERIFIED_TOKEN_TTL_SEC };
  }

  /**
   * 注册第三步：凭一次性 verifiedToken 设密码 → 建号（含 100 积分）→ 发令牌对。
   * 并发双击同一 token：第一个建号，第二个消费不到 token；
   * 此时按标识回查到已存在用户 → 直接为其设密码并登录（幂等视角）。
   */
  async setPassword(
    input: { verifiedToken: string; password: string },
  ): Promise<{ user: ServiceUser; accessToken: string; refreshToken: string }> {
    const policy = validatePasswordPolicy(input.password);
    if (!policy.ok) throw err.weakPassword(policy.reason);

    const payload = await consumeVerifiedToken(input.verifiedToken, 'register');
    if (!payload) throw err.invalidParams({ reason: 'verified_token_invalid' });

    const isEmail = payload.identifier.includes('@');
    const where = isEmail ? { email: payload.identifier } : { phone: payload.identifier };
    const passwordHash = await hashPassword(input.password);

    // 先查：token 复用竞态下用户可能已建好 → 直接设密码（幂等视角）
    const pre = await db().user.findFirst({ where, select: { id: true } });
    if (pre) {
      await db().user.update({ where: { id: pre.id }, data: { passwordHash, lastLoginAt: new Date() } });
      const user = await this.loadPublicUser(pre.id);
      return {
        user: toServiceUser(user),
        accessToken: accessTokenFor(user),
        refreshToken: await issueRefreshToken(user.id),
      };
    }

    try {
      const created = await this.createUserWithSignupGrant(
        {
          ...(isEmail ? { email: payload.identifier } : { phone: payload.identifier }),
          locale: payload.locale,
          passwordHash,
        },
      );
      return {
        user: toServiceUser(created.user),
        accessToken: signAccessToken({
          id: created.user.id,
          publicId: created.user.publicId,
          planCode: created.planCode,
          locale: created.user.locale,
        }),
        refreshToken: created.refreshToken,
      };
    } catch (e) {
      // 并发建号撞唯一索引 → 回读已存在用户并设密码（与上面的 pre 同语义）
      if (typeof e === 'object' && e !== null && (e as { code?: string }).code === 'P2002') {
        const dup = await db().user.findFirst({ where, select: { id: true } });
        if (!dup) throw e;
        await db().user.update({ where: { id: dup.id }, data: { passwordHash, lastLoginAt: new Date() } });
        const user = await this.loadPublicUser(dup.id);
        return {
          user: toServiceUser(user),
          accessToken: accessTokenFor(user),
          refreshToken: await issueRefreshToken(user.id),
        };
      }
      throw e;
    }
  }

  /**
   * 找回第一步：申请验证码（用户不存在也同样返回成功，防枚举）。
   * 仅邮箱；手机生产环境无通道 → 503。
   */
  async recoveryRequest(
    input: RegisterInput,
  ): Promise<{ verificationId: string; expiresInSec: number }> {
    const ident = normalizeIdentifier(input);
    if (ident.kind !== 'email') {
      if (getConfig().NODE_ENV === 'production') throw err.smsNotConfigured();
      // 非生产：沿用旧行为（日志码），方便联调
    }

    const byId = await hitIdentifier(`recovery:${ident.value}`);
    if (!byId.allowed) throw err.rateLimited(byId.retryAfter);
    if (input.ip) {
      const byIp = await hitRegisterIp(`recovery:${input.ip}`);
      if (!byIp.allowed) throw err.rateLimited(byIp.retryAfter);
    }

    // 找回同样受风控约束：否则"找回"会变成绕过注册风控的免费发信通道
    //（申请阶段不做存在性判断，攻击者可拿任意邮箱刷这封邮件）
    if (ident.kind === 'email') {
      const decision = await assessSignupRisk({
        email: ident.value,
        ...(input.ip ? { ip: input.ip } : {}),
        ...(input.honeypot !== undefined ? { honeypot: input.honeypot } : {}),
        ...(input.formElapsedSec !== undefined ? { formElapsedSec: input.formElapsedSec } : {}),
        ...(input.turnstileToken !== undefined ? { turnstileToken: input.turnstileToken } : {}),
        stage: 'recovery_request',
      });
      await recordRiskDecision({
        identifier: ident.value,
        stage: 'recovery_request',
        verdict: decision.verdict,
        ...(decision.reason ? { reason: decision.reason } : {}),
        ...(input.ip ? { ip: input.ip } : {}),
        signals: decision.signals,
      });
      if (decision.verdict === 'block') {
        log.warn(
          { identifier: mask(ident.value), ip: input.ip, reason: decision.reason },
          'recovery blocked by signup risk',
        );
        throw blockedError();
      }
    }

    const locale: Locale = input.locale ?? 'en';
    const { verificationId, expiresInSec, code } = await createVerification(ident.value, locale, 'recovery');

    if (ident.kind === 'email') {
      await this.dispatchCode(ident.value, code, locale, 'recovery');
    }

    log.info({ identifier: mask(ident.value), ip: input.ip }, 'recovery code issued');
    return { verificationId, expiresInSec };
  }

  /**
   * 找回第二步：验证码 → 一次性 verifiedToken（5min，用于第三步设新密码）。
   * 申请时未做存在性判断；到这一步必须能定位到用户 —— 攻击者没有真码走不到这里，
   * 因此"用户不存在"可明确报错而不算枚举漏洞（注释说明，免得后人"优化"掉）。
   */
  async recoveryConfirm(
    input: VerifyInput,
  ): Promise<{ verifiedToken: string; expiresInSec: number }> {
    const result = await consumeVerification(input.verificationId, input.code, 'recovery');
    if (!result.ok) {
      if (result.reason === 'locked') {
        throw err.rateLimited(result.retryAfterSec ?? MAX_ATTEMPTS * 60);
      }
      if (result.reason === 'not_found') {
        throw err.invalidParams({ reason: 'verification_expired' });
      }
      if (result.reason === 'wrong_purpose') {
        throw err.invalidParams({ reason: 'wrong_purpose' });
      }
      throw err.invalidParams({ reason: 'code_mismatch', attemptsLeft: result.attemptsLeft ?? 0 });
    }

    const record = result.record;
    const isEmail = record.identifier.includes('@');
    const user = await db().user.findFirst({
      where: isEmail ? { email: record.identifier } : { phone: record.identifier },
      select: { id: true, status: true, deletedAt: true },
    });
    if (!user) throw err.invalidParams({ reason: 'account_not_found' });
    this.assertUsable(user.status, user.deletedAt);

    const verifiedToken = await issueVerifiedToken({
      identifier: record.identifier,
      locale: isLocale(record.locale) ? record.locale : 'en',
      purpose: 'recovery',
    });
    const { VERIFIED_TOKEN_TTL_SEC } = await import('./verified-token.js');
    return { verifiedToken, expiresInSec: VERIFIED_TOKEN_TTL_SEC };
  }

  /**
   * 找回第三步：凭 token 设新密码 → 撤销该账号全部 refresh token
   * （找回意味着旧密码已不可信，所有设备强制重新登录）。
   */
  async recoveryReset(
    input: { verifiedToken: string; newPassword: string },
  ): Promise<{ reset: true }> {
    const policy = validatePasswordPolicy(input.newPassword);
    if (!policy.ok) throw err.weakPassword(policy.reason);

    const payload = await consumeVerifiedToken(input.verifiedToken, 'recovery');
    if (!payload) throw err.invalidParams({ reason: 'verified_token_invalid' });

    const isEmail = payload.identifier.includes('@');
    const user = await db().user.findFirst({
      where: isEmail ? { email: payload.identifier } : { phone: payload.identifier },
      select: { id: true, status: true, deletedAt: true },
    });
    if (!user) throw err.invalidParams({ reason: 'account_not_found' });
    this.assertUsable(user.status, user.deletedAt);

    await db().user.update({
      where: { id: user.id },
      data: { passwordHash: await hashPassword(input.newPassword), lastLoginAt: new Date() },
    });
    await revokeAllForUser(user.id);
    log.info({ userId: user.id }, 'password recovered, all refresh tokens revoked');
    return { reset: true };
  }

  /** 密码登录（5 次失败锁 15min） */
  async login(input: LoginInput): Promise<{ user: ServiceUser; accessToken: string; refreshToken: string }> {
    const ident = normalizeIdentifier(input);

    const lockRemain = await loginFailRemaining(ident.value);
    if (lockRemain > 0) throw err.rateLimited(lockRemain);

    const isEmail = ident.kind === 'email';
    const user = await db().user.findFirst({
      where: isEmail ? { email: ident.value } : { phone: ident.value },
      include: { profile: true, preferences: true },
    });

    // 用户不存在与密码错误统一 401（防枚举）
    const passwordOk = user ? await verifyPassword(input.password, user.passwordHash) : false;
    if (!user || !passwordOk) {
      const fail = await recordFailure(ident.value);
      log.warn({ identifier: mask(ident.value), locked: fail.locked }, 'login failed');
      if (fail.locked) throw err.rateLimited(fail.retryAfter);
      throw err.unauthorized();
    }

    this.assertUsable(user.status, user.deletedAt);

    await clearFailures(ident.value);
    await db().user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

    const publicUser = await this.loadPublicUser(user.id);
    return {
      user: toServiceUser(publicUser),
      accessToken: accessTokenFor(publicUser),
      refreshToken: await issueRefreshToken(publicUser.id),
    };
  }

  /**
   * OAuth 登录（google：JWKS 真实验签；apple：仍为 TODO，占位实现）。
   */
  async oauth(
    provider: string,
    idToken: string,
    locale: Locale = 'en',
  ): Promise<{ user: ServiceUser; accessToken: string; refreshToken: string; isNewUser: boolean }> {
    const normalized = provider.toLowerCase();
    if (normalized !== 'google' && normalized !== 'apple') {
      throw err.invalidParams({ provider, supported: ['google', 'apple'] });
    }

    // Google 走 JWKS 真实验签（iss/aud/exp 全校验）；Apple 暂保持旧实现。
    const claims = normalized === 'google'
      ? await verifyGoogleIdToken(idToken)
      : decodeIdTokenPayload(idToken);
    if (!claims.sub) throw err.unauthorized({ reason: 'id_token_missing_sub' });

    const bound = await db().oAuthAccount.findUnique({
      where: { provider_providerId: { provider: normalized, providerId: claims.sub } },
      include: { user: { include: { profile: true, preferences: true } } },
    });

    if (bound) {
      this.assertUsable(bound.user.status, bound.user.deletedAt);
      await db().user.update({ where: { id: bound.userId }, data: { lastLoginAt: new Date() } });
      const user = await this.loadPublicUser(bound.userId);
      return {
        user: toServiceUser(user),
        accessToken: accessTokenFor(user),
        refreshToken: await issueRefreshToken(user.id),
        isNewUser: false,
      };
    }

    // 邮箱已存在 → 直接绑定（同邮箱视为同一人）
    if (claims.email) {
      const existing = await db().user.findUnique({ where: { email: claims.email.toLowerCase() } });
      if (existing) {
        this.assertUsable(existing.status, existing.deletedAt);
        await db().oAuthAccount.create({
          data: { userId: existing.id, provider: normalized, providerId: claims.sub },
        });
        const user = await this.loadPublicUser(existing.id);
        return {
          user: toServiceUser(user),
          accessToken: accessTokenFor(user),
          refreshToken: await issueRefreshToken(user.id),
          isNewUser: false,
        };
      }
    }

    const created = await this.createUserWithSignupGrant(
      {
        ...(claims.email ? { email: claims.email.toLowerCase() } : {}),
        locale,
      },
      { provider: normalized, providerId: claims.sub },
    );

    return {
      user: toServiceUser(created.user),
      accessToken: signAccessToken({
        id: created.user.id,
        publicId: created.user.publicId,
        planCode: created.planCode,
        locale: created.user.locale,
      }),
      refreshToken: created.refreshToken,
      isNewUser: true,
    };
  }

  /** 刷新（轮换）：旧 token 立即失效 */
  async refresh(rawToken: string): Promise<{ accessToken: string; refreshToken: string }> {
    const rotated = await rotateRefreshToken(rawToken);
    const user = await this.loadPublicUser(rotated.userId);
    return {
      accessToken: accessTokenFor(user),
      refreshToken: rotated.rawToken,
    };
  }

  /** 登出（幂等：token 不存在/已撤销也返回成功） */
  async logout(rawToken: string): Promise<{ revoked: true }> {
    await revokeRefreshToken(rawToken);
    return { revoked: true };
  }

  /** 当前用户 + 计划 + 积分余额 */
  async me(userId: string): Promise<MeView> {
    const user = await db().user.findUnique({
      where: { id: userId },
      include: { plan: true, profile: true, preferences: true },
    });
    if (!user) throw err.unauthorized();
    this.assertUsable(user.status, user.deletedAt);

    const timezone =
      user.preferences?.timezone ?? LOCALE_TIMEZONE[(isLocale(user.locale) ? user.locale : 'en') as Locale];
    const base: PublicUser = {
      id: user.id,
      publicId: user.publicId,
      email: user.email,
      phone: user.phone,
      displayName: user.profile?.displayName ?? null,
      avatarAssetId: user.profile?.avatarAssetId ?? null,
      locale: user.locale,
      timezone,
      planId: user.planId,
      planCode: String(user.plan.code),
      status: user.status,
      createdAt: user.createdAt,
    };

    const balance = await this.balance(userId);

    return {
      user: {
        ...toServiceUser(base),
        plan: {
          code: user.plan.code,
          nameI18n: user.plan.nameI18n,
          monthlyCredits: user.plan.monthlyCredits,
          maxConcurrency: user.plan.maxConcurrency,
          features: user.plan.features,
        },
      },
      balance,
    };
  }

  /**
   * 余额视图。
   * - credits：`SUM(delta)` **全量求和**（含过期批次），过期语义由 00:00 的 `expire` 负向流水表达（§2.5）
   * - expiringSoon：未来 24h 内到期的正向批次合计，**仅提示，不参与余额**
   */
  async balance(userId: string): Promise<{ credits: number; expiringSoon: number }> {
    const now = new Date();
    const [total, soon] = await Promise.all([
      db().creditLedger.aggregate({ where: { userId }, _sum: { delta: true } }),
      db().creditLedger.aggregate({
        where: {
          userId,
          delta: { gt: 0 },
          expiresAt: { gt: now, lte: new Date(now.getTime() + EXPIRING_SOON_WINDOW_MS) },
        },
        _sum: { delta: true },
      }),
    ]);
    return {
      credits: total._sum.delta ?? 0,
      expiringSoon: soon._sum.delta ?? 0,
    };
  }

  /** 更新资料 / 偏好（头像必须是本人上传的图片资产） */
  async updateProfile(userId: string, input: UpdateProfileInput): Promise<ServiceUser> {
    if (input.avatarAssetId !== undefined) {
      const asset = await db().asset.findUnique({
        where: { id: input.avatarAssetId },
        select: { id: true, userId: true, kind: true, mimeType: true, deletedAt: true },
      });
      if (
        !asset ||
        asset.deletedAt !== null ||
        asset.userId !== userId ||
        asset.kind !== 'upload' ||
        !asset.mimeType.startsWith('image/')
      ) {
        throw err.invalidParams({
          field: 'avatarAssetId',
          reason: 'must be your own uploaded image asset',
        });
      }
    }

    await transaction(async (tx) => {
      const profileUpdate: Prisma.UserProfileUpdateInput = {};
      if (input.displayName !== undefined) profileUpdate.displayName = input.displayName;
      if (input.avatarAssetId !== undefined) profileUpdate.avatarAssetId = input.avatarAssetId;
      if (Object.keys(profileUpdate).length > 0) {
        await tx.userProfile.upsert({
          where: { userId },
          create: {
            userId,
            ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
            ...(input.avatarAssetId !== undefined ? { avatarAssetId: input.avatarAssetId } : {}),
          },
          update: profileUpdate,
        });
      }

      if (input.timezone !== undefined) {
        await tx.userPreference.upsert({
          where: { userId },
          create: { userId, timezone: input.timezone },
          update: { timezone: input.timezone },
        });
      }
    });

    return toServiceUser(await this.loadPublicUser(userId));
  }

  /** 修改密码：需旧密码；成功后撤销全部 refresh token（强制其他设备重新登录） */
  async changePassword(
    userId: string,
    input: { oldPassword: string; newPassword: string },
  ): Promise<{ changed: true }> {
    const user = await db().user.findUnique({
      where: { id: userId },
      select: { id: true, passwordHash: true, status: true, deletedAt: true },
    });
    if (!user) throw err.unauthorized();
    this.assertUsable(user.status, user.deletedAt);

    // 新密码执行统一复杂度策略（≥6 位 + 字母 + 数字），与注册/找回一致
    const policy = validatePasswordPolicy(input.newPassword);
    if (!policy.ok) throw err.weakPassword(policy.reason);

    const oldOk = await verifyPassword(input.oldPassword, user.passwordHash);
    if (!oldOk) throw err.passwordRequired();

    await db().user.update({
      where: { id: userId },
      data: { passwordHash: await hashPassword(input.newPassword) },
    });
    await revokeAllForUser(userId);
    log.info({ userId }, 'password changed, all refresh tokens revoked');
    return { changed: true };
  }

  /** 账号注销：软删 + 撤销令牌 + 审计（任务/资产保留 30 天后硬删） */
  async deleteAccount(userId: string, input: { password?: string }): Promise<{ deleted: true }> {
    const user = await db().user.findUnique({
      where: { id: userId },
      select: { id: true, publicId: true, email: true, phone: true, passwordHash: true, status: true },
    });
    if (!user) throw err.unauthorized();
    if (user.status === 'deleted') throw err.accountDeletionPending();

    // OAuth 用户无密码 → 跳过密码校验
    if (user.passwordHash) {
      const ok = await verifyPassword(input.password ?? '', user.passwordHash);
      if (!ok) throw err.passwordRequired();
    }

    const now = new Date();
    await transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: { status: 'deleted', deletedAt: now },
      });
      await tx.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: now },
      });
      await tx.adminAuditLog.create({
        data: {
          adminKey: 'self',
          action: 'account.delete',
          target: { userId, publicId: user.publicId },
          payload: {
            email: user.email ? mask(user.email) : null,
            phone: user.phone ? mask(user.phone) : null,
            retentionDays: getConfig().RETENTION_FREE_DAYS,
          },
        },
      });
    });

    log.warn({ userId }, 'account deleted');
    return { deleted: true };
  }

  // -------------------------------------------------------------- 内部

  /**
   * 发码并**把通道错误翻译成 AppError**。
   *
   * 为什么需要这层：`MailError` 不是 `AppError`，直接冒泡到 http.ts 会被当成未知异常
   * → 500 INTERNAL_ERROR，前端只能显示"服务器错误"，看不出真正原因
   * （实测踩过：Resend 对 example.com 类测试域返回 422，前端却看到 500）。
   * 这里按 4xx/5xx 分流：配置/参数问题 → 503 EMAIL_NOT_CONFIGURED（运营可据此排查），
   * 上游 5xx/超时 → 503 SERVICE_UNAVAILABLE（可重试）；两者都保留原因到 details。
   */
  private async dispatchCode(
    to: string,
    code: string,
    locale: Locale,
    purpose: 'register' | 'recovery',
  ): Promise<void> {
    try {
      await sendVerificationEmail({ to, code, purpose, locale });
    } catch (e) {
      if (e instanceof MailError) {
        log.error({ to: mask(to), status: e.status, purpose }, 'verification mail dispatch failed');
        // 4xx = 我方配置或收件人域不被接受（Resend 限制）→ 明确告知运营配置问题
        if (e.status !== undefined && e.status >= 400 && e.status < 500) {
          throw err.emailNotConfigured();
        }
        throw err.serviceUnavailable('mail_provider_unavailable');
      }
      throw e;
    }
  }

  /** 状态守卫：注销中 → 409，非 active → 401 */
  private assertUsable(status: string, deletedAt: Date | null): void {
    if (status === 'deleted' || deletedAt !== null) throw err.accountDeletionPending();
    if (status !== 'active') throw err.unauthorized();
  }

  /** 读取对外用户视图（含 profile/preference 兜底时区） */
  private async loadPublicUser(userId: string): Promise<PublicUser> {
    const user = await db().user.findUnique({
      where: { id: userId },
      include: { profile: true, preferences: true, plan: { select: { code: true } } },
    });
    if (!user) throw err.unauthorized();
    const locale = isLocale(user.locale) ? user.locale : 'en';
    return {
      id: user.id,
      publicId: user.publicId,
      email: user.email,
      phone: user.phone,
      displayName: user.profile?.displayName ?? null,
      avatarAssetId: user.profile?.avatarAssetId ?? null,
      locale: user.locale,
      timezone: user.preferences?.timezone ?? LOCALE_TIMEZONE[locale],
      planId: user.planId,
      planCode: String(user.plan.code),
      status: user.status,
      createdAt: user.createdAt,
    };
  }

  /**
   * **单事务**建号：User + UserProfile + UserPreference + 注册赠送（CreditLedger + Grant）。
   * 赠送流水幂等键 `signup:<userId>` + `(userId, idempotencyKey)` 唯一索引 → 重复不会双发。
   */
  private async createUserWithSignupGrant(
    input: { email?: string; phone?: string; locale: Locale; passwordHash?: string },
    oauth?: { provider: string; providerId: string },
  ): Promise<{ user: PublicUser; planCode: string; refreshToken: string }> {
    const cfg = getConfig();
    const publicId = newPublicId('user');
    let freePlanCode = 'free';

    const created = await transaction(async (tx) => {
      const plan = await loadFreePlan(tx);
      freePlanCode = plan.code;
      const now = new Date();
      const expiresAt = new Date(now.getTime() + cfg.SIGNUP_GRANT_TTL_DAYS * 24 * 60 * 60 * 1000);
      const user = await tx.user.create({
        data: {
          publicId,
          ...(input.email ? { email: input.email } : {}),
          ...(input.phone ? { phone: input.phone } : {}),
          ...(input.passwordHash ? { passwordHash: input.passwordHash } : {}),
          locale: input.locale,
          planId: plan.id,
          status: 'active',
          lastLoginAt: now,
          profile: { create: {} },
          preferences: {
            create: { locale: input.locale, timezone: LOCALE_TIMEZONE[input.locale] },
          },
          ...(oauth
            ? { oauthAccounts: { create: { provider: oauth.provider, providerId: oauth.providerId } } }
            : {}),
        },
        include: { profile: true, preferences: true },
      });

      // 注册赠送 100 积分（7 天有效）；幂等键唯一，重放不会双发
      const amount = cfg.SIGNUP_GRANT_CREDITS;
      if (amount > 0) {
        await tx.creditLedger.create({
          data: {
            userId: user.id,
            delta: amount,
            type: 'grant_signup',
            balanceAfter: amount,
            idempotencyKey: `signup:${user.id}`,
            expiresAt,
            note: 'signup grant',
          },
        });
        await tx.grant.create({
          data: {
            userId: user.id,
            type: 'signup',
            amount,
            lastGrantedAt: now,
            nextGrantAt: expiresAt,
            expiresAt,
          },
        });
      }

      return user;
    });

    const publicUser: PublicUser = {
      id: created.id,
      publicId: created.publicId,
      email: created.email,
      phone: created.phone,
      displayName: created.profile?.displayName ?? null,
      avatarAssetId: created.profile?.avatarAssetId ?? null,
      locale: created.locale,
      timezone: created.preferences?.timezone ?? LOCALE_TIMEZONE[input.locale],
      planId: created.planId,
      planCode: freePlanCode,
      status: created.status,
      createdAt: created.createdAt,
    };

    // refresh token 在事务外签发（失败不影响建号；客户端可用密码/OAuth 重新登录）
    const refreshToken = await issueRefreshToken(created.id);
    log.info({ userId: created.id, publicId, credits: cfg.SIGNUP_GRANT_CREDITS }, 'user registered');

    return { user: publicUser, planCode: freePlanCode, refreshToken };
  }

  /** 校验用：确认 refresh token 摘要存在（诊断/测试） */
  async isRefreshTokenActive(rawToken: string): Promise<boolean> {
    const row = await db().refreshToken.findUnique({
      where: { tokenHash: hashRefreshToken(rawToken) },
      select: { revokedAt: true, expiresAt: true },
    });
    if (!row) return false;
    return row.revokedAt === null && row.expiresAt.getTime() > Date.now();
  }
}

/** 单例（无状态，可直接复用） */
export const authService = new AuthService();

// ---------------------------------------------------------------- id_token 解析

interface IdTokenClaims {
  sub: string | null;
  email: string | null;
  emailVerified: boolean;
}

/**
 * 解析 id_token 的 payload（**不验签**）。
 *
 * ⚠️ Phase 2 必须替换为真实验签：
 *   - Google：`https://www.googleapis.com/oauth2/v3/certs` JWKS + iss/aud/exp 校验
 *   - Apple：`https://appleid.apple.com/auth/keys` JWKS + aud/iss/exp/nonce 校验
 * 当前实现仅用于本地/联调，生产环境**不可信任**这些 claims。
 */
export function decodeIdTokenPayload(idToken: string): IdTokenClaims {
  const parts = idToken.split('.');
  const payload = parts[1];
  if (parts.length < 2 || !payload) {
    throw err.invalidParams({ field: 'idToken', reason: 'malformed_jwt' });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    throw err.invalidParams({ field: 'idToken', reason: 'malformed_payload' });
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw err.invalidParams({ field: 'idToken', reason: 'malformed_payload' });
  }
  const c = parsed as Record<string, unknown>;
  return {
    sub: typeof c.sub === 'string' && c.sub.length > 0 ? c.sub : null,
    email: typeof c.email === 'string' && c.email.length > 0 ? c.email : null,
    emailVerified: c.email_verified === true,
  };
}
