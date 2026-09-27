/**
 * 积分兑换码（xiaoye-adoption F3，docs/xiaoye-adoption-design.md §5，决议 D1 用 promo 入账）。
 *
 * 正确性三支柱：
 *  1. **不存明文**：DB 只存 `sha256(code)`（对齐 admin 模块 adminKeyFingerprint 的教训——
 *     凭据类列一旦被导出/查询，明文即等于泄露）。
 *  2. **防双花**：`UPDATE ... WHERE id=? AND redeemed_by IS NULL` 条件更新是**唯一裁决点**
 *     （与 ledger.refundTask 的返还幂等同思路），0 行 → 已被兑；同事务 grant 兜 P2002。
 *  3. **明文只出现一次**：生成响应返回明文码，落库即 hash，之后任何接口都查不回明文。
 *
 * 归属：credits 语义归 billing 模块（CONTRACT §4 归属表）；admin 生成接口在 routes.ts 挂 requireAdmin。
 */

import { createHash, randomInt } from 'node:crypto';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { db, transaction } from '../../core/db.js';
import { err } from '../../core/errors.js';
import { ledger } from './ledger.js';

/**
 * Crockford base32 字母表（去 I/L/O/U —— 防手抄混淆：1/I、0/O、V/U 同形）。
 * 注意 J 也排除（部分字体 1/J 同形），即标准 Crockford 的安全子集。
 */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** 兑换码形状（路由层先验，防把任意字符串喂进 hash 查找） */
export const redeemCodeSchema = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .regex(/^VUTU(-[0-9A-HJKMNP-TV-Z]{4}){3}$/i, 'invalid code format')
  .transform((s) => s.toUpperCase());

/** 兑换码整体 sha256（hex）。**唯一入库存储形态**。 */
export function codeHash(code: string): string {
  return createHash('sha256').update(code.trim().toUpperCase()).digest('hex');
}

/**
 * 生成 `VUTU-XXXX-XXXX-XXXX`（12 个有效字符 ≈ 60bit 熵）。
 * randomInt 是 crypto 强随机（内部拒绝采样，无模偏差）。
 */
export function generateCode(): string {
  const group = (): string => {
    let s = '';
    for (let i = 0; i < 4; i += 1) s += ALPHABET[randomInt(ALPHABET.length)] as string;
    return s;
  };
  return `VUTU-${group()}-${group()}-${group()}`;
}

/** 批次 id：`rk_<时间戳36><随机6>`（日志可读，非凭据，可公开） */
export function newBatchId(): string {
  const rand = Array.from({ length: 6 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
  return `rk_${Date.now().toString(36)}${rand}`;
}

export interface CreateBatchInput {
  /** admin key 指纹（adminKeyFingerprint），不存明文 token */
  adminKeyFingerprint: string;
  count: number;
  credits: number;
  expiresInDays?: number;
  note?: string;
}

export interface CreateBatchResult {
  batchId: string;
  /** 明文码 —— **仅生成时返回这一次**，服务端之后不可恢复 */
  codes: string[];
}

export async function createBatch(input: CreateBatchInput): Promise<CreateBatchResult> {
  const batchId = newBatchId();
  const expiresAt =
    input.expiresInDays !== undefined
      ? new Date(Date.now() + input.expiresInDays * 86_400_000)
      : null;

  const codes: string[] = [];
  const rows: Prisma.RedeemKeyCreateManyInput[] = [];
  for (let i = 0; i < input.count; i += 1) {
    const code = generateCode();
    codes.push(code);
    rows.push({
      codeHash: codeHash(code),
      batchId,
      credits: input.credits,
      note: input.note ?? null,
      expiresAt,
      createdBy: input.adminKeyFingerprint,
    });
  }
  await db().redeemKey.createMany({ data: rows });
  return { batchId, codes };
}

export interface BatchStats {
  batchId: string;
  total: number;
  redeemed: number;
  pending: number;
}

export async function batchStats(batchId: string): Promise<BatchStats> {
  const [total, redeemed] = await Promise.all([
    db().redeemKey.count({ where: { batchId } }),
    db().redeemKey.count({ where: { batchId, redeemedById: { not: null } } }),
  ]);
  return { batchId, total, redeemed, pending: total - redeemed };
}

export interface RedeemResult {
  credits: number;
  balanceAfter: number;
}

/**
 * 兑换。
 *
 * 不存在 → 404（不区分"格式错/不存在"，防码枚举）；
 * 过期 / 已被兑 → 400（errors.ts 无 409 码，语义由 reason 承载）；
 * 竞态双花 → 条件更新裁决，后到者 count=0 → 400。
 * 成功 → 同事务 `ledger.grant(type:'promo')`，幂等键 `redeem:<hash前16>`。
 */
export async function redeem(userId: string, rawCode: string): Promise<RedeemResult> {
  const hash = codeHash(rawCode);
  const found = await db().redeemKey.findUnique({ where: { codeHash: hash } });
  if (!found) throw err.notFound({ reason: 'redeem code not found' });
  if (found.expiresAt && found.expiresAt.getTime() < Date.now()) {
    throw err.invalidParams({ reason: 'code expired' });
  }
  if (found.redeemedById) throw err.invalidParams({ reason: 'code already redeemed' });

  return transaction(async (tx) => {
    const upd = await tx.redeemKey.updateMany({
      where: { id: found.id, redeemedById: null },
      data: { redeemedById: userId, redeemedAt: new Date() },
    });
    if (upd.count === 0) throw err.invalidParams({ reason: 'code already redeemed' });

    const g = await ledger.grant({
      userId,
      type: 'promo',
      amount: found.credits,
      idempotencyKey: `redeem:${hash.slice(0, 16)}`,
      note: `redeem ${found.batchId}`,
      tx,
    });
    return { credits: found.credits, balanceAfter: g.balanceAfter };
  });
}
