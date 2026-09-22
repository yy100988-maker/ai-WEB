/**
 * 资产列表筛选语义测试（纯函数，不连 DB）。
 *
 * 为什么单独锁这个：`kind` 参数历史上同时承载两种语义——
 *   - `upload` / `output`：assets.kind 的真实 Prisma 枚举
 *   - `image` / `video` / `audio`：媒体类型（按 mime_type 前缀筛）
 * 早期实现把 image/video/audio 也塞进 `where.kind`，Prisma 直接抛错/恒空；
 * 而路由层又曾用「先分页再内存 filter」兜底，导致筛选后每页数量不足、
 * 翻页漏数据。这里把两种语义的映射锁死，防止再次回归。
 */

import { describe, expect, it } from 'vitest';
import { buildKindFilter } from './service.js';

describe('buildKindFilter — 归属 vs 媒体类型语义分流', () => {
  it('upload / output 走 kind 枚举', () => {
    expect(buildKindFilter({ kind: 'upload' })).toEqual({ kind: 'upload' });
    expect(buildKindFilter({ kind: 'output' })).toEqual({ kind: 'output' });
  });

  it('image / video / audio 走 mimeType 前缀（绝不出现在 kind 里）', () => {
    for (const [media, prefix] of [
      ['image', 'image/'],
      ['video', 'video/'],
      ['audio', 'audio/'],
    ] as const) {
      const f = buildKindFilter({ kind: media });
      expect(f.kind).toBeUndefined();
      expect(f.mimeType).toEqual({ startsWith: prefix });
    }
  });

  it('mediaType 显式传入时优先级最高', () => {
    expect(buildKindFilter({ kind: 'output', mediaType: 'image' })).toEqual({
      kind: 'output',
      mimeType: { startsWith: 'image/' },
    });
  });

  it('空入参不过滤', () => {
    expect(buildKindFilter({})).toEqual({});
  });

  it('未知 kind 既不进枚举也不进 mime（不产生无效查询）', () => {
    expect(buildKindFilter({ kind: 'nonsense' })).toEqual({});
  });
});
