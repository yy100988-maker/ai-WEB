/**
 * Prompt 前置审核单测（PRD §4.2 / §13 #23）。
 *
 * 关键覆盖点：
 *  - L1 命中/漏过集（中英文、negativePrompt 藏词、涉政擦边共现模式）
 *  - L2 输入构造（`prompt + '\n' + negativePrompt`，截断 2000 字）
 *  - **fail-open 超时路径**（§13 #23 验收项：断开 LLM 二审模拟超时 → 放行 + 有告警日志）
 *  - 哈希缓存命中（同一 prompt 第二次返回 cached:true）
 *  - L1/L2 开关（MODERATION_L1_ENABLED / MODERATION_L2_ENABLED）
 *
 * 全部用内存桩替换 Redis / DB，**不连真基础设施**。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------- 依赖桩（必须在 import 被测模块前 hoist）

const cacheStore = new Map<string, string>();
const counters = new Map<string, number>();
const warnLogs: Array<{ msg: string; ctx: unknown }> = [];
const errorLogs: Array<{ msg: string; ctx: unknown }> = [];

vi.mock('../../core/redis.js', () => ({
  redis: () => ({
    get: async (key: string) => cacheStore.get(key) ?? (counters.has(key) ? String(counters.get(key)) : null),
    set: async (key: string, value: string) => {
      cacheStore.set(key, value);
      return 'OK';
    },
    incr: async (key: string) => {
      const next = (counters.get(key) ?? 0) + 1;
      counters.set(key, next);
      return next;
    },
  }),
  REDIS_KEYS: {
    moderation: (hash: string) => `mod:${hash}`,
  },
}));

vi.mock('../../core/db.js', () => ({
  db: () => ({
    // 模拟 schema 缺表：抛出 PG 42P01（undefined_table），验证审计静默降级
    $executeRaw: async () => {
      const e = new Error('relation "moderation_logs" does not exist') as Error & { code?: string };
      e.code = '42P01';
      throw e;
    },
  }),
}));

vi.mock('../../core/logger.js', () => ({
  childLogger: () => ({
    debug: () => undefined,
    info: () => undefined,
    warn: (ctx: unknown, msg: string) => warnLogs.push({ msg, ctx }),
    error: (ctx: unknown, msg: string) => errorLogs.push({ msg, ctx }),
  }),
}));

vi.mock('../../core/config.js', () => ({
  getConfig: () => mockConfig,
}));

interface MockConfig {
  MODERATION_L1_ENABLED: boolean;
  MODERATION_L2_ENABLED: boolean;
  MODERATION_L2_TIMEOUT_MS: number;
  MODERATION_CACHE_TTL_SEC: number;
}

let mockConfig: MockConfig = {
  MODERATION_L1_ENABLED: true,
  MODERATION_L2_ENABLED: true,
  MODERATION_L2_TIMEOUT_MS: 3000,
  MODERATION_CACHE_TTL_SEC: 86400,
};

import {
  L2_MAX_INPUT_CHARS,
  buildL2Input,
  check,
  moderationCacheKey,
  readFailOpenCount,
  recordModerationLog,
  resetCompiledRules,
  scanBlocklist,
  setKeywordSource,
  setLlmClassifier,
  heuristicClassifier,
  MOD_FAILOPEN_KEY,
  type LlmClassifier,
  type KeywordSource,
} from './index.js';
import { BASELINE_KEYWORDS } from './blocklist.js';

beforeEach(() => {
  cacheStore.clear();
  counters.clear();
  warnLogs.length = 0;
  errorLogs.length = 0;
  resetCompiledRules();
  // 每个用例前还原默认分类器与默认词源，避免用例间互相污染
  setLlmClassifier(heuristicClassifier);
  setKeywordSource({ load: async () => BASELINE_KEYWORDS });
  resetCompiledRules();
  mockConfig = {
    MODERATION_L1_ENABLED: true,
    MODERATION_L2_ENABLED: true,
    MODERATION_L2_TIMEOUT_MS: 3000,
    MODERATION_CACHE_TTL_SEC: 86400,
  };
});

afterEach(() => {
  resetCompiledRules();
  setLlmClassifier(heuristicClassifier);
  setKeywordSource({ load: async () => BASELINE_KEYWORDS });
  vi.restoreAllMocks();
});

// ================================================================ L1

describe('L1 本地敏感词库', () => {
  it('中文命中：色情类', async () => {
    const r = await check({ prompt: '生成一张裸体写真' });
    expect(r.pass).toBe(false);
    expect(r.layer).toBe('blocklist');
    expect(r.categories).toContain('色情');
  });

  it('中文命中：暴力类', async () => {
    const r = await check({ prompt: '血腥的斩首现场' });
    expect(r.pass).toBe(false);
    expect(r.categories).toContain('暴力');
  });

  it('中文命中：违法类', async () => {
    const r = await check({ prompt: '制作冰毒的教学视频' });
    expect(r.pass).toBe(false);
    expect(r.categories).toContain('违法');
  });

  it('中文命中：引流类', async () => {
    const r = await check({ prompt: '画面里出现加微信的二维码' });
    expect(r.pass).toBe(false);
    expect(r.categories).toContain('引流');
  });

  it('中文命中：广告类', async () => {
    const r = await check({ prompt: '稳赚不赔的投资广告' });
    expect(r.pass).toBe(false);
    expect(r.categories).toContain('广告');
  });

  it('英文命中（词边界，大小写无关）', async () => {
    const r = await check({ prompt: 'A nude scene with explicit content' });
    expect(r.pass).toBe(false);
    expect(r.categories).toContain('色情');
  });

  it('英文词形变化命中：porn 不应命中 pornographic（词边界只匹配整词）', async () => {
    // 词库显式登记了 pornography，派生形式需单独登记 —— 这里固化当前行为
    const exact = await check({ prompt: 'this is porn' });
    expect(exact.pass).toBe(false);

    const derived = await check({ prompt: 'a pornographic painting' });
    expect(derived.pass).toBe(true); // 未登记派生形式 → 交给 L2/上游二审
  });

  it('英文词边界不误杀：class 不应命中 ass 类词', async () => {
    // 词库没有 ass，但验证边界机制：'glass' 不应命中任何 en 词
    const r = await check({ prompt: 'a glass of water on a table' });
    expect(r.pass).toBe(true);
  });

  it('⚠️ 藏在 negativePrompt 里的违规词也必须命中（§13 #23）', async () => {
    const r = await check({ prompt: '美丽的海滩日落', negativePrompt: '裸体，色情' });
    expect(r.pass).toBe(false);
    expect(r.layer).toBe('blocklist');
    expect(r.categories).toContain('色情');
  });

  it('英文 negativePrompt 命中', async () => {
    const r = await check({ prompt: 'a calm landscape', negativePrompt: 'gore, beheading' });
    expect(r.pass).toBe(false);
    expect(r.categories).toContain('暴力');
  });

  it('正常 prompt 通过 L1（并走 L2 放行）', async () => {
    const r = await check({ prompt: '一只柴犬在东京街头骑自行车，电影感运镜' });
    expect(r.pass).toBe(true);
  });

  it('多分类命中时全部返回且顺序稳定', async () => {
    const r = await check({ prompt: '裸体 血腥 冰毒' });
    expect(r.pass).toBe(false);
    // 固定枚举顺序：political, porn, violence, illegal, traffic, ads
    expect(r.categories).toEqual(['色情', '暴力', '违法']);
  });

  it('空 prompt 不命中', async () => {
    const r = await check({ prompt: '' });
    expect(r.pass).toBe(true);
  });
});

describe('L1 涉政擦边共现模式（§13 #23 第二类输入）', () => {
  it('称谓 + 恶搞动作 → 政治', async () => {
    const r = await check({ prompt: '把国家主席做成鬼畜跳舞的搞笑视频' });
    expect(r.pass).toBe(false);
    expect(r.categories).toContain('政治');
  });

  it('国旗 + 焚烧 → 政治', async () => {
    const r = await check({ prompt: '焚烧国旗的抗议场面' });
    expect(r.pass).toBe(false);
    expect(r.categories).toContain('政治');
  });

  it('英文共现：president + parody', async () => {
    const r = await check({ prompt: 'a parody video of the president dancing' });
    expect(r.pass).toBe(false);
    expect(r.categories).toContain('政治');
  });

  it('儿童 + 裸露 → 色情', async () => {
    const r = await check({ prompt: '儿童内衣广告' });
    expect(r.pass).toBe(false);
    expect(r.categories).toContain('色情');
  });

  it('只有主体没有动作 → 不命中（避免误杀）', async () => {
    const r = await check({ prompt: '一位总统在讲台上发表演讲，新闻纪实风格' });
    expect(r.pass).toBe(true);
  });

  it('只有动作没有主体 → 不命中', async () => {
    const r = await check({ prompt: '一只猫在跳舞，搞笑风格' });
    expect(r.pass).toBe(true);
  });
});

describe('L1 预编译与性能（P50 < 10ms）', () => {
  it('scanBlocklist 是同步纯函数且能识别全部六类', () => {
    const rules = BASELINE_KEYWORDS.map((e) => ({
      regex: new RegExp(e.lang === 'zh' ? e.term : `\\b${e.term}\\b`, 'i'),
      category: e.category,
      severity: e.severity,
    }));
    expect(scanBlocklist('裸体', rules)).toContain('porn');
    expect(scanBlocklist('血腥', rules)).toContain('violence');
    expect(scanBlocklist('冰毒', rules)).toContain('illegal');
    expect(scanBlocklist('加微信', rules)).toContain('traffic');
    expect(scanBlocklist('刷单', rules)).toContain('ads');
    expect(scanBlocklist('台独', rules)).toContain('political');
  });

  it('100 次 L1 扫描的中位耗时 < 10ms（预编译正则的收益）', async () => {
    const samples: number[] = [];
    for (let i = 0; i < 100; i += 1) {
      const t0 = performance.now();
      await check({ prompt: `一只柴犬在东京街头骑自行车，电影感运镜 #${i}` });
      samples.push(performance.now() - t0);
    }
    samples.sort((a, b) => a - b);
    const p50 = samples[Math.floor(samples.length * 0.5)] ?? 0;
    expect(p50).toBeLessThan(10);
  });
});

describe('KeywordSource 可替换（Phase 迁移到 moderation_keywords 表）', () => {
  it('替换数据源后立即生效', async () => {
    const custom: KeywordSource = {
      load: async () => [{ term: '自定义违禁词', category: 'ads', lang: 'zh', severity: 1 }],
    };
    setKeywordSource(custom);
    resetCompiledRules();

    const hit = await check({ prompt: '包含自定义违禁词的文案' });
    expect(hit.pass).toBe(false);
    expect(hit.categories).toContain('广告');

    // 基线词表已被替换掉：'裸体' 不再命中
    const miss = await check({ prompt: '裸体' });
    expect(miss.pass).toBe(true);

    // 还原
    setKeywordSource({ load: async () => BASELINE_KEYWORDS });
    resetCompiledRules();
  });
});

// ================================================================ L2 输入构造

describe('L2 输入构造 buildL2Input', () => {
  it('拼接 prompt + \\n + negativePrompt', () => {
    expect(buildL2Input('hello', 'world')).toBe('hello\nworld');
  });

  it('无 negativePrompt 时只有 prompt', () => {
    expect(buildL2Input('hello')).toBe('hello');
  });

  it('negativePrompt 为空串时不加换行', () => {
    expect(buildL2Input('hello', '')).toBe('hello');
  });

  it('截断到 2000 字', () => {
    const long = 'x'.repeat(5000);
    const out = buildL2Input(long);
    expect(out).toHaveLength(L2_MAX_INPUT_CHARS);
    expect(L2_MAX_INPUT_CHARS).toBe(2000);
  });

  it('超过 2000 字时按字符截断（不是字节），中文安全', () => {
    const long = '测'.repeat(3000);
    const out = buildL2Input(long);
    expect(out).toHaveLength(2000);
    expect(out).toBe('测'.repeat(2000));
  });

  it('prompt 未超限时 negativePrompt 保留在尾部', () => {
    const out = buildL2Input('a'.repeat(100), 'trailing-negative');
    expect(out).toContain('trailing-negative');
  });

  it('prompt+negativePrompt 合计超限时截断到 2000', () => {
    const out = buildL2Input('a'.repeat(1900), 'b'.repeat(500));
    expect(out).toHaveLength(2000);
  });
});

describe('缓存键', () => {
  it('同 prompt 同 negativePrompt → 同键', () => {
    expect(moderationCacheKey('a', 'b')).toBe(moderationCacheKey('a', 'b'));
  });

  it('不同输入 → 不同键', () => {
    expect(moderationCacheKey('a', 'b')).not.toBe(moderationCacheKey('a', 'c'));
    expect(moderationCacheKey('a')).not.toBe(moderationCacheKey('b'));
  });

  it('键前缀走 REDIS_KEYS.moderation（mod:）', () => {
    expect(moderationCacheKey('x')).toMatch(/^mod:[0-9a-f]{64}$/);
  });

  it('键是截断后文本的 sha256（与 buildL2Input 一致）', async () => {
    const longA = 'a'.repeat(3000);
    const longB = 'a'.repeat(4000);
    // 前 2000 字相同 → 键相同（缓存命中率受益）
    expect(moderationCacheKey(longA)).toBe(moderationCacheKey(longB));
  });
});

// ================================================================ L2 缓存

describe('L2 哈希缓存（24h）', () => {
  it('第二次相同输入命中缓存且 cached:true', async () => {
    const first = await check({ prompt: '一段完全正常的品牌宣传片脚本' });
    expect(first.pass).toBe(true);
    expect(first.cached).toBeUndefined();

    const second = await check({ prompt: '一段完全正常的品牌宣传片脚本' });
    expect(second.pass).toBe(true);
    expect(second.cached).toBe(true);
  });

  it('缓存会记住拒绝结论', async () => {
    // L1 关掉，用分类器造一个 L2 拒绝
    mockConfig.MODERATION_L1_ENABLED = false;
    setLlmClassifier({
      classify: async () => ({ safe: false, categories: ['政治'] }),
    });

    const first = await check({ prompt: '擦边涉政内容 A' });
    expect(first.pass).toBe(false);
    expect(first.layer).toBe('llm');

    const second = await check({ prompt: '擦边涉政内容 A' });
    expect(second.pass).toBe(false);
    expect(second.cached).toBe(true);
    expect(second.categories).toContain('政治');
  });

  it('Redis 读失败时静默降级（不阻塞审核）', async () => {
    const redisMod = await import('../../core/redis.js');
    const spy = vi.spyOn(redisMod, 'redis').mockReturnValue({
      get: async () => {
        throw new Error('redis down');
      },
      set: async () => {
        throw new Error('redis down');
      },
      incr: async () => 1,
    } as unknown as ReturnType<typeof redisMod.redis>);

    const r = await check({ prompt: '正常内容，Redis 挂了也要放行' });
    expect(r.pass).toBe(true);
    spy.mockRestore();
  });
});

// ================================================================ L2 fail-open

describe('⚠️ L2 fail-open（§13 #23 验收项）', () => {
  async function withClassifier(c: LlmClassifier, fn: () => Promise<void>): Promise<void> {
    setLlmClassifier(c);
    try {
      await fn();
    } finally {
      setLlmClassifier(heuristicClassifier);
    }
  }

  it('超时 → 放行 + 写 error 日志 + 告警计数 +1', async () => {
    mockConfig.MODERATION_L1_ENABLED = false;
    mockConfig.MODERATION_L2_TIMEOUT_MS = 20;

    await withClassifier(
      {
        // 永不 resolve，模拟 LLM 二审超时
        classify: () => new Promise(() => undefined),
      },
      async () => {
        const r = await check({ prompt: '一个会让审核服务超时的正常提示词' });
        expect(r.pass).toBe(true); // fail-open
        expect(r.layer).toBe('llm');
        expect(r.categories).toEqual([]);
      },
    );

    // 告警计数 +1
    expect(counters.get(MOD_FAILOPEN_KEY)).toBe(1);
    expect(await readFailOpenCount()).toBe(1);

    // error 日志存在
    expect(errorLogs.some((l) => l.msg.includes('fail-open'))).toBe(true);
  });

  it('分类器抛异常 → 放行 + 计数', async () => {
    mockConfig.MODERATION_L1_ENABLED = false;

    await withClassifier(
      {
        classify: async () => {
          throw new Error('upstream classifier exploded');
        },
      },
      async () => {
        const r = await check({ prompt: '分类器爆炸时的正常提示词' });
        expect(r.pass).toBe(true);
      },
    );

    expect(counters.get('mod:l2_failopen')).toBe(1);
  });

  it('分类器返回畸形结果（categories 非数组）不崩、放行', async () => {
    mockConfig.MODERATION_L1_ENABLED = false;

    await withClassifier(
      {
        classify: async () =>
          ({ safe: true, categories: 'not-an-array' }) as unknown as {
            safe: boolean;
            categories: string[];
          },
      },
      async () => {
        const r = await check({ prompt: '畸形返回值的提示词' });
        expect(r.pass).toBe(true);
        expect(Array.isArray(r.categories)).toBe(true);
      },
    );
  });

  it('多次 fail-open 计数累加（告警阈值可观测）', async () => {
    mockConfig.MODERATION_L1_ENABLED = false;
    mockConfig.MODERATION_L2_TIMEOUT_MS = 10;

    await withClassifier(
      { classify: () => new Promise(() => undefined) },
      async () => {
        await check({ prompt: '超时 A' });
        await check({ prompt: '超时 B' });
        await check({ prompt: '超时 C' });
      },
    );

    expect(await readFailOpenCount()).toBe(3);
  });
});

// ================================================================ 开关

describe('L1 / L2 开关', () => {
  it('MODERATION_L1_ENABLED=false 时 L1 不拦', async () => {
    mockConfig.MODERATION_L1_ENABLED = false;
    const r = await check({ prompt: '生成一张裸体写真' });
    // L1 关掉后由 L2 启发式兜住（它也读同一份词表）
    expect(r.layer === 'llm' || r.pass).toBe(true);
  });

  it('MODERATION_L2_ENABLED=false 时直接放行（无缓存、无分类器调用）', async () => {
    mockConfig.MODERATION_L2_ENABLED = false;
    const r = await check({ prompt: '一段完全正常的文案' });
    expect(r.pass).toBe(true);
    expect(r.layer).toBe('llm');
    expect(r.categories).toEqual([]);
    expect(r.cached).toBeUndefined();
  });

  it('L1 与 L2 全关 → 一律放行', async () => {
    mockConfig.MODERATION_L1_ENABLED = false;
    mockConfig.MODERATION_L2_ENABLED = false;
    const r = await check({ prompt: '裸体 血腥 冰毒' });
    expect(r.pass).toBe(true);
  });

  it('L1 命中时不查缓存（本地正则比 Redis 快）', async () => {
    const r = await check({ prompt: '裸体' });
    expect(r.pass).toBe(false);
    expect(r.cached).toBeUndefined();
    expect(cacheStore.size).toBe(0);
  });
});

// ================================================================ 审计

describe('审计写入（moderation_logs 缺表时静默降级）', () => {
  it('表不存在（42P01）不抛异常，只记 debug', async () => {
    await expect(
      recordModerationLog({
        promptHash: 'a'.repeat(64),
        verdict: 'reject',
        layer: 'blocklist',
        categories: ['porn'],
        latencyMs: 1,
      }),
    ).resolves.toBeUndefined();
    // 静默降级：不产生 warn（避免刷日志）
    expect(warnLogs.filter((l) => l.msg.includes('audit'))).toHaveLength(0);
  });

  it('审核主流程不因审计失败而中断', async () => {
    const r = await check({ prompt: '裸体' });
    expect(r.pass).toBe(false);
    expect(r.layer).toBe('blocklist');
  });
});

// ================================================================ 结果形状

describe('ModerationResult 形状（CONTRACT 冻结）', () => {
  it('拒绝结果含 pass/layer/categories/latencyMs', async () => {
    const r = await check({ prompt: '裸体' });
    expect(r).toMatchObject({
      pass: false,
      layer: 'blocklist',
    });
    expect(Array.isArray(r.categories)).toBe(true);
    expect(typeof r.latencyMs).toBe('number');
    expect(r.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('通过结果含 pass/layer/categories/latencyMs', async () => {
    const r = await check({ prompt: '一只橘猫在窗台上打盹' });
    expect(r.pass).toBe(true);
    expect(r.layer).toBe('llm');
    expect(typeof r.latencyMs).toBe('number');
  });
});
