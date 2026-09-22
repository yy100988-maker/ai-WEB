/**
 * 对外 ID 生成（详细设计 §0 全局约定）：
 * usr_/tsk_/ast_/ord_/chk_ + nanoid(12)。
 * DB 主键仍是 UUID，public_id 唯一索引。
 */

import { customAlphabet } from 'nanoid';

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const nano = customAlphabet(ALPHABET, 12);

export const ID_PREFIX = {
  user: 'usr',
  task: 'tsk',
  asset: 'ast',
  order: 'ord',
  checkin: 'chk',
  request: 'req',
} as const;

export type IdKind = keyof typeof ID_PREFIX;

export function newPublicId(kind: IdKind): string {
  return `${ID_PREFIX[kind]}_${nano()}`;
}

export function newRequestId(): string {
  return `${ID_PREFIX.request}_${nano()}`;
}

/** 校验对外 ID 前缀，避免把裸 UUID 当 publicId 查询 */
export function hasPrefix(id: string, kind: IdKind): boolean {
  return id.startsWith(`${ID_PREFIX[kind]}_`);
}

/** 匿名访问哨兵 UUID（详细设计 §1.9：PG 唯一键不把 NULL 视为相等） */
export const ANONYMOUS_USER_ID = '00000000-0000-0000-0000-000000000000';
