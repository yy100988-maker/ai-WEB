/**
 * 邮件发送（Resend HTTP API）。
 *
 * 为什么是独立模块：短信/邮件是可替换通道。发信失败必须**明确抛错**
 * （调用方转 503），绝不静默吞掉 —— 吞掉意味着用户永远收不到码，
 * 而前端还在倒计时，这是最差的用户体验。
 *
 * Resend 约束（调用前必读）：
 * - 未绑定自有域名时，只能用测试域发给 Resend 账户主邮箱
 *   （`MAIL_FROM` 默认即测试域，见 config 注释）。
 * - 发信是出网调用，超时 15s，失败抛 MailError（code/message 供日志，不含收件人明文）。
 */

import { childLogger, maskEmail } from '../../core/logger.js';
import { getConfig } from '../../core/config.js';
import { err } from '../../core/errors.js';
import type { Locale } from '../../core/types.js';
import type { VerificationPurpose } from './verification.js';

const log = childLogger({ mod: 'mailer' });

const RESEND_ENDPOINT = 'https://api.resend.com/emails';
const SEND_TIMEOUT_MS = 15000;

export class MailError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly retriable = false,
  ) {
    super(message);
    this.name = 'MailError';
  }
}

interface VerificationMailText {
  subject: string;
  greeting: string;
  body: string;
  expireNote: string;
}

/** 验证码邮件文案（中英；其余语种回落英文，由调用方 locale 决定） */
function verificationText(code: string, purpose: VerificationPurpose, locale: Locale): VerificationMailText {
  const isZh = locale === 'zh-CN' || locale === 'zh-TW';
  const isTw = locale === 'zh-TW';
  const action = purpose === 'recovery'
    ? isZh ? (isTw ? '重設密碼' : '重置密码') : 'reset your password'
    : isZh ? (isTw ? '完成註冊' : '完成注册') : 'finish sign-up';
  return {
    subject: isZh ? `【Vutu】验证码 ${code}（${action}）` : `[Vutu] Verification code ${code} (${action})`,
    greeting: isZh ? '你好，' : 'Hi,',
    body: isZh
      ? `你正在${action}，验证码是：${code}。切勿转发给他人。`
      : `You are trying to ${action}. Your code is: ${code}. Never share it.`,
    expireNote: isZh ? '验证码 5 分钟内有效。' : 'The code expires in 5 minutes.',
  };
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * 发送验证码邮件。
 * - 无 RESEND_API_KEY：非生产只记日志（联调用）；生产抛 EMAIL_NOT_CONFIGURED，
 *   调用方必须转给前端明确展示，不能吞。
 */
export async function sendVerificationEmail(input: {
  to: string;
  code: string;
  purpose: VerificationPurpose;
  locale?: Locale;
}): Promise<{ id: string }> {
  const cfg = getConfig();
  const locale = input.locale ?? 'en';

  // 测试/压测环境抑制：只写日志，绝不真的发信。
  // 为什么必须有这个开关：E2E 用 `e2e-xxx@example.com` 这类假邮箱，
  // 一旦真实调用 Resend 会被拒（Invalid `to` field）→ 503 → 测试挂在与被测逻辑
  // 无关的外部依赖上；同时避免 CI 误发给真实用户。
  //
  // ⚠️ 只看这一个显式开关，**不要**顺手写成 `|| NODE_ENV === 'test'`：
  // 那会让"专测发信分支"的用例（如无 Key 时走 dev-noop / production 抛 503）
  // 永远走不到目标代码路径，测试变成假绿。
  if (cfg.MAIL_SUPPRESS) {
    log.info(
      { to: maskEmail(input.to), code: input.code, purpose: input.purpose },
      'verification email suppressed',
    );
    return { id: 'suppressed' };
  }

  if (!cfg.RESEND_API_KEY) {
    if (cfg.NODE_ENV !== 'production') {
      log.info(
        { to: maskEmail(input.to), code: input.code, purpose: input.purpose },
        'verification email (dev only, no RESEND_API_KEY)',
      );
      return { id: 'dev-noop' };
    }
    log.error({ to: maskEmail(input.to), purpose: input.purpose }, 'RESEND_API_KEY missing in production');
    throw err.emailNotConfigured();
  }

  const text = verificationText(input.code, input.purpose, locale);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), SEND_TIMEOUT_MS);
  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${cfg.RESEND_API_KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: cfg.MAIL_FROM,
        to: [input.to],
        subject: text.subject,
        text: `${text.greeting}\n${text.body}\n${text.expireNote}`,
        html: `<p>${escapeHtml(text.greeting)}</p><p>${escapeHtml(text.body)}</p><p style="font-size:42px;letter-spacing:8px"><b>${escapeHtml(input.code)}</b></p><p>${escapeHtml(text.expireNote)}</p>`,
      }),
      signal: ctrl.signal,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      log.error(
        { to: maskEmail(input.to), status: res.status, body: body.slice(0, 300) },
        'resend rejected email',
      );
      // 429/5xx 可重试（调用方决定），4xx 为配置/参数问题
      throw new MailError(`resend rejected email (HTTP ${res.status})`, res.status, res.status === 429 || res.status >= 500);
    }

    const data = (await res.json()) as { id?: string };
    log.info({ to: maskEmail(input.to), purpose: input.purpose, id: data.id }, 'verification email sent');
    return { id: data.id ?? 'unknown' };
  } catch (e) {
    if (e instanceof MailError) throw e;
    const aborted = e instanceof Error && e.name === 'AbortError';
    log.error({ to: maskEmail(input.to), aborted }, 'send verification email failed');
    throw new MailError(aborted ? 'email send timeout' : 'email send failed', undefined, true);
  } finally {
    clearTimeout(timer);
  }
}
