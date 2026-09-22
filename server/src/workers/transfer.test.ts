/**
 * isAllowedMockOutputUrl 白名单回归（§13 #16 转存链路的护栏）。
 *
 * 背景：Mock 模式下 downloadOutput 拒绝一切非本地 URL，防止误配置打到真实上游。
 * 但白名单最初只认 localhost/127.0.0.1/minio，compose 部署里 fixture 基址是
 * `http://api:8080` —— 结果所有转存被自己的保险拦掉，`result_asset_ids` 恒为空。
 * 此测试锁定：配置的 fixture host 必须放行，子串欺骗必须拦截。
 */

import { describe, it, expect } from 'vitest';
import { isAllowedMockOutputUrl } from './transfer.js';

describe('isAllowedMockOutputUrl', () => {
  const COMPOSE = 'http://api:8080';
  const LOCAL = 'http://localhost:8080';

  it('放行配置的 fixture 基址（compose service 名）', () => {
    expect(isAllowedMockOutputUrl('http://api:8080/mock-fixture/video.mp4', COMPOSE)).toBe(true);
  });

  it('放行 localhost / 127.0.0.1', () => {
    expect(isAllowedMockOutputUrl('http://localhost:8080/mock-fixture/video.mp4', LOCAL)).toBe(true);
    expect(isAllowedMockOutputUrl('http://127.0.0.1:8080/mock-fixture/image.png', LOCAL)).toBe(true);
  });

  it('放行 data: 内联与 minio 内网名', () => {
    expect(isAllowedMockOutputUrl('data:video/mp4;base64,AAAA', LOCAL)).toBe(true);
    expect(isAllowedMockOutputUrl('http://minio:9000/vutu/x.mp4', LOCAL)).toBe(true);
  });

  it('拦截外网 URL（防误打真实上游）', () => {
    expect(isAllowedMockOutputUrl('https://api.lk888.ai/api/file.mp4', COMPOSE)).toBe(false);
    expect(isAllowedMockOutputUrl('https://cdn.example.com/v.mp4', LOCAL)).toBe(false);
  });

  it('拦截子串欺骗：evil-localhost.example.com 不是 localhost', () => {
    expect(isAllowedMockOutputUrl('http://evil-localhost.example.com/x.mp4', LOCAL)).toBe(false);
    expect(isAllowedMockOutputUrl('http://api.evil.com/mock-fixture/video.mp4', COMPOSE)).toBe(false);
  });

  it('非法 URL 直接拒绝', () => {
    expect(isAllowedMockOutputUrl('not-a-url', LOCAL)).toBe(false);
  });
});
