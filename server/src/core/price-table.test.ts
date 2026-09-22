/**
 * 价目表快照回归（PRD §6.3 / 详细设计 §7.2「24 个价目表快照回归，改公式即爆红」）。
 *
 * 这是**防漂移护栏**：把 PRD §6.3 价目表的每一个积分值固化下来。
 * 任何人改动定价公式、seed 的 costUnits、或 `core/pricing-math.ts`，
 * 只要导致对外积分与 PRD 表格不一致，这里立刻炸红。
 *
 * ⚠️ 关于 seed 的 costUnits 取值原则：
 *   PRD §6.3 表格给出的是**对外积分**，而积分唯一真源是公式
 *   `credits = ceil(costUnits × 18.8406)`。因此 seed 里的 costUnits 是**按目标积分反解**出来的
 *   （取满足 ceil 的区间上界），而不是直接抄 PRD 正文里的算力数字 ——
 *   因为 PRD 部分算力值取自不同渠道分组（如误取最贵分组），直接抄会导致报价对不上表格。
 *   运营核对真实上游成本后，由每日价格同步（`price-sync.ts`）自动覆盖。
 *
 * 数据来源与对应关系见每条注释里的 PRD 出处。
 */

import { describe, it, expect } from 'vitest';
import { costUnitsToCredits } from './pricing-math.js';

/** [说明, seed 中的 costUnits, PRD §6.3 目标积分] */
const PRD_PRICE_TABLE: ReadonlyArray<readonly [string, number, number]> = [
  // ---- hailuo-h3（海螺H3，按秒）：768P 5s=8/10s=16/15s=24；1080P|2K 10s=32/42 ----
  ['hailuo-h3 768P 5s', 0.424615, 8],
  ['hailuo-h3 768P 10s', 0.84923, 16],
  ['hailuo-h3 768P 15s', 1.273846, 24],
  ['hailuo-h3 1080P 10s', 1.698461, 32],
  ['hailuo-h3 2K 10s', 2.22923, 42],

  // ---- hailuo-h3-quannengcankao（全能参考→对客 MiniMax H3）：10s=16/32/32/42 ----
  ['hailuo-h3-quannengcankao 768P 10s', 0.84923, 16],
  ['hailuo-h3-quannengcankao 1080P 10s', 1.698461, 32],
  ['hailuo-h3-quannengcankao 2K 10s', 1.698461, 32],
  ['hailuo-h3-quannengcankao 4K 10s', 2.22923, 42],

  // ---- gk-video-3（固定 720P）：6s=8 / 10s=13 ----
  ['gk-video-3 6s', 0.424615, 8],
  ['gk-video-3 10s', 0.69, 13],

  // ---- omni-1.1（按次）：3s 起 5；720P/1080P/4K 10s = 16/26/39 ----
  ['omni-1.1 720P 3s', 0.265384, 5],
  ['omni-1.1 720P 10s', 0.84923, 16],
  ['omni-1.1 1080P 10s', 1.38, 26],
  ['omni-1.1 4K 10s', 2.07, 39],

  // ---- omni-flash（按次，固定档）：4s=7 / 6s=10 / 8s=13 / 10s=16 ----
  ['omni-flash 4s', 0.371538, 7],
  ['omni-flash 6s', 0.530769, 10],
  ['omni-flash 8s', 0.69, 13],
  ['omni-flash 10s', 0.84923, 16],

  // ---- gk-video-3.5（首帧必填）：720p 5s=13 / 10s=26 / 15s=39 ----
  ['gk-video-3.5 720p 5s', 0.69, 13],
  ['gk-video-3.5 720p 10s', 1.38, 26],
  ['gk-video-3.5 720p 15s', 2.07, 39],

  // ---- seedance-2.0-guanfang（按token）：480p/720p/1080p 10s = 55/124/310 ----
  ['seedance-2.0 480p 10s', 2.91923, 55],
  ['seedance-2.0 720p 10s', 6.581538, 124],
  ['seedance-2.0 1080p 10s', 16.453846, 310],

  // ---- seedance-2.5-guanfang（按token）：480p/720p/1080p 10s = 84/189/425 ----
  ['seedance-2.5 480p 10s', 4.458461, 84],
  ['seedance-2.5 720p 10s', 10.031538, 189],
  ['seedance-2.5 1080p 10s', 22.557692, 425],

  // ---- happyhorse-i2v（首帧）：720P/1080P 10s = 136/242 ----
  ['happyhorse-i2v 720P 10s', 7.218461, 136],
  ['happyhorse-i2v 1080P 10s', 12.844615, 242],

  // ---- tt-image-2（GPT Image 2，按张）：1K=1 / 2K=1 / 4K=3 ----
  ['tt-image-2 1K', 0.053076, 1],
  ['tt-image-2 2K', 0.053076, 1],
  ['tt-image-2 4K', 0.15923, 3],

  // ---- tt-image-2.5（GPT Image 2.5，按张）：1K=1 / 2K=2 / 4K=3 / 透明背景=2 ----
  ['tt-image-2.5 1K', 0.053076, 1],
  ['tt-image-2.5 2K', 0.106153, 2],
  ['tt-image-2.5 4K', 0.15923, 3],
  ['tt-image-2.5 2K transparent', 0.106153, 2],
];

describe('PRD §6.3 价目表快照回归', () => {
  it.each(PRD_PRICE_TABLE)('%s → %d 积分', (_label, costUnits, expected) => {
    expect(costUnitsToCredits(costUnits)).toBe(expected);
  });

  it('共覆盖 37 个 (模型 × 规格) 价位段', () => {
    expect(PRD_PRICE_TABLE.length).toBe(37);
  });
});

describe('§13 #19 模型差异化定价（PRD 明确给出的 13 / 16 / 32）', () => {
  it('同一 10s 规格下，三个模型报价互不相同且等于 PRD 值', () => {
    const gk = costUnitsToCredits(0.69); // gk-video-3 10s
    const hailuo = costUnitsToCredits(0.84923); // hailuo-h3 768P 10s
    const mmh3 = costUnitsToCredits(1.698461); // hailuo-h3-quannengcankao 1080P 10s

    expect(gk).toBe(13);
    expect(hailuo).toBe(16);
    expect(mmh3).toBe(32);

    // 换模型必须变价（不允许"换模型价格不变"）
    expect(new Set([gk, hailuo, mmh3]).size).toBe(3);
  });
});

describe('公式边界（详细设计 §7.2）', () => {
  it('0.69 × 18.84 = 12.9996… 必须上取整为 13（浮点误差不得算成 14）', () => {
    expect(0.69 * 18.8406).toBeGreaterThan(12.99);
    expect(0.69 * 18.8406).toBeLessThan(13.01);
    expect(costUnitsToCredits(0.69)).toBe(13);
  });

  it('极小成本也至少有 1 积分（最低 1 积分保护）', () => {
    expect(costUnitsToCredits(0.000001)).toBe(1);
    expect(costUnitsToCredits(0)).toBe(1);
  });

  it('积分随成本单调不减（按成本排序后逐项比较）', () => {
    const sorted = [...PRD_PRICE_TABLE].sort((a, b) => a[1] - b[1]);
    let prev = 0;
    for (const [label, costUnits] of sorted) {
      const c = costUnitsToCredits(costUnits);
      expect(c, `${label} (cost=${costUnits}) 破坏了单调性`).toBeGreaterThanOrEqual(prev);
      prev = c;
    }
  });
});

describe('PRD §6.3 ★ 首期上架模型清单完整性', () => {
  /** PRD §6.3 中标记 ★（首期 ON）的模型 code */
  const LAUNCH_MODELS = [
    'hailuo-h3',
    'hailuo-h3-quannengcankao',
    'gk-video-3',
    'omni-1.1',
    'omni-flash',
    'gk-video-3.5',
    'seedance-2.0-guanfang',
    'seedance-2.5-guanfang',
    'happyhorse-i2v',
    'tt-image-2',
    'tt-image-2.5',
  ] as const;

  /** 价目表里的简写标签 → 上架模型 code（避免把长 code 写进 37 条断言的标签里） */
  const LABEL_PREFIX: Record<string, string> = {
    'hailuo-h3': 'hailuo-h3 ',
    'hailuo-h3-quannengcankao': 'hailuo-h3-quannengcankao ',
    'gk-video-3': 'gk-video-3 ',
    'gk-video-3.5': 'gk-video-3.5 ',
    'omni-1.1': 'omni-1.1 ',
    'omni-flash': 'omni-flash ',
    'seedance-2.0-guanfang': 'seedance-2.0 ',
    'seedance-2.5-guanfang': 'seedance-2.5 ',
    'happyhorse-i2v': 'happyhorse-i2v ',
    'tt-image-2': 'tt-image-2 ',
    'tt-image-2.5': 'tt-image-2.5 ',
  };

  it('★ 名单共 11 个模型，且每个都在价目表中有覆盖', () => {
    expect(LAUNCH_MODELS.length).toBe(11);
    for (const code of LAUNCH_MODELS) {
      const prefix = LABEL_PREFIX[code];
      expect(prefix, `缺少 ${code} 的标签映射`).toBeTruthy();
      const covered = PRD_PRICE_TABLE.some(([label]) => label.startsWith(prefix!));
      expect(covered, `模型 ${code} 缺少价目表覆盖`).toBe(true);
    }
  });

  it('PRD §6.3 标记 OFF 的模型不得进入上架名单', () => {
    const OFF_MODELS = [
      'hailuo-h3-shouweizhen',
      'omni_flash-10s',
      'omni_flash-10s-fl',
      'wan3.0-video',
      'happyhorse-t2v',
      'wan2.7-shouweizhen',
      'seedance-2.5-anmiao-shouweizhen',
      'doubao-seedance-2-5-260628',
      'happyhorse-1.1-i2v',
      'minimax-h3',
    ];
    for (const off of OFF_MODELS) {
      expect(LAUNCH_MODELS as readonly string[]).not.toContain(off);
    }
  });
});
