/**
 * F1 提示词优化 / F2 反推提示词（docs/xiaoye-adoption-design.md §3/§4，决议 D1：账本扣积分）。
 *
 * 扣费顺序 charge-after（方案 §3 流程图）：
 *   限频 → 输入截断 → 预检余额(402，**先于上游**) → chatOnce(失败不扣) → ledger.spend
 * 竞态窗口（预检后、spend 前余额被并发花光）由 spend() 的 advisory 锁 + balance>=amount
 * 裁决：落空 → 402、不写流水；该次上游已消耗但不向用户收费 —— 每分钟限频兜住损失上界，
 * 严格保持「余额 = SUM(delta)」不产生负值。
 *
 * 输出**不入库**（会话态）；用户回填 composer 后提交任务时仍走既有前置审核
 * （moderation L1+L2），因此本模块不做输出安全判定。
 *
 * system 指令均为自撰（AGPL 清洁室红线：不引用对方 prompt 文本）。
 */

import { db } from '../../core/db.js';
import { err } from '../../core/errors.js';
import { getObjectBuffer, presignDelivery } from '../../core/storage.js';
import { allowWindow, chatEnv, chatOnce } from '../providers/chat.js';
import { ledger } from '../billing/ledger.js';

/** 优化/反推输入统一截断上限（方案 §3/§4） */
const MAX_PROMPT_LEN = 2000;
/** 上游允许图片 base64 ≤10MB（lk888 文档；超限回退交付 URL） */
const MAX_BASE64_BYTES = 10 * 1024 * 1024;

/** F1 优化指令（自撰） */
export const OPTIMIZE_SYSTEM = [
  '你是文生图/文生视频的提示词工程师。把用户的提示词改写得更完整、更可执行：',
  '- 保留原意、主体与用户明确指定的约束，不得引入新情节或新主体；',
  '- 适度补充镜头、光线、色彩、风格、质感等画面要素；',
  '- 输出语言与输入语言完全一致；',
  '- 只输出改写后的提示词纯文本：不解释、不加引号、不加「提示词：」之类前缀、不分行罗列。',
].join('\n');

/** F2 反推指令（自撰） */
export const REVERSE_SYSTEM = [
  '你是图片反推助手。根据用户提供的图片，输出一段能尽力复现该图的生成提示词：',
  '按「主体与构图 → 风格与媒介 → 光线与色调 → 镜头与视角」组织为单段连贯文本；',
  '末尾另起一行以「Negative: 」给出负向词（与正向词相同的语言）。',
  '只输出提示词内容本身，不作任何解释或寒暄。',
].join('\n');

/** 反推输出语言提示（键 = core/types.ts 的 Locale，随 Accept-Language 解析结果） */
const LANG_NAME: Record<string, string> = {
  'zh-CN': '简体中文',
  'zh-TW': '繁體中文',
  en: 'English',
  ja: '日本語',
  ko: '한국어',
  es: 'español',
  fr: 'français',
  de: 'Deutsch',
  it: 'italiano',
  pt: 'português',
  ru: 'русский',
};

export interface PromptServiceResult {
  /** 优化后的 / 反推出的提示词正文 */
  prompt: string;
  credits: number;
  latencyMs: number;
}

/** 截断 + 空输入校验（400） */
export function clipPrompt(raw: string): string {
  const s = raw.trim();
  if (s.length === 0) {
    throw err.invalidParams({ errors: [{ param: 'prompt', message: 'required' }] });
  }
  return s.slice(0, MAX_PROMPT_LEN);
}

function limit(key: string, perMin: number, perDay: number): void {
  const v = allowWindow(key, perMin, perDay);
  if (!v.allowed) throw err.rateLimited(v.retryAfterSec);
}

/** 预检余额：402 必须发生在上游调用**之前**（先花平台钱再报余额不足是最差体验） */
async function preflight(userId: string, credits: number): Promise<void> {
  if (credits <= 0) return;
  const bal = await ledger.balance(userId);
  if (bal < credits) throw err.insufficientCredits(credits, bal);
}

/** charge-after 扣费。幂等键 `svc:<kind>:<clientKey>`（(userId, key) 唯一兜重放） */
async function charge(
  userId: string,
  kind: 'optimize' | 'reverse',
  credits: number,
  clientKey: string,
): Promise<void> {
  if (credits <= 0) return;
  await ledger.spend({
    userId,
    type: 'service_deduct',
    amount: credits,
    idempotencyKey: `svc:${kind}:${clientKey}`,
    note: kind,
  });
}

/** 图片入参：≤10MB → base64 data URI（免 URL 过期）；>10MB → 交付 URL（4h 足够单次调用） */
async function imageRef(storageKey: string, mimeType: string, sizeBytes: number): Promise<string> {
  if (sizeBytes <= MAX_BASE64_BYTES) {
    const buf = await getObjectBuffer(storageKey);
    return `data:${mimeType};base64,${buf.toString('base64')}`;
  }
  return presignDelivery(storageKey, 4 * 3600);
}

/** F1 提示词优化 */
export async function runOptimize(input: {
  userId: string;
  prompt: string;
  idempotencyKey: string;
}): Promise<PromptServiceResult> {
  const prompt = clipPrompt(input.prompt);
  limit(`opt:${input.userId}`, chatEnv.optimizePerMin, chatEnv.optimizePerDay);
  await preflight(input.userId, chatEnv.optimizeCredits);

  const res = await chatOnce({ system: OPTIMIZE_SYSTEM, prompt });
  await charge(input.userId, 'optimize', chatEnv.optimizeCredits, input.idempotencyKey);

  return {
    prompt: res.text.trim(),
    credits: chatEnv.optimizeCredits,
    latencyMs: res.latencyMs,
  };
}

/** F2 反推提示词（图片 → 提示词；资产归属校验 404 不泄露存在性） */
export async function runReverse(input: {
  userId: string;
  assetPublicId: string;
  lang?: string | null;
  idempotencyKey: string;
}): Promise<PromptServiceResult & { assetId: string }> {
  limit(`rev:${input.userId}`, chatEnv.reversePerMin, chatEnv.reversePerDay);

  const asset = await db().asset.findUnique({ where: { publicId: input.assetPublicId } });
  if (!asset || asset.userId !== input.userId || asset.deletedAt !== null) {
    throw err.notFound({ reason: 'asset not found' });
  }
  if (!asset.mimeType.startsWith('image/')) {
    throw err.invalidParams({ errors: [{ param: 'assetId', message: 'not an image' }] });
  }

  await preflight(input.userId, chatEnv.reverseCredits);

  const langName = LANG_NAME[input.lang ?? 'en'] ?? 'English';
  const imageUrl = await imageRef(asset.storageKey, asset.mimeType, Number(asset.sizeBytes));
  const res = await chatOnce({
    system: REVERSE_SYSTEM,
    prompt: `输出语言：${langName}。请为这张图生成可复现的提示词。`,
    imageUrl,
  });
  await charge(input.userId, 'reverse', chatEnv.reverseCredits, input.idempotencyKey);

  return {
    prompt: res.text.trim(),
    assetId: input.assetPublicId,
    credits: chatEnv.reverseCredits,
    latencyMs: res.latencyMs,
  };
}
