/**
 * LK888 对话调用（`POST {LK_BASE_URL}/v1/skills/chat`）—— xiaoye-adoption 唯一新增共享件。
 * （docs/xiaoye-adoption-design.md §2.1；契约修订 R1 配套，见 CONTRACT.md 修订记录）
 *
 * 三个使用方，共用一份实现：
 *   1. prompts/optimize  F1 提示词优化
 *   2. prompts/reverse   F2 图片反推（vision，图片走 base64 data URI）
 *   3. moderation L2     Phase 2 替换 heuristicClassifier 的既定入口（moderation/index.ts:11）
 *
 * 铁律：
 *  - `MOCK_PROVIDER=true` → 返回固定样例，**绝不发请求**（CI/测试零上游费用）。
 *  - 报文形状收敛在 buildChatBody / extractChatText 两个函数；真实 key 实测后在
 *    tests/contract 用 **undici MockAgent** 固化（nock 拦不住 undici，见 workers/transfer.ts:122）。
 *    实测不符只改这两个函数，业务层零改动。
 */

import { request } from 'undici';
import { getConfig } from '../../core/config.js';
import { AppError, err } from '../../core/errors.js';
import { childLogger } from '../../core/logger.js';
import { joinUrl } from './lingke.js';

const log = childLogger({ mod: 'lk-chat' });

/**
 * 对话端点：**实测通过的是 `/v1/chat/completions`（OpenAI 格式）** —— docs/lk888-capabilities.md
 * §3.2/POC-2（model=tt-5.4-mini 实测成功）。moderation/index.ts 旧注释写的 `/v1/skills/chat`
 * 系误记（skills 实测清单不含它），以本注释为准。
 * base 已含 /api，与 lingke 各端点同一拼接规则。
 */
const PATH_CHAT = '/v1/chat/completions';

export interface ChatInput {
  /** 系统指令（优化指令/反推指令/审核指令），省略则纯单轮 */
  system?: string;
  /** 用户输入 —— **调用方负责截断**（优化/反推均 2000 字上限） */
  prompt: string;
  /** 视觉输入：`data:image/...;base64,`（优先）或公网 URL（>10MB 回退交付 URL） */
  imageUrl?: string;
  maxTokens?: number;
  /** 单次超时（默认 15000；超时后重试 1 次） */
  timeoutMs?: number;
}

export interface ChatResult {
  text: string;
  latencyMs: number;
}

/**
 * 模块内环境变量解析（**不改 core/config 冻结面** —— R1 约定新增 env 一律模块内解析）。
 * 数值非法/缺省回落到设计稿默认值（docs/xiaoye-adoption-design.md §9）。
 */
function envInt(name: string, def: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return def;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : def;
}

export const chatEnv = {
  /** 每次优化扣费（积分，决议 D1 走账本） */
  optimizeCredits: envInt('PROMPT_OPTIMIZE_CREDITS', 1),
  /** 每次反推扣费（视觉调用更贵，默认 2） */
  reverseCredits: envInt('PROMPT_REVERSE_CREDITS', 2),
  optimizePerMin: envInt('PROMPT_OPTIMIZE_PER_MIN', 10),
  optimizePerDay: envInt('PROMPT_OPTIMIZE_PER_DAY', 100),
  reversePerMin: envInt('PROMPT_REVERSE_PER_MIN', 6),
  reversePerDay: envInt('PROMPT_REVERSE_PER_DAY', 60),
  /** 对话模型（真实模式必填；fail-fast，不做臆测默认 —— LK 68 个 LLM 随时上下架） */
  chatModel: process.env['LK_CHAT_MODEL'] ?? '',
};

/**
 * 滑动窗口限频（分钟 + 日）。
 *
 * 单实例内存实现 —— api 当前单容器部署（docker compose 单副本），进程内状态即全局状态。
 * ⚠️ 一旦横向扩到多副本，必须换 Redis 实现（core/redis.ts 的 REDIS_KEYS 加新键，
 * INCR + EXPIRE），否则每副本各放各的水。
 */
const WINDOW = new Map<string, { min: number[]; dayCount: number; day: string }>();

export interface WindowVerdict {
  allowed: boolean;
  retryAfterSec: number;
}

export function allowWindow(key: string, perMin: number, perDay: number): WindowVerdict {
  const now = Date.now();
  const day = new Date(now).toISOString().slice(0, 10);
  let b = WINDOW.get(key);
  if (!b || b.day !== day) {
    b = { min: [], dayCount: 0, day };
    WINDOW.set(key, b);
  }
  if (b.dayCount >= perDay) {
    // 当日额度用尽：统一按到次日重试（保守值，前端展示"明日再来"）
    return { allowed: false, retryAfterSec: 3600 };
  }
  const cutoff = now - 60_000;
  b.min = b.min.filter((t) => t > cutoff);
  if (b.min.length >= perMin) {
    const oldest = b.min[0] ?? now;
    return {
      allowed: false,
      retryAfterSec: Math.max(1, Math.ceil((oldest + 60_000 - now) / 1000)),
    };
  }
  b.min.push(now);
  b.dayCount += 1;
  // 防内存膨胀：日切只重建"被再次访问"的桶，彻底失访的键靠这里兜底。
  // 粗粒度清空会瞬间放宽限频一小段窗口，代价远小于 OOM；严格语义换 Redis 实现。
  if (WINDOW.size > 50_000) WINDOW.clear();
  return { allowed: true, retryAfterSec: 0 };
}

/**
 * 从 `LK_API_KEYS`（JSON 字符串）取第一把可用 key。
 * 形状兼容两种：`["sk-..."]` 或 `[{"key":"sk-..."}]`。
 * 不 import config 内部的 parseApiKeys，避免对 core/config 内部结构产生额外耦合。
 */
export function firstApiKey(raw: string): string | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    const first: unknown = parsed[0];
    if (typeof first === 'string') return first;
    if (first !== null && typeof first === 'object') {
      const o = first as Record<string, unknown>;
      for (const k of ['key', 'apiKey', 'token']) {
        const v = o[k];
        if (typeof v === 'string' && v.length > 0) return v;
      }
    }
  } catch {
    /* 非法 JSON → 视为无 key */
  }
  return null;
}

/**
 * 构造对话请求体（单点：与实测报文对齐只改这里）。
 * vision 走 OpenAI 兼容的 content 数组形状；纯文本走字符串 content。
 */
export function buildChatBody(input: ChatInput, model: string): Record<string, unknown> {
  const userContent: unknown = input.imageUrl
    ? [
        { type: 'text', text: input.prompt },
        { type: 'image_url', image_url: { url: input.imageUrl } },
      ]
    : input.prompt;
  return {
    model,
    messages: [
      ...(input.system ? [{ role: 'system', content: input.system }] : []),
      { role: 'user', content: userContent },
    ],
    ...(input.maxTokens !== undefined ? { max_tokens: input.maxTokens } : {}),
  };
}

/**
 * 解析响应文本（单点：兼容 choices/message/content 主形状与少量变体）。
 * 解析不出 → 抛 INTERNAL（形状异常属实现/契约问题，不是用户可修复的输入错误）。
 */
export function extractChatText(data: unknown): string {
  if (typeof data === 'string') return data;
  if (data === null || typeof data !== 'object') {
    throw err.internal({ reason: 'chat response not an object' });
  }
  const d = data as Record<string, unknown>;
  const choices = d['choices'];
  if (Array.isArray(choices)) {
    const first = choices[0];
    if (first !== null && typeof first === 'object') {
      const msg = (first as Record<string, unknown>)['message'];
      if (msg !== null && typeof msg === 'object') {
        const content = (msg as Record<string, unknown>)['content'];
        if (typeof content === 'string' && content.length > 0) return content;
      }
    }
  }
  for (const k of ['content', 'text', 'output'] as const) {
    const v = d[k];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  const message = d['message'];
  if (typeof message === 'string' && message.length > 0) return message;
  if (message !== null && typeof message === 'object') {
    const inner = (message as Record<string, unknown>)['content'];
    if (typeof inner === 'string' && inner.length > 0) return inner;
  }
  throw err.internal({ reason: 'unrecognized chat response shape' });
}

const DEFAULT_TIMEOUT_MS = 15_000;
const MOCK_PREFIX = '[MOCK-CHAT] ';

/**
 * 单次对话调用。超时/网络错误/5xx 重试 1 次；4xx（业务拒绝）不重试直接上抛。
 *
 * 错误映射：errors.ts 无 upstream/502 类错误码（冻结面不为一次调用扩表），
 * 统一映射 `err.internal({ upstream: 'lk888-chat' })` —— 对前端即 500 可重试。
 */
export async function chatOnce(input: ChatInput): Promise<ChatResult> {
  const started = Date.now();
  const cfg = getConfig();

  if (cfg.MOCK_PROVIDER) {
    // CI 铁律：零上游。样例带前缀便于测试断言与用户内容区分。
    return { text: `${MOCK_PREFIX}${input.prompt.slice(0, 500)}`, latencyMs: Date.now() - started };
  }
  if (!chatEnv.chatModel) {
    throw err.internal({ reason: 'LK_CHAT_MODEL not configured' });
  }
  const apiKey = firstApiKey(cfg.LK_API_KEYS);
  if (!apiKey) {
    throw err.internal({ reason: 'LK_API_KEYS empty' });
  }

  const url = joinUrl(cfg.LK_BASE_URL, PATH_CHAT);
  const body = JSON.stringify(buildChatBody(input, chatEnv.chatModel));
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const headers = {
    authorization: `Bearer ${apiKey}`,
    'content-type': 'application/json',
  };

  let lastFailure: unknown = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const res = await request(url, {
        method: 'POST',
        headers,
        body,
        headersTimeout: timeoutMs,
        bodyTimeout: timeoutMs,
      });
      if (res.statusCode < 200 || res.statusCode >= 300) {
        const raw = await res.body.text();
        log.warn({ status: res.statusCode, detail: raw.slice(0, 300) }, 'lk chat non-2xx');
        if (res.statusCode >= 500 && attempt === 0) {
          lastFailure = new Error(`lk chat http ${res.statusCode}`);
          continue; // 5xx 重试一次
        }
        throw err.internal({ upstream: 'lk888-chat', status: res.statusCode });
      }
      const json: unknown = await res.body.json();
      return { text: extractChatText(json), latencyMs: Date.now() - started };
    } catch (e) {
      if (e instanceof AppError) throw e; // 自己抛的（4xx/形状异常）不重试
      lastFailure = e;
      if (attempt === 0) continue; // 超时/连接错误/5xx → 重试 1 次
    }
  }
  log.warn({ err: lastFailure }, 'lk chat failed after retry');
  throw err.internal({ upstream: 'lk888-chat', retried: true });
}
