/**
 * seed ↔ quote 规格对齐测试（**防止价格表查不到行的静默故障**）。
 *
 * 为什么单独一个文件：`prisma/seed.ts` 写入 price_items 的 spec 与 `engine.normalizeSpec`
 * 抽取的规格必须**逐字节**一致（specHash = sha256(canonicalJson(spec))）。
 * 一旦两边漂移（比如 seed 多写一个键、engine 少抽一个键），
 * quote 就永远查不到行 → 全站静默回落到 estimated 现算，
 * 既有价格表失效、运营改价不生效，而且**不会报错**，是最难发现的一类故障。
 *
 * 本文件直接引用 seed 里的真实规格字面量，锁死这个契约。
 * 若 seed 或 SPEC_KEYS 变动导致 hash 不再匹配，这里立刻爆红。
 */

import { describe, expect, it } from 'vitest';
import { normalizeSpec, hashSpec, SPEC_KEYS } from './engine.js';
import { specHashOf } from '../../core/crypto.js';
import { costUnitsToCredits } from '../../core/pricing-math.js';

/**
 * 取自 prisma/seed.ts 的真实 (spec, costUnits) 组合。
 *
 * ⚠️ expectedCredits 是**按公式实算**的值 ceil(costUnits × 1.3×100÷6.9)，
 * 而不是照抄 PRD §6.3 表格。核对过程中发现 seed 的成本单元与 PRD 表格存在两处不一致，
 * 已在下方 it() 中显式标注——这类差异必须让运营/产品确认，不能由实现方擅自"对齐"。
 */
const SEED_CASES: Array<{
  model: string;
  spec: Record<string, unknown>;
  costUnits: number;
  expectedCredits: number;
}> = [
  { model: 'gk-video-3', spec: { durationSec: 6 }, costUnits: 0.414, expectedCredits: 8 },
  { model: 'gk-video-3', spec: { durationSec: 10 }, costUnits: 0.69, expectedCredits: 13 },

  { model: 'hailuo-h3', spec: { resolution: '768P', durationSec: 5 }, costUnits: 0.414, expectedCredits: 8 },
  { model: 'hailuo-h3', spec: { resolution: '768P', durationSec: 10 }, costUnits: 0.828, expectedCredits: 16 },
  { model: 'hailuo-h3', spec: { resolution: '768P', durationSec: 15 }, costUnits: 1.242, expectedCredits: 24 },

  { model: 'hailuo-h3-quannengcankao', spec: { resolution: '1080P', durationSec: 10 }, costUnits: 1.7, expectedCredits: 33 },

  { model: 'tt-image-2', spec: { size: '1024x1024' }, costUnits: 0.0317, expectedCredits: 1 },
  // ⚠️ 原为 4096x4096：上游实测单边 >3840 且总像素超上限，直接 400。
  // 已改用 2880x2880（8.29M 像素，恰在上限内）覆盖 4K 档。
  { model: 'tt-image-2', spec: { size: '2880x2880' }, costUnits: 0.1656, expectedCredits: 4 },
  { model: 'tt-image-2.5', spec: { resolution: '2K', background: 'transparent' }, costUnits: 0.083, expectedCredits: 2 },
];

describe('seed ↔ quote 规格契约', () => {
  it('SPEC_KEYS 覆盖 seed 用到的全部规格维度', () => {
    const usedInSeed = new Set<string>();
    for (const c of SEED_CASES) for (const k of Object.keys(c.spec)) usedInSeed.add(k);

    for (const key of usedInSeed) {
      expect(SPEC_KEYS as readonly string[]).toContain(key);
    }
  });

  it('quote 侧 params 规范化后的 hash == seed 侧 spec 的 hash', () => {
    for (const c of SEED_CASES) {
      // quote 收到的 params 含规格键 + 一堆非规格键（prompt/model/seed...）
      const params = { ...c.spec, prompt: '一只猫在跳舞', model: 'ignored', seed: 12345 };
      const fromQuote = hashSpec(normalizeSpec(params as Record<string, unknown>));
      const fromSeed = specHashOf(c.spec);

      expect(fromQuote, `spec 漂移：${c.model} ${JSON.stringify(c.spec)}`).toBe(fromSeed);
    }
  });

  it('seed 的 costUnits 换算出的积分与公式一致', () => {
    for (const c of SEED_CASES) {
      expect(
        costUnitsToCredits(c.costUnits),
        `${c.model} ${JSON.stringify(c.spec)}`,
      ).toBe(c.expectedCredits);
    }
  });

  /**
   * ⚠️ 已发现的两处 PRD 表格 vs seed 成本单元不一致（需产品/运营确认，不由实现方擅改）：
   *
   *  1. PRD §6.3 写 hailuo-h3 1080P/10s = **32**，但 seed 的 costUnits = 1.7
   *     → ceil(1.7 × 18.8406) = **33**，比表格多 1 积分。
   *     （若要用 32，成本单元应 ≤ 1.6985；PRD §6.2 的示例成本是 0.1656×10 = 1.656 → 32）
   *  2. PRD §6.3 写 tt-image-2 4K = **3**，但 seed 的 costUnits = 0.1656
   *     → ceil(0.1656 × 18.8406) = **4**，比表格多 1 积分。
   *     （0.1656 恰好是 PRD 里 tt-image-2 的**成本上界**"0.0317~0.1656"，
   *       即 seed 取了最贵分组而不是"最低激活分组"。）
   *
   * 本测试只锁「公式算得对」，不锁 PRD 表格数字；上述差异请运营确认后修 seed。
   */
  it('记录 PRD 表格与 seed 成本单元的两处已知差异（防静默漂移）', () => {
    // hailuo 1080P/10s：seed 1.7 → 33（PRD 表格期望 32）
    expect(costUnitsToCredits(1.7)).toBe(33);
    expect(costUnitsToCredits(1.656)).toBe(32); // PRD §6.2 示例成本

    // tt-image-2 4K：seed 0.1656 → 4（PRD 表格期望 3）
    expect(costUnitsToCredits(0.1656)).toBe(4);
    expect(costUnitsToCredits(0.16)).toBe(4);
    expect(costUnitsToCredits(0.1592)).toBe(3); // 要得 3 需要 ≤ 0.1592
  });

  it('非规格键不影响 hash（prompt 变、价格不变）', () => {
    const base = { resolution: '768P', durationSec: 10 };
    const h1 = hashSpec(normalizeSpec({ ...base, prompt: 'A' }));
    const h2 = hashSpec(normalizeSpec({ ...base, prompt: 'B' }));
    const h3 = hashSpec(normalizeSpec({ ...base, prompt: '完全不同的提示词', seed: 999 }));
    expect(h1).toBe(h2);
    expect(h2).toBe(h3);
    expect(h1).toBe(specHashOf(base));
  });

  it('规格值大小写/类型改变会改变 hash（防止悄悄错配到别的行）', () => {
    expect(hashSpec(normalizeSpec({ resolution: '768p', durationSec: 10 }))).not.toBe(
      hashSpec(normalizeSpec({ resolution: '768P', durationSec: 10 })),
    );
    expect(hashSpec(normalizeSpec({ durationSec: 10 }))).not.toBe(
      hashSpec(normalizeSpec({ durationSec: '10' })),
    );
  });
});
