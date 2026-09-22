/**
 * 密码哈希（bcryptjs）。
 * 单次成本由 `BCRYPT_ROUNDS` 控制（默认 12，约 250ms/次，足以抵挡离线爆破）。
 */

import bcrypt from 'bcryptjs';
import { getConfig } from '../../core/config.js';

/**
 * 密码复杂度策略（用户确认：≥6 位 + 字母 + 数字）。
 * 前后端共用同一套语义：前端 AuthDialog 按此做实时提示，
 * 后端 set-password / recovery-reset / change-password 强制执行。
 * reason 直接进 WEAK_PASSWORD 的 details，前端可据此定位到具体输入框。
 */
export const PASSWORD_MIN_LENGTH = 6;

export type WeakPasswordReason = 'too_short' | 'no_letter' | 'no_digit';

export function validatePasswordPolicy(password: string): { ok: true } | { ok: false; reason: WeakPasswordReason } {
  if (password.length < PASSWORD_MIN_LENGTH) return { ok: false, reason: 'too_short' };
  if (!/[A-Za-z]/.test(password)) return { ok: false, reason: 'no_letter' };
  if (!/[0-9]/.test(password)) return { ok: false, reason: 'no_digit' };
  return { ok: true };
}

/** 最短密码长度（保留兼容：change-password 等旧调用方逐步迁移到 validatePasswordPolicy） */
export const MIN_PASSWORD_LENGTH = 8;

/** 生成密码哈希（bcrypt，含随机 salt） */
export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, getConfig().BCRYPT_ROUNDS);
}

/**
 * 校验密码。
 * - hash 为空（OAuth 用户无密码）一律返回 false
 * - 任何异常（非法哈希串）都视为不匹配，不抛出
 */
export async function verifyPassword(plain: string, hash: string | null | undefined): Promise<boolean> {
  if (!plain || !hash) return false;
  try {
    return await bcrypt.compare(plain, hash);
  } catch {
    return false;
  }
}
