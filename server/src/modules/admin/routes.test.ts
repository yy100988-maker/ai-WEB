/**
 * admin 模块单测（详细设计 §2.7 / PRD §8.2）。
 *
 * 重点：
 *  - `ADMIN_TOKEN` Bearer 鉴权（含**常量时间比较**的用法）
 *  - 上下架写入 `AdminAuditLog`
 *  - ⚠️ 上架前拒绝含内部代号的 display_name（PRD §8.2 硬性规则的前置守卫）
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------- 桩

interface FakeModel {
  id: string;
  code: string;
  displayName: string;
  active: boolean;
  enabled: boolean;
}
interface FakeAudit {
  adminKey: string;
  action: string;
  target: unknown;
  payload: unknown;
}

const store = {
  models: [] as FakeModel[],
  audits: [] as FakeAudit[],
};

const configHolder = vi.hoisted(() => ({ value: { ADMIN_TOKEN: 'super-secret-admin-token' } }));

vi.mock('../../core/config.js', () => ({
  getConfig: () => configHolder.value,
}));

vi.mock('../../core/logger.js', () => ({
  childLogger: () => ({
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  }),
}));

vi.mock('../../core/db.js', () => ({
  db: () => ({
    model: {
      findFirst: async ({ where }: { where: { OR: Array<{ id?: string; code?: string }> } }) => {
        const id = where.OR.find((c) => c.id !== undefined)?.id;
        const code = where.OR.find((c) => c.code !== undefined)?.code;
        return store.models.find((m) => m.id === id || m.code === code) ?? null;
      },
      update: async ({ where, data }: { where: { id: string }; data: { active: boolean } }) => {
        const m = store.models.find((x) => x.id === where.id);
        if (!m) throw new Error('model not found');
        m.active = data.active;
        return { ...m };
      },
    },
    adminAuditLog: {
      create: async ({ data }: { data: FakeAudit }) => {
        store.audits.push(data);
        return data;
      },
    },
  }),
}));

import { adminGuard, adminKeyFingerprint, verifyAdminToken } from './routes.js';
import { sha256 } from '../../core/crypto.js';

function makeReq(auth?: string): { headers: Record<string, string>; ip: string } {
  return { headers: auth ? { authorization: auth } : {}, ip: '127.0.0.1' };
}

beforeEach(() => {
  store.models = [
    { id: 'uuid-1', code: 'gk-video-3', displayName: 'GK Video 3', active: false, enabled: true },
    { id: 'uuid-2', code: 'tt-image-2', displayName: 'tt-image-2', active: false, enabled: true },
    { id: 'uuid-3', code: 'bad-name', displayName: 'hailuo-h3-quannengcankao', active: false, enabled: true },
  ];
  store.audits = [];
  configHolder.value.ADMIN_TOKEN = 'super-secret-admin-token';
});

// ================================================================ 鉴权

describe('ADMIN_TOKEN Bearer 鉴权', () => {
  it('正确 token 通过', () => {
    const token = verifyAdminToken(makeReq('Bearer super-secret-admin-token') as never);
    expect(token).toBe('super-secret-admin-token');
  });

  it('缺失 Authorization → 401', () => {
    expect(() => verifyAdminToken(makeReq() as never)).toThrow(
      expect.objectContaining({ code: 'UNAUTHORIZED', status: 401 }),
    );
  });

  it('非 Bearer 前缀 → 401', () => {
    expect(() => verifyAdminToken(makeReq('Basic abc') as never)).toThrow(
      expect.objectContaining({ code: 'UNAUTHORIZED' }),
    );
  });

  it('错误 token → 401', () => {
    expect(() => verifyAdminToken(makeReq('Bearer wrong-token') as never)).toThrow(
      expect.objectContaining({ code: 'UNAUTHORIZED' }),
    );
  });

  it('token 长度不同 → 401（safeEqual 长度不等提前返回 false）', () => {
    expect(() => verifyAdminToken(makeReq('Bearer super-secret-admin-toke') as never)).toThrow(
      expect.objectContaining({ code: 'UNAUTHORIZED' }),
    );
  });

  it('空 Bearer → 401', () => {
    expect(() => verifyAdminToken(makeReq('Bearer ') as never)).toThrow(
      expect.objectContaining({ code: 'UNAUTHORIZED' }),
    );
  });

  it('大小写敏感（token 是密文，不做归一化）', () => {
    expect(() =>
      verifyAdminToken(makeReq('Bearer SUPER-SECRET-ADMIN-TOKEN') as never),
    ).toThrow(expect.objectContaining({ code: 'UNAUTHORIZED' }));
  });
});

describe('adminKeyFingerprint（审计只存指纹，不存明文）', () => {
  it('是 sha256 前 12 位', () => {
    const fp = adminKeyFingerprint('super-secret-admin-token');
    expect(fp).toHaveLength(12);
    expect(fp).toBe(sha256('super-secret-admin-token').slice(0, 12));
    expect(fp).toMatch(/^[0-9a-f]{12}$/);
  });

  it('★ 指纹绝不等于明文 token', () => {
    const token = 'super-secret-admin-token';
    expect(adminKeyFingerprint(token)).not.toBe(token);
    expect(adminKeyFingerprint(token)).not.toContain(token);
  });

  it('同一 token 指纹稳定', () => {
    expect(adminKeyFingerprint('x')).toBe(adminKeyFingerprint('x'));
  });

  it('不同 token 指纹不同', () => {
    expect(adminKeyFingerprint('a')).not.toBe(adminKeyFingerprint('b'));
  });
});

describe('adminGuard 幂等', () => {
  it('重复调用不抛（hasDecorator 判断）', () => {
    const decorated = new Set<string>();
    const app = {
      hasDecorator: (name: string) => decorated.has(name),
      decorate: (name: string, fn: unknown) => {
        decorated.add(name);
        (app as unknown as Record<string, unknown>)[name] = fn;
      },
    } as never;

    expect(() => {
      adminGuard(app);
      adminGuard(app);
      adminGuard(app);
    }).not.toThrow();
    expect(decorated.size).toBe(1);
  });
});

// ================================================================ 上下架逻辑（纯函数级）

describe('上架前 display_name 校验（PRD §8.2 前置守卫）', () => {
  it('合法展示名可上架', async () => {
    const { findInternalCodenameLeaks } = await import('../catalog/service.js');
    expect(findInternalCodenameLeaks('GK Video 3')).toEqual([]);
  });

  it('内部代号被识别（会被 admin 拒绝上架）', async () => {
    const { findInternalCodenameLeaks } = await import('../catalog/service.js');
    expect(findInternalCodenameLeaks('tt-image-2').length).toBeGreaterThan(0);
    expect(findInternalCodenameLeaks('hailuo-h3-quannengcankao').length).toBeGreaterThan(0);
  });

  it('空展示名视为不合规', async () => {
    const { isSafeDisplayName } = await import('../catalog/service.js');
    expect(isSafeDisplayName('')).toBe(false);
    expect(isSafeDisplayName('   ')).toBe(false);
  });
});

// ================================================================ 审计写入

describe('AdminAuditLog 写入', () => {
  it('recordAdminAudit 写入 action/target/payload/adminKey', async () => {
    const { recordAdminAudit } = await import('./routes.js');
    await recordAdminAudit({
      adminKey: adminKeyFingerprint('tok'),
      action: 'models.active',
      target: { modelId: 'uuid-1', modelCode: 'gk-video-3' },
      payload: { before: false, after: true },
    });

    expect(store.audits).toHaveLength(1);
    expect(store.audits[0]).toMatchObject({
      action: 'models.active',
      target: { modelId: 'uuid-1', modelCode: 'gk-video-3' },
      payload: { before: false, after: true },
    });
    // 审计里只有指纹，没有明文
    expect(JSON.stringify(store.audits[0])).not.toContain('tok');
  });

  it('审计写失败不抛异常（不阻塞运营操作）', async () => {
    const dbMod = await import('../../core/db.js');
    const spy = vi.spyOn(dbMod, 'db').mockReturnValue({
      adminAuditLog: {
        create: async () => {
          throw new Error('db down');
        },
      },
    } as unknown as ReturnType<typeof dbMod.db>);

    const { recordAdminAudit } = await import('./routes.js');
    await expect(
      recordAdminAudit({ adminKey: 'x', action: 'models.active', target: {} }),
    ).resolves.toBeUndefined();
    spy.mockRestore();
  });
});
