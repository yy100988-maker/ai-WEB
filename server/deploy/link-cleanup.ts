/**
 * 联调测试清理脚本（在 api 容器内执行）。
 * 删除所有 link- 前缀用户（关联行由外键 Cascade 清理）。
 *
 *   docker compose run --rm -v /opt/vutu-backend/deploy:/link api npx tsx /link/link-cleanup.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const users = await prisma.user.findMany({
    where: { email: { startsWith: 'link-' } },
    select: { id: true, email: true },
  });
  for (const u of users) {
    await prisma.user.delete({ where: { id: u.id } });
  }
  console.log(JSON.stringify({ deleted: users.length }));
  await prisma.$disconnect();
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
