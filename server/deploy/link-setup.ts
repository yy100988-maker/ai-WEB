/**
 * 联调测试用户准备脚本（在 api 容器内执行）。
 *
 * 背景：线上 NODE_ENV=production，注册验证码走真实通道、万能码不可用，
 * 因此联调用户直连 DB 创建（绕过验证码），再签发 access token。
 * 用法：
 *   docker compose run --rm -v /opt/vutu-backend/deploy:/link api npx tsx /link/link-setup.ts
 * 输出（一行 JSON）：{ userId, publicId, email, accessToken }
 */

import { PrismaClient } from '@prisma/client';
// 注意：本脚本通过 `docker cp` 放到容器的 /app 下执行（而非挂载），
// 这样裸包导入（@prisma/client）才能沿 /app/node_modules 解析到。
import { signAccessToken } from './src/modules/auth/tokens.js';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const stamp = Date.now();
  const email = `link-${stamp}@example.com`;

  const plan = await prisma.plan.findUnique({ where: { code: 'free' } });
  if (!plan) throw new Error('free plan missing; run seed first');

  const user = await prisma.user.create({
    data: {
      publicId: `usr_link${stamp.toString().slice(-9)}`,
      email,
      locale: 'zh-CN',
      planId: plan.id,
      profile: { create: { displayName: '联调测试' } },
      preferences: { create: { locale: 'zh-CN', timezone: 'Asia/Shanghai' } },
    },
  });

  // 直接发放 500 积分走完全旅程（发放路径本身由单测/E2E 覆盖，这里只准备弹药）
  await prisma.creditLedger.create({
    data: {
      userId: user.id,
      delta: 500,
      type: 'admin_adjust',
      balanceAfter: 500,
      idempotencyKey: `link-grant:${user.id}`,
      note: 'link test setup',
    },
  });

  const accessToken = signAccessToken({
    publicId: user.publicId,
    id: user.id,
    planCode: plan.code,
    locale: user.locale,
  });

  console.log(JSON.stringify({ userId: user.id, publicId: user.publicId, email, accessToken }));
  await prisma.$disconnect();
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
