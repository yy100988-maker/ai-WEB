/**
 * F4 灵感广场：发布 / 撤回 / 图片路由 / 管理审核（docs/xiaoye-adoption-design.md §6）。
 *
 * 决议 D3：`PROMPT_AUTO_APPROVE` 默认 **true**（标题已过 L1+L2，发布即上首页）；
 * 设为 false 时进 pending，走 admin 审核接口置 published。
 * 无论开关如何，`listLibrary` 恒过滤 `status='published'` —— rejected/pending 永不进首页。
 *
 * imgUrl 稳定性（方案 §6.1，吸取 2026-09-22「预签名 URL 进静态内容」的教训）：
 *   存相对键 `pp/<postId>`，对外经 `GET /v1/prompt-library/:id/image` 现签现跳 302，
 *   **绝不**把 15min 预签名 URL 存进会被 SSR/浏览器缓存的列表字段。
 *
 * 归属：提示词库语义在 prompts 模块（admin 审核路由在 admin/routes.ts 复用本文件函数）。
 */

import { db } from '../../core/db.js';
import { err } from '../../core/errors.js';
import { presignView } from '../../core/storage.js';
import { moderation } from '../moderation/index.js';

export const POST_STATUS = ['pending', 'published', 'rejected'] as const;
export type PostStatusValue = (typeof POST_STATUS)[number];

/** 决议 D3：缺省即自动通过；显式 'false' 才启用人工审 */
function autoApprove(): boolean {
  const raw = process.env['PROMPT_AUTO_APPROVE'];
  return (raw ?? 'true').toLowerCase() !== 'false';
}

/**
 * 用户发布（auth）。
 * 校验链：tab 存在且启用 → 资产归属（非本人 404，不泄露存在性）→ 标题 L1+L2（违规 422）
 * → 按开关落 pending/published。
 * imgUrl 两步写入的原因：相对键由主键派生（`pp/<id>`），create 前还没有 id。
 */
export async function publishPost(input: {
  userId: string;
  tabCode: string;
  title: string;
  /** 对客资产 id（`ast_...` publicId） */
  assetId: string;
}): Promise<{ publicId: string; status: PostStatusValue }> {
  const tab = await db().promptTab.findUnique({ where: { code: input.tabCode } });
  if (!tab || !tab.active) throw err.notFound({ reason: 'tab not found' });

  const asset = await db().asset.findUnique({ where: { publicId: input.assetId } });
  if (!asset || asset.userId !== input.userId || asset.deletedAt !== null) {
    throw err.notFound({ reason: 'asset not found' });
  }

  const verdict = await moderation.check({ prompt: input.title, userId: input.userId });
  if (!verdict.pass) throw err.contentRejected(verdict.layer, verdict.categories);

  const status: PostStatusValue = autoApprove() ? 'published' : 'pending';
  const post = await db().promptPost.create({
    data: {
      tabCode: input.tabCode,
      title: input.title,
      imgUrl: '', // 占位：先取主键再回写派生键（见文件头注释）
      assetId: asset.id,
      createdBy: input.userId,
      status,
    },
  });
  await db().promptPost.update({
    where: { id: post.id },
    data: { imgUrl: `pp/${post.id}` },
  });
  return { publicId: post.id, status };
}

/**
 * 撤回自己的帖子：软下架（`active=false`，复用既有列表过滤，views/copies 历史保留）。
 * 他人帖子 → 404（errors.ts 无 403 码；按不存在处理，不泄露存在性，语义等价于 403+隐身）。
 */
export async function withdrawPost(userId: string, postId: string): Promise<void> {
  const post = await db().promptPost.findUnique({ where: { id: postId } });
  if (!post || post.createdBy !== userId) throw err.notFound({ reason: 'post not found' });
  await db().promptPost.update({ where: { id: post.id }, data: { active: false } });
}

/**
 * admin 审核状态机：
 *   approve：仅 pending → published（重复 approve 400）；
 *   reject ：pending → rejected；published → rejected **放行**（事后下架，D3 的兜底能力）。
 */
export async function reviewPost(input: {
  postId: string;
  action: 'approve' | 'reject';
  rejectReason?: string;
}): Promise<{ status: PostStatusValue }> {
  const post = await db().promptPost.findUnique({ where: { id: input.postId } });
  if (!post) throw err.notFound({ reason: 'post not found' });
  if (input.action === 'approve' && post.status !== 'pending') {
    throw err.invalidParams({ reason: `post status is ${post.status}, approve requires pending` });
  }
  const status: PostStatusValue = input.action === 'approve' ? 'published' : 'rejected';
  await db().promptPost.update({
    where: { id: post.id },
    data: {
      status,
      ...(input.action === 'reject' ? { rejectReason: input.rejectReason ?? null } : {}),
    },
  });
  return { status };
}

/**
 * 图片路由目标：现签 15min view URL（302 由 routes 层发出）。
 * 只对 `active && status='published'` 的帖子提供 —— rejected/撤回后外链立即失效。
 * 需要 assetId：种子帖可能未挂 asset（imgUrl 直连外部地址，不会走到本函数）。
 */
export async function imageUrlFor(postId: string): Promise<string> {
  const post = await db().promptPost.findUnique({ where: { id: postId } });
  if (!post || !post.active || post.status !== 'published' || !post.assetId) {
    throw err.notFound({ reason: 'image not found' });
  }
  const asset = await db().asset.findUnique({ where: { id: post.assetId } });
  if (!asset || asset.deletedAt !== null) throw err.notFound({ reason: 'asset deleted' });
  return presignView(asset.storageKey);
}
