/**
 * LINK-2 契约：后端返回必须满足前端各组件渲染所需字段（PRD §10 对接清单）。
 *
 * 前端组件 → 所需接口：
 * - ToolComposer 模型 chip + 参数 chip → catalog/models, catalog/models/:id
 * - 创作按钮价格 → pricing/quote
 * - 侧栏 planName + 积分 → billing/subscription, billing/balance
 * - 定价页 PriceTier → pricing/skus, plans, billing/credit-packs
 * - 提示词库 → prompt-library
 * - 首页 models[] → catalog/models
 */
import { describe, it, expect } from 'vitest';
import { req } from './client.js';

describe('LINK-2 前端字段契约', () => {
  it('capabilities 含 text_to_video（AppHomePage video 视图）', async () => {
    const r = await req('GET', '/api/v1/catalog/capabilities');
    expect(r.statusCode).toBe(200);
    const items = (r.body as { data: Array<{ code: string; nameI18n: unknown }> }).data;
    expect(items.length).toBeGreaterThan(0);
    expect(items.map((c) => c.code)).toContain('text_to_video');
  });

  it('models 下发 displayName + 参数维度（ToolComposer chip 渲染），无内部代号泄露', async () => {
    const r = await req('GET', '/api/v1/catalog/models?capability=text_to_video');
    expect(r.statusCode).toBe(200);
    const models = (r.body as { data: Array<Record<string, unknown>> }).data;
    expect(models.length).toBeGreaterThan(0);
    for (const m of models) {
      expect(typeof m['id']).toBe('string');
      expect(typeof m['displayName']).toBe('string');
      const dn = String(m['displayName']);
      expect(dn).not.toMatch(/^tt-/);
      expect(dn.toLowerCase()).not.toContain('guanfang');
      expect(dn).not.toMatch(/^hailuo-/);
      expect(dn).not.toMatch(/^seedance-/);
      expect(dn).not.toMatch(/^gk-video-/);
      expect(dn.toLowerCase()).not.toContain('quannengcankao');
    }
    // gk-video-3 必须在列（§13 #19 的锚点模型）
    const gk = models.find((m) => String(m['displayName']).includes('GK Video 3'));
    expect(gk).toBeTruthy();
  });

  it('models/:id 返回 params 定义 + pricing 矩阵（参数联动 + 实时报价）', async () => {
    const list = await req('GET', '/api/v1/catalog/models?capability=text_to_video');
    const first = (list.body as { data: Array<{ id: string }> }).data[0]!;
    const r = await req('GET', `/api/v1/catalog/models/${first.id}`);
    expect(r.statusCode).toBe(200);
    const data = (r.body as { data: { params: unknown; pricing: unknown[] } }).data;
    expect(data.params).toBeTruthy();
    expect(Array.isArray(data.pricing)).toBe(true);
    expect(data.pricing.length).toBeGreaterThan(0);
  });

  it('plans 含 free/pro，pro 月额度 1000（侧栏 planName + 积分）', async () => {
    const r = await req('GET', '/api/v1/plans');
    expect(r.statusCode).toBe(200);
    // 响应包一层对象 { plans: [...] }（不是裸数组），前端按此取
    const plans = (r.body as { data: { plans: Array<{ code: string; monthlyCredits: number }> } }).data
      .plans;
    const codes = plans.map((p) => p.code);
    expect(codes).toContain('free');
    expect(codes).toContain('pro');
    expect(plans.find((p) => p.code === 'pro')!.monthlyCredits).toBe(1000);
  });

  it('pricing/skus 非空（定价页 PriceTier）', async () => {
    const r = await req('GET', '/api/v1/pricing/skus');
    expect(r.statusCode).toBe(200);
    // 同上：{ skus: [{ modelId, displayName, capability, specs: [{ spec, credits }] }] }
    const items = (r.body as { data: { skus: unknown[] } }).data.skus;
    expect(items.length).toBeGreaterThan(0);
  });

  it('prompt-library 返回 tabs/cards（提示词库分区），cards 非空且只有一个 all', async () => {
    const r = await req('GET', '/api/v1/prompt-library');
    expect(r.statusCode).toBe(200);
    const data = (r.body as { data: { tabs: Array<{ id: string }>; cards: unknown[] } }).data;
    expect(data.tabs.length).toBeGreaterThan(0);
    // cards 来自 seed 夹具；曾因测试 truncate 被清空过（现已加入保留表），此处锁定非空
    expect(data.cards.length).toBeGreaterThan(0);
    // 'all' 是虚拟插入的约定值，表里若多存一行就会出现两个 all
    expect(data.tabs.filter((t) => t.id === 'all')).toHaveLength(1);
  });

  it('quote：gk-video-3/10s = 13 积分（创作按钮价格显示）', async () => {
    const r = await req('POST', '/api/v1/pricing/quote', {
      payload: { capability: 'text_to_video', modelId: 'gk-video-3', params: { durationSec: 10 } },
    });
    expect(r.statusCode).toBe(200);
    expect((r.body as { data: { credits: number } }).data.credits).toBe(13);
  });
});
