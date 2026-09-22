/**
 * Prisma 客户端单例 + 事务辅助。
 * 所有模块通过 db() 获取，禁止各自 new PrismaClient()。
 */

import { PrismaClient } from '@prisma/client';
import type { Prisma } from '@prisma/client';

let client: PrismaClient | null = null;

export function db(): PrismaClient {
  if (!client) {
    client = new PrismaClient({
      log: process.env.PRISMA_LOG === 'true' ? ['query', 'warn', 'error'] : ['warn', 'error'],
    });
  }
  return client;
}

export async function disconnectDb(): Promise<void> {
  if (client) {
    await client.$disconnect();
    client = null;
  }
}

/** 在事务中执行；用于账本/任务等强一致场景 */
export function transaction<T>(
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  opts?: { timeout?: number; isolationLevel?: Prisma.TransactionIsolationLevel },
): Promise<T> {
  return db().$transaction(fn, opts);
}

export type { Prisma };
