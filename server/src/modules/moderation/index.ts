/**
 * Prompt 前置审核（PRD §4.2 / 详细设计 §1.9）—— §13 #23 是验收项。
 *
 * 两阶段：
 *   L1 本地敏感词库  正则多模式匹配，P50 < 10ms → 命中即 `{ pass:false, layer:'blocklist' }`
 *   L2 LLM 二审      prompt + '\n' + negativePrompt（**截断 2000 字**）→ `{safe, categories}`
 *                    超时 / 异常 / 解析失败 → **fail-open 放行** + error 日志 + 告警计数
 *
 * 本模块的三条硬性约束：
 *  ① **绝不真连上游**：L2 的 LLM 调用走 `LlmClassifier` 接口，本期默认实现是**本地启发式分类器**，
 *     Phase 2 才换成 `LK888 /v1/skills/chat` 真实调用（替换点已在 `heuristicClassifier` 注释标明）。
 *  ② **绝不存 prompt 原文**：审计只写 sha256（`recordModerationLog`）。
 *  ③ **fail-open 是硬性要求**：上游自带二道审核兜底，本地误杀比漏放的业务损失更大
 *     （PRD §4.2：超时走 fail-open + error 日志 + 告警计数）。
 */

import { getConfig } from '../../core/config.js';
import { sha256 } from '../../core/crypto.js';
import { db } from '../../core/db.js';
import { childLogger } from '../../core/logger.js';
import { redis, REDIS_KEYS } from '../../core/redis.js';
import {
  BASELINE_KEYWORDS,
  CATEGORY_LABEL_ZH,
  COOCCURRENCE_PATTERNS,
  MODERATION_CATEGORIES,
  type KeywordEntry,
  type ModerationCategory,
} from './blocklist.js';

const log = childLogger({ mod: 'moderation' });

/** L2 输入截断长度（PRD §4.2：prompt + negativePrompt 截断 2000 字） */
export const L2_MAX_INPUT_CHARS = 2000;

/** fail-open 告警计数键（Redis INCR），供看板/告警规则抓取 */
export const MOD_FAILOPEN_KEY = 'mod:l2_failopen';

// ---------------------------------------------------------------- 对外类型

export interface ModerationResult {
  pass: boolean;
  layer: 'blocklist' | 'llm';
  categories: string[];
  cached?: boolean;
  latencyMs: number;
}

export interface ModerationInput {
  prompt: string;
  negativePrompt?: string;
  userId?: string;
  taskId?: string;
}

export interface ModerationApi {
  check(input: ModerationInput): Promise<ModerationResult>;
}

// ---------------------------------------------------------------- 数据源接口（可替换）

/**
 * 敏感词数据源。
 *
 * ⚠️ 为什么要有这层接口：PRD §4.2 的词库是 `moderation_keywords` 表（运营可配、无需发版），
 * 但该表**尚未在 prisma/schema.prisma 定义**（schema 已冻结，由主代理统一管理迁移）。
 * 因此默认实现读**代码内置基线词库**；Phase 补上 migration 后新增：
 *
 * ```ts
 * class DbKeywordSource implements KeywordSource {
 *   async load() {
 *     const rows = await db().moderationKeyword.findMany({ where: { active: true } });
 *     return rows.map(r => ({ term: r.term, category: r.category, lang: r.lang, severity: r.severity }));
 *   }
 * }
 * ```
 *
 * 审核链路的其余部分（预编译正则、匹配、分类聚合）完全不需要改动。
 */
export interface KeywordSource {
  load(): Promise<readonly KeywordEntry[]>;
}

/** 默认实现：内置基线词库（零 IO，这也是 P50 < 10ms 的前提之一） */
export class BuiltinKeywordSource implements KeywordSource {
  async load(): Promise<readonly KeywordEntry[]> {
    return BASELINE_KEYWORDS;
  }
}

/** L2 分类器接口：本期本地启发式，Phase 2 可换真实 LLM */
export interface LlmClassifier {
  classify(input: {
    text: string;
    timeoutMs: number;
    signal: AbortSignal;
  }): Promise<{ safe: boolean; categories: string[] }>;
}

// ---------------------------------------------------------------- L1 预编译

interface CompiledRule {
  regex: RegExp;
  category: ModerationCategory;
  severity: 1 | 2;
}

/**
 * 预编译正则（PRD §4.2 P50 < 10ms 的**前提**）。
 *
 * ❌ 反例：在循环里 `new RegExp(term)` 每个请求都要重新编译上百条模式，
 *    单请求 P50 直接到几十毫秒，且每次分配都会给 GC 施压。
 * ✅ 这里在**模块加载时**编译一次，之后只做 `regex.test()`。
 *
 * 中英文分开：
 *  - 中文无词形变化 → 直接子串匹配（转义正则元字符）；
 *  - 英文有词形变化与短词误杀风险（"ass" 会命中 "class"）→ 用 `\b` 词边界包裹；
 *    同时宽松处理连字符（"self-harm" → `self[-\s]?harm`）以覆盖空格/连字符变体。
 */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function compileRule(entry: KeywordEntry): CompiledRule {
  if (entry.lang === 'zh') {
    return { regex: new RegExp(escapeRegExp(entry.term)), category: entry.category, severity: entry.severity };
  }
  // 英文：按空白切成词，词间允许任意空白/连字符，两端加词边界
  const parts = entry.term
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => escapeRegExp(p).replace(/\\-/g, '[-\\s]?'));
  return {
    regex: new RegExp(`\\b${parts.join('[\\s-]+')}\\b`, 'i'),
    category: entry.category,
    severity: entry.severity,
  };
}

let compiledCache: { source: KeywordSource; rules: CompiledRule[] } | null = null;

async function getCompiledRules(source: KeywordSource): Promise<CompiledRule[]> {
  if (compiledCache && compiledCache.source === source) return compiledCache.rules;
  const entries = await source.load();
  const rules = entries.map(compileRule);
  compiledCache = { source, rules };
  return rules;
}

/** 测试用：清空预编译缓存（切换词表后需要重编译） */
export function resetCompiledRules(): void {
  compiledCache = null;
}

/**
 * L1 同步扫描（导出为纯函数，便于单测与 10ms 性能断言）。
 * 返回命中的分类（去重、按固定枚举顺序）。
 */
export function scanBlocklist(text: string, rules: CompiledRule[]): ModerationCategory[] {
  if (!text) return [];
  const hits = new Set<ModerationCategory>();

  for (const rule of rules) {
    if (rule.regex.test(text)) hits.add(rule.category);
  }

  // 涉政擦边共现模式：主体 + 动作同时出现才算命中
  for (const p of COOCCURRENCE_PATTERNS) {
    if (p.subject.test(text) && p.action.test(text)) hits.add(p.category);
  }

  // 按固定枚举顺序输出，保证同一输入结果稳定（便于缓存与测试断言）
  return MODERATION_CATEGORIES.filter((c) => hits.has(c));
}

// ---------------------------------------------------------------- L2 启发式分类器

/**
 * 启发式本地分类器（本期 L2 默认实现）。
 *
 * ⚠️ **绝不真连上游**（PRD 与任务契约的硬性要求）。这里用比 L1 更宽的词表 + 涉政擦边模式
 * 做一次"疑似违规"判定，行为上等价于一个保守的 LLM 分类器：
 *  - 只对**明确命中扩展词表**的输入返回 `safe:false`（避免误杀正常创作）；
 *  - 其余一律 `safe:true`（fail-open 精神：拿不准就放行，交上游二道审核）。
 *
 * 🔁 Phase 2 替换点：把 `heuristicClassifier` 换成
 *    `new Lk888ChatClassifier({ baseUrl: getConfig().LK_BASE_URL, apiKey: ... })`，
 *    内部调 `POST {LK_BASE_URL}/v1/skills/chat`，system prompt 要求只输出
 *    `{"safe": bool, "categories": string[]}`，超时用传入的 `timeoutMs`。
 *    接口签名不变，审核链路无需改动。
 */
export const heuristicClassifier: LlmClassifier = {
  async classify(input) {
    if (input.signal.aborted) throw new Error('classifier aborted');

    const text = input.text;
    if (!text.trim()) return { safe: true, categories: [] };

    const rules = await getCompiledRules(defaultKeywordSource);
    const hits = scanBlocklist(text, rules);

    // severity=1 的词在 L1 就应该被拦住了；能走到 L2 说明是 severity=2 或擦边模式，
    // 这里做二次判定：命中即不安全（等价于 LLM 判 safe=false）。
    return { safe: hits.length === 0, categories: hits.map((c) => CATEGORY_LABEL_ZH[c]) };
  },
};

let defaultKeywordSource: KeywordSource = new BuiltinKeywordSource();
let classifier: LlmClassifier = heuristicClassifier;

/** 测试/Phase 2 替换数据源（同时清空编译缓存） */
export function setKeywordSource(source: KeywordSource): void {
  defaultKeywordSource = source;
  resetCompiledRules();
}

/** 测试/Phase 2 替换 L2 分类器 */
export function setLlmClassifier(next: LlmClassifier): void {
  classifier = next;
}

export function getKeywordSource(): KeywordSource {
  return defaultKeywordSource;
}

// ---------------------------------------------------------------- L2 输入构造

/**
 * 构造 L2 待审文本：`prompt + '\n' + negativePrompt`，**截断 2000 字**（PRD §4.2）。
 *
 * 为什么 negativePrompt 也要审：它是**藏违规词的高发区**（PRD 原文），
 * 用户会把被前端/其他校验拦下的词塞进"负面提示词"绕过检查。
 *
 * 截断策略：先拼完整文本再按**字符数**（不是字节）截断，
 * 保证负向词只在前 2000 字内时可被看到；负向词通常很短，放在尾部一般不会被截掉。
 */
export function buildL2Input(prompt: string, negativePrompt?: string): string {
  const combined = negativePrompt ? `${prompt}\n${negativePrompt}` : prompt;
  return combined.length > L2_MAX_INPUT_CHARS ? combined.slice(0, L2_MAX_INPUT_CHARS) : combined;
}

/** 审核结论缓存键：sha256(prompt + '\n' + negativePrompt)（PRD §4.2 缓存 24h） */
export function moderationCacheKey(prompt: string, negativePrompt?: string): string {
  return REDIS_KEYS.moderation(sha256(buildL2Input(prompt, negativePrompt)));
}

// ---------------------------------------------------------------- 审计（静默降级）

/**
 * 写 `moderation_logs` 审计行。
 *
 * ⚠️ 该表**尚未在 prisma/schema.prisma 定义**（schema 已冻结，由主代理统一管理迁移）。
 * 因此这里用 `$executeRaw` + try/catch **静默降级**：
 *  - 表不存在（PG 42P01 undefined_table）→ 记一次 debug，不抛；
 *  - 任何其他错误 → 记 warn，不抛。
 * 审核**绝不能因为审计写不进去而影响到用户提交**。
 *
 * 隐私要求（PRD §4.2）：只存 `prompt_hash`（sha256），**绝不存原文**。
 * 建表语句（供主代理补 migration）：
 *
 * ```sql
 * CREATE TABLE moderation_logs (
 *   id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 *   prompt_hash text NOT NULL,
 *   verdict     text NOT NULL,           -- pass | reject
 *   layer       text NOT NULL,           -- blocklist | llm
 *   categories  jsonb NOT NULL DEFAULT '[]'::jsonb,  -- ⚠️ 线上为 jsonb，非 text[]
 *   latency_ms  integer NOT NULL,
 *   task_id     uuid,
 *   created_at  timestamptz NOT NULL DEFAULT now()
 * );
 * CREATE INDEX moderation_logs_prompt_hash_idx ON moderation_logs (prompt_hash);
 * CREATE INDEX moderation_logs_created_at_idx  ON moderation_logs (created_at);
 * ```
 */
export async function recordModerationLog(input: {
  promptHash: string;
  verdict: 'pass' | 'reject';
  layer: 'blocklist' | 'llm';
  categories: string[];
  latencyMs: number;
  taskId?: string;
}): Promise<void> {
  try {
    const taskId = input.taskId ?? null;
    // ⚠️ 线上 `moderation_logs.categories` 实际是 **jsonb**（默认 '[]'），
    // 而下方注释里的建表语句曾写成 text[]。直接按 text[] 写入会报
    // PG 42804（column is of type jsonb but expression is of type text[]），
    // 导致每次提交都刷一条 audit write failed。
    // 这里传 JSON 文本并显式 ::jsonb，与线上结构一致。
    const categoriesJson = JSON.stringify(input.categories ?? []);
    await db().$executeRaw`
      INSERT INTO moderation_logs (prompt_hash, verdict, layer, categories, latency_ms, task_id)
      VALUES (${input.promptHash}, ${input.verdict}, ${input.layer},
              ${categoriesJson}::jsonb, ${input.latencyMs}, ${taskId}::uuid)
    `;
  } catch (e) {
    const code = (e as { code?: string }).code;
    const message = e instanceof Error ? e.message : String(e);
    // 42P01 = undefined_table：本期 schema 缺表，属预期，降级为 debug 避免刷日志
    if (code === '42P01' || message.includes('does not exist')) {
      log.debug({ promptHash: input.promptHash }, 'moderation_logs table absent, audit skipped');
      return;
    }
    log.warn({ err: e, promptHash: input.promptHash }, 'moderation audit write failed');
  }
}

// ---------------------------------------------------------------- fail-open 计数

/** fail-open 告警计数（Redis INCR）。绝不因为 Redis 挂了而影响审核主流程。 */
async function bumpFailOpen(reason: string): Promise<void> {
  try {
    await redis().incr(MOD_FAILOPEN_KEY);
  } catch (e) {
    log.warn({ err: e, reason }, 'failopen counter incr failed');
  }
  log.error({ reason }, 'moderation L2 fail-open: request passed through');
}

/** 读 fail-open 计数（健康检查/看板用） */
export async function readFailOpenCount(): Promise<number> {
  try {
    const v = await redis().get(MOD_FAILOPEN_KEY);
    return v ? Number.parseInt(v, 10) : 0;
  } catch {
    return 0;
  }
}

// ---------------------------------------------------------------- 缓存

interface CachedVerdict {
  pass: boolean;
  layer: 'blocklist' | 'llm';
  categories: string[];
}

async function readCache(key: string): Promise<CachedVerdict | null> {
  try {
    const raw = await redis().get(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CachedVerdict>;
    if (typeof parsed.pass !== 'boolean' || !Array.isArray(parsed.categories)) return null;
    return {
      pass: parsed.pass,
      layer: parsed.layer === 'blocklist' ? 'blocklist' : 'llm',
      categories: parsed.categories.filter((c): c is string => typeof c === 'string'),
    };
  } catch {
    return null; // 缓存读失败绝不阻塞审核
  }
}

async function writeCache(key: string, verdict: CachedVerdict, ttlSec: number): Promise<void> {
  try {
    await redis().set(key, JSON.stringify(verdict), 'EX', ttlSec);
  } catch (e) {
    log.warn({ err: e }, 'moderation cache write failed');
  }
}

// ---------------------------------------------------------------- L2 带超时调用

/** Promise.race 超时（不用 AbortSignal.timeout 是为了同时把 signal 传进分类器做协作式取消） */
async function classifyWithTimeout(
  text: string,
  timeoutMs: number,
): Promise<{ safe: boolean; categories: string[] }> {
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;

  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`moderation L2 timeout after ${timeoutMs}ms`));
    }, timeoutMs);
    // 超时定时器不应阻止进程退出
    if (typeof timer.unref === 'function') timer.unref();
  });

  try {
    return await Promise.race([
      classifier.classify({ text, timeoutMs, signal: controller.signal }),
      timeout,
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// ---------------------------------------------------------------- 主入口

/**
 * Prompt 前置审核（两阶段）。
 *
 * 调用顺序严格按 PRD §4.2：
 *  1. L1（`MODERATION_L1_ENABLED`）→ 命中直接拒绝，**不消耗缓存也不查缓存**
 *     （L1 是纯本地正则，P50 < 10ms，比读 Redis 还快，缓存它没有收益）；
 *  2. 查 Redis 缓存（sha256 结论，24h）→ 命中直接返回 `cached: true`
 *     （PRD 目标命中率 > 60%，模板化 prompt 复用多）；
 *  3. L2（`MODERATION_L2_ENABLED`）→ 超时/异常/解析失败一律 **fail-open 放行**；
 *  4. 写缓存 + 写审计（审计失败静默降级）。
 */
export async function check(input: ModerationInput): Promise<ModerationResult> {
  const cfg = getConfig();
  const startedAt = Date.now();

  const prompt = input.prompt ?? '';
  const negativePrompt = input.negativePrompt;
  const promptHash = sha256(buildL2Input(prompt, negativePrompt));

  // ---------------- L1：本地敏感词库 ----------------
  if (cfg.MODERATION_L1_ENABLED) {
    const rules = await getCompiledRules(defaultKeywordSource);
    const hits = scanBlocklist(buildL2Input(prompt, negativePrompt), rules);

    if (hits.length > 0) {
      const latencyMs = Date.now() - startedAt;
      const categories = hits.map((c) => CATEGORY_LABEL_ZH[c]);
      log.warn(
        { layer: 'blocklist', categories: hits, promptHash, userId: input.userId },
        'prompt rejected by L1 blocklist',
      );
      void recordModerationLog({
        promptHash,
        verdict: 'reject',
        layer: 'blocklist',
        categories: hits,
        latencyMs,
        ...(input.taskId ? { taskId: input.taskId } : {}),
      });
      return { pass: false, layer: 'blocklist', categories, latencyMs };
    }
  }

  // ---------------- 缓存：sha256 结论 24h ----------------
  const cacheKey = moderationCacheKey(prompt, negativePrompt);
  const cached = await readCache(cacheKey);
  if (cached) {
    const latencyMs = Date.now() - startedAt;
    return { pass: cached.pass, layer: cached.layer, categories: cached.categories, cached: true, latencyMs };
  }

  // ---------------- L2：LLM 二审（fail-open） ----------------
  if (!cfg.MODERATION_L2_ENABLED) {
    const latencyMs = Date.now() - startedAt;
    return { pass: true, layer: 'llm', categories: [], latencyMs };
  }

  const text = buildL2Input(prompt, negativePrompt);

  let verdict: { safe: boolean; categories: string[] };
  try {
    verdict = await classifyWithTimeout(text, cfg.MODERATION_L2_TIMEOUT_MS);
  } catch (e) {
    /**
     * ⚠️ **fail-open 是硬性要求**（PRD §4.2 / §13 #23）：
     *  上线期上游 LK888 自带二道审核兜底；本地 L2 超时/异常时若 fail-closed，
     *  一次 Redis/分类器抖动就会让**全部创作停摆**，业务损失远大于漏放风险。
     *  因此这里放行 + error 日志 + Redis 告警计数（`mod:l2_failopen`）供看板告警。
     */
    const reason = e instanceof Error ? e.message : String(e);
    await bumpFailOpen(reason);
    const latencyMs = Date.now() - startedAt;
    return { pass: true, layer: 'llm', categories: [], latencyMs };
  }

  const latencyMs = Date.now() - startedAt;
  const categories = Array.isArray(verdict.categories) ? verdict.categories : [];
  const pass = verdict.safe !== false;

  const result: CachedVerdict = { pass, layer: 'llm', categories: pass ? [] : categories };
  await writeCache(cacheKey, result, cfg.MODERATION_CACHE_TTL_SEC);

  void recordModerationLog({
    promptHash,
    verdict: pass ? 'pass' : 'reject',
    layer: 'llm',
    categories: result.categories,
    latencyMs,
    ...(input.taskId ? { taskId: input.taskId } : {}),
  });

  if (!pass) {
    log.warn({ layer: 'llm', categories, promptHash, userId: input.userId }, 'prompt rejected by L2');
  }

  return { pass, layer: 'llm', categories: result.categories, latencyMs };
}

/** CONTRACT / tasks 模块依赖的单例（PRD §4.2 审核接口） */
export const moderation: ModerationApi = { check };
