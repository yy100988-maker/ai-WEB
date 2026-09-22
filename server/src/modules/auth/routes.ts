/**
 * 认证路由（详细设计 §2.2 / PRD §8.1）。
 *
 *   POST  /v1/auth/register          发验证码（匿名，严格限流）
 *   POST  /v1/auth/verify            校验码 → { exists } 或 { verifiedToken }（不直接建号）
 *   POST  /v1/auth/set-password      凭 verifiedToken 设密码 → 建号 + token 对
 *   POST  /v1/auth/recovery/request  找回：发验证码（匿名，防枚举）
 *   POST  /v1/auth/recovery/confirm  找回：校验码 → { verifiedToken }
 *   POST  /v1/auth/recovery/reset    找回：凭 token 设新密码（踢掉全部登录态）
 *   POST  /v1/auth/login             密码登录
 *   POST  /v1/auth/oauth/:provider   Google（JWKS 验签）/ Apple（占位）
 *   GET   /v1/auth/oauth-providers   公开：已启用的 OAuth 提供方（前端按此渲染按钮）
 *   POST  /v1/auth/refresh           轮换 refresh token
 *   POST  /v1/auth/logout            撤销 refresh（幂等）
 *   GET   /v1/auth/me                当前用户 + 计划 + 余额
 *   PATCH /v1/users/me               更新资料
 *   POST  /v1/auth/change-password   修改密码
 *   POST  /v1/account/delete         账号注销
 *
 * 约定：成功 `return ok(req, data)`；失败 `throw err.xxx()`（http.ts 统一序列化 + 本地化）。
 */

import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { ok, type RouteModule } from '../../core/http.js';
import { getConfig } from '../../core/config.js';
import { isLocale, type Locale } from '../../core/types.js';
import { authService } from './service.js';
import { authGuard, currentUserId } from './guard.js';

/** 验证类接口的严格限流：10/min/IP（详细设计 §2.1） */
const STRICT_RATE_LIMIT = { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } } as const;

const identifierSchema = {
  email: z.string().email().max(254).optional(),
  phone: z.string().min(5).max(20).optional(),
};

/**
 * 反刷号行为信号（全部可选）：
 * - `honeypot`：前端隐藏字段，正常用户不会填（机器人常无脑填）
 * - `formElapsedSec`：表单加载到提交的秒数（机器人通常 <1s）
 * - `turnstileToken`：Cloudflare Turnstile token（配置了 Secret 才强制）
 */
const antiAbuseSchema = {
  honeypot: z.string().max(200).optional(),
  formElapsedSec: z.number().min(0).max(86400).optional(),
  turnstileToken: z.string().max(4096).optional(),
};

const registerSchema = z
  .object({
    ...identifierSchema,
    locale: z.string().optional(),
    ...antiAbuseSchema,
  })
  .refine((v) => Boolean(v.email) || Boolean(v.phone), {
    message: 'email or phone is required',
    path: ['email'],
  });

const verifySchema = z.object({
  verificationId: z.string().min(1).max(128),
  code: z.string().regex(/^\d{6}$/, 'code must be 6 digits'),
});

const loginSchema = z
  .object({
    ...identifierSchema,
    password: z.string().min(1).max(200),
  })
  .refine((v) => Boolean(v.email) || Boolean(v.phone), {
    message: 'email or phone is required',
    path: ['email'],
  });

const oauthSchema = z.object({
  idToken: z.string().min(10),
  locale: z.string().optional(),
});

const refreshSchema = z.object({ refreshToken: z.string().min(10) });
const logoutSchema = z.object({ refreshToken: z.string().min(10) });

const updateProfileSchema = z
  .object({
    displayName: z.string().min(1).max(50).optional(),
    avatarAssetId: z.string().uuid().optional(),
    timezone: z.string().min(1).max(64).optional(),
  })
  .refine(
    (v) => v.displayName !== undefined || v.avatarAssetId !== undefined || v.timezone !== undefined,
    { message: 'at least one field is required' },
  );

const changePasswordSchema = z.object({
  oldPassword: z.string().min(1).max(200),
  // 长度上限由服务端策略二次校验（WEAK_PASSWORD 带 reason），这里只卡超长
  newPassword: z.string().min(1).max(200),
});

const setPasswordSchema = z.object({
  verifiedToken: z.string().min(16).max(256),
  password: z.string().min(1).max(200),
});

const recoveryResetSchema = z.object({
  verifiedToken: z.string().min(16).max(256),
  newPassword: z.string().min(1).max(200),
});

// 注销：OAuth 用户无密码，password 可缺省（服务端按是否有密码判断）
const deleteAccountSchema = z.object({ password: z.string().min(1).max(200).optional() });

/** 客户端 locale 解析（非法值回落 en，最终以 Accept-Language 为准由服务端决定） */
function pickLocale(raw: string | undefined, fallback: Locale): Locale {
  return isLocale(raw) ? raw : fallback;
}

export const authRoutes: RouteModule = async (app: FastifyInstance) => {
  authGuard(app);

  // ---------------------------------------------------------------- 注册（发码）
  app.post('/v1/auth/register', { ...STRICT_RATE_LIMIT }, async (req, reply) => {
    const body = registerSchema.parse(req.body);
    const data = await authService.register({
      ...(body.email ? { email: body.email } : {}),
      ...(body.phone ? { phone: body.phone } : {}),
      locale: pickLocale(body.locale, req.locale),
      ip: req.ip,
      ...(body.honeypot !== undefined ? { honeypot: body.honeypot } : {}),
      ...(body.formElapsedSec !== undefined ? { formElapsedSec: body.formElapsedSec } : {}),
      ...(body.turnstileToken !== undefined ? { turnstileToken: body.turnstileToken } : {}),
    });
    reply.status(201);
    return ok(req, data);
  });

  // ---------------------------------------------------------------- 校验验证码
  // 注册第二步：已存在 → { exists: true }；不存在 → 一次性 verifiedToken（去设密码）
  app.post('/v1/auth/verify', { ...STRICT_RATE_LIMIT }, async (req) => {
    const body = verifySchema.parse(req.body);
    const data = await authService.verify({
      verificationId: body.verificationId,
      code: body.code,
      ip: req.ip,
      locale: req.locale,
    });
    return ok(req, data);
  });

  // ---------------------------------------------------------------- 注册设密码
  // 注册第三步：凭 verifiedToken 设密码 → 建号 + token 对
  app.post('/v1/auth/set-password', { ...STRICT_RATE_LIMIT }, async (req, reply) => {
    const body = setPasswordSchema.parse(req.body);
    const data = await authService.setPassword({
      verifiedToken: body.verifiedToken,
      password: body.password,
    });
    reply.status(201);
    return ok(req, data);
  });

  // ---------------------------------------------------------------- 找回：申请
  app.post('/v1/auth/recovery/request', { ...STRICT_RATE_LIMIT }, async (req, reply) => {
    const body = registerSchema.parse(req.body);
    const data = await authService.recoveryRequest({
      ...(body.email ? { email: body.email } : {}),
      ...(body.phone ? { phone: body.phone } : {}),
      locale: pickLocale(body.locale, req.locale),
      ip: req.ip,
      ...(body.honeypot !== undefined ? { honeypot: body.honeypot } : {}),
      ...(body.formElapsedSec !== undefined ? { formElapsedSec: body.formElapsedSec } : {}),
      ...(body.turnstileToken !== undefined ? { turnstileToken: body.turnstileToken } : {}),
    });
    reply.status(201);
    return ok(req, data);
  });

  // ---------------------------------------------------------------- 找回：确认
  app.post('/v1/auth/recovery/confirm', { ...STRICT_RATE_LIMIT }, async (req) => {
    const body = verifySchema.parse(req.body);
    const data = await authService.recoveryConfirm({
      verificationId: body.verificationId,
      code: body.code,
      ip: req.ip,
      locale: req.locale,
    });
    return ok(req, data);
  });

  // ---------------------------------------------------------------- 找回：重置
  app.post('/v1/auth/recovery/reset', { ...STRICT_RATE_LIMIT }, async (req) => {
    const body = recoveryResetSchema.parse(req.body);
    const data = await authService.recoveryReset({
      verifiedToken: body.verifiedToken,
      newPassword: body.newPassword,
    });
    return ok(req, data);
  });

  // ---------------------------------------------------------------- 注册风控配置（公开）
  // 前端据此决定是否渲染 Turnstile 组件（未配置则不渲染，仅靠域名/配额/行为信号）
  app.get('/v1/auth/signup-config', async (req) => {
    const cfg = getConfig();
    return ok(req, {
      turnstileSiteKey: cfg.TURNSTILE_SITE_KEY || null,
      /** 表单最短合理耗时（秒），前端据此判断"过快提交"（仅上报，不影响可用性） */
      minFormElapsedSec: 3,
    });
  });

  // ---------------------------------------------------------------- OAuth 提供方公示
  // 公开接口：前端按此决定是否渲染 Google 按钮（未配置则隐藏，不断头）
  app.get('/v1/auth/oauth-providers', async (req) => {
    const googleClientId = getConfig().GOOGLE_CLIENT_ID;
    return ok(req, {
      providers: [
        ...(googleClientId ? [{ provider: 'google', clientId: googleClientId }] : []),
      ],
    });
  });

  // ---------------------------------------------------------------- 密码登录
  app.post('/v1/auth/login', { ...STRICT_RATE_LIMIT }, async (req) => {
    const body = loginSchema.parse(req.body);
    const data = await authService.login({
      ...(body.email ? { email: body.email } : {}),
      ...(body.phone ? { phone: body.phone } : {}),
      password: body.password,
    });
    return ok(req, data);
  });

  // ---------------------------------------------------------------- OAuth
  app.post('/v1/auth/oauth/:provider', { ...STRICT_RATE_LIMIT }, async (req) => {
    const params = z.object({ provider: z.string().min(1).max(20) }).parse(req.params);
    const body = oauthSchema.parse(req.body);
    const data = await authService.oauth(
      params.provider,
      body.idToken,
      pickLocale(body.locale, req.locale),
    );
    return ok(req, data);
  });

  // ---------------------------------------------------------------- 刷新（轮换）
  app.post('/v1/auth/refresh', async (req) => {
    const body = refreshSchema.parse(req.body);
    return ok(req, await authService.refresh(body.refreshToken));
  });

  // ---------------------------------------------------------------- 登出（幂等）
  app.post('/v1/auth/logout', async (req) => {
    const body = logoutSchema.parse(req.body ?? {});
    return ok(req, await authService.logout(body.refreshToken));
  });

  // ---------------------------------------------------------------- 当前用户
  app.get('/v1/auth/me', { preHandler: [app.requireAuth] }, async (req) => {
    const userId = currentUserId(req);
    return ok(req, await authService.me(userId));
  });

  // ---------------------------------------------------------------- 资料更新
  app.patch('/v1/users/me', { preHandler: [app.requireAuth] }, async (req) => {
    const userId = currentUserId(req);
    const body = updateProfileSchema.parse(req.body);
    const user = await authService.updateProfile(userId, body);
    return ok(req, { user });
  });

  // ---------------------------------------------------------------- 修改密码
  app.post('/v1/auth/change-password', { ...STRICT_RATE_LIMIT, preHandler: [app.requireAuth] }, async (req) => {
    const userId = currentUserId(req);
    const body = changePasswordSchema.parse(req.body);
    return ok(
      req,
      await authService.changePassword(userId, {
        oldPassword: body.oldPassword,
        newPassword: body.newPassword,
      }),
    );
  });

  // ---------------------------------------------------------------- 账号注销
  app.post('/v1/account/delete', { ...STRICT_RATE_LIMIT, preHandler: [app.requireAuth] }, async (req) => {
    const userId = currentUserId(req);
    const body = deleteAccountSchema.parse(req.body ?? {});
    const result = await authService.deleteAccount(userId, {
      ...(body.password ? { password: body.password } : {}),
    });
    return ok(req, result);
  });
};
