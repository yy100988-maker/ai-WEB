/**
 * Google ID Token 真实验签（RS256 + JWKS）。
 *
 * 为什么必须验签：OAuth 登录此前仅 base64 解 payload —— 任何人都能伪造
 * `{sub, email}` 自制 token 登录任意邮箱账号。生产环境必须验签，
 * 否则等于没有认证。
 *
 * 校验链（缺一不可）：
 *  1. JWT 头 `kid` 对应在 Google JWKS（`https://www.googleapis.com/oauth2/v3/certs`）
 *     的公钥，用该公钥验 RS256 签名；
 *  2. `iss` 为 `https://accounts.google.com` 或 `accounts.google.com`；
 *  3. `aud` 等于我方 `GOOGLE_CLIENT_ID`（防 token 被挪用到别的 Client）；
 *  4. `exp` 未过期（允许 60s 时钟漂移）；
 *  5. `email_verified` 为 true 才信任 email（否则只认 sub）。
 *
 * 公钥缓存 1h（Google 轮换约每天一次；kid miss 时强制刷新一次再判）。
 * JWKS 拉取失败 → 直接 503（不断头、不降级为"不验"）。
 */

import { createVerify, createPublicKey } from 'node:crypto';
import { childLogger } from '../../core/logger.js';
import { getConfig } from '../../core/config.js';
import { err } from '../../core/errors.js';

const log = childLogger({ mod: 'auth-google' });

const GOOGLE_CERTS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const GOOGLE_ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com']);
const CLOCK_SKEW_SEC = 60;
const FETCH_TIMEOUT_MS = 10000;

interface JwkKey {
  kid?: string;
  kty?: string;
  n?: string;
  e?: string;
  use?: string;
}

let certsCache: { at: number; keys: JwkKey[] } | null = null;
const CERTS_CACHE_TTL_MS = 60 * 60 * 1000;

/** 拉取实现（默认打 Google；单元测试注入内存实现，绝不碰外网） */
let fetcher: () => Promise<JwkKey[]> = fetchCerts;

/** 测试用：注入 JWKS 拉取实现 */
export function setCertsFetcherForTest(next: (() => Promise<JwkKey[]>) | null): void {
  fetcher = next ?? fetchCerts;
}

export interface GoogleClaims {
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
}

function base64urlDecode(input: string): Buffer {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(normalized, 'base64');
}

async function fetchCerts(): Promise<JwkKey[]> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(GOOGLE_CERTS_URL, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { keys?: JwkKey[] };
    if (!Array.isArray(data.keys) || data.keys.length === 0) {
      throw new Error('empty keys');
    }
    return data.keys;
  } finally {
    clearTimeout(timer);
  }
}

async function getCerts(forceRefresh = false): Promise<JwkKey[]> {
  if (!forceRefresh && certsCache && Date.now() - certsCache.at < CERTS_CACHE_TTL_MS) {
    return certsCache.keys;
  }
  const keys = await fetcher().catch((e: unknown) => {
    log.error({ err: e }, 'fetch google certs failed');
    // 缓存过期但拉取失败：用旧缓存顶一下（总比直接 503 强，但记 error）；
    // 从无缓存则只能 503。
    if (certsCache) return certsCache.keys;
    throw err.noHealthyProvider(300, 'google_certs_unreachable');
  });
  certsCache = { at: Date.now(), keys };
  return keys;
}

/** 测试用：注入 JWKS（单元测试不碰外网） */
export function setGoogleCertsForTest(keys: JwkKey[] | null): void {
  certsCache = keys ? { at: Date.now(), keys } : null;
}

function verifySignature(signingInput: string, signature: Buffer, jwk: JwkKey): boolean {
  if (jwk.kty !== 'RSA' || !jwk.n || !jwk.e) return false;
  try {
    const key = createPublicKey({ key: { kty: 'RSA', n: jwk.n, e: jwk.e }, format: 'jwk' });
    return createVerify('RSA-SHA256').update(signingInput).verify(key, signature);
  } catch {
    return false;
  }
}

/**
 * 验签并返回可信 claims。任何一步失败 → 401（不区分原因，防信息泄露）。
 */
export async function verifyGoogleIdToken(idToken: string): Promise<GoogleClaims> {
  const cfg = getConfig();
  if (!cfg.GOOGLE_CLIENT_ID) {
    log.error('GOOGLE_CLIENT_ID missing');
    throw err.serviceUnavailable('google_oauth_not_configured');
  }

  const parts = idToken.split('.');
  if (parts.length !== 3) throw err.unauthorized({ reason: 'malformed_id_token' });

  let header: { kid?: string; alg?: string };
  let payload: Record<string, unknown>;
  try {
    header = JSON.parse(base64urlDecode(parts[0]!).toString('utf8')) as typeof header;
    payload = JSON.parse(base64urlDecode(parts[1]!).toString('utf8')) as typeof payload;
  } catch {
    throw err.unauthorized({ reason: 'malformed_id_token' });
  }

  if (header.alg !== 'RS256' || !header.kid) {
    throw err.unauthorized({ reason: 'unexpected_alg' });
  }

  const fail = (reason: string): never => {
    log.warn({ reason, kid: header.kid }, 'google id token rejected');
    throw err.unauthorized({ reason });
  };

  // 1. 签名（kid miss 时强制刷新一次，应对 Google 轮换）
  const signingInput = `${parts[0]}.${parts[1]}`;
  const signature = base64urlDecode(parts[2]!);
  let keys = await getCerts().catch(() => {
    throw err.noHealthyProvider(300, 'google_certs_unreachable');
  });
  let jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) {
    keys = await getCerts(true).catch(() => {
      throw err.noHealthyProvider(300, 'google_certs_unreachable');
    });
    jwk = keys.find((k) => k.kid === header.kid);
  }
  if (!jwk || !verifySignature(signingInput, signature, jwk)) {
    fail('bad_signature');
  }

  // 2/3/4. iss / aud / exp
  const nowSec = Math.floor(Date.now() / 1000);
  if (typeof payload['iss'] !== 'string' || !GOOGLE_ISSUERS.has(payload['iss'])) fail('bad_issuer');
  if (payload['aud'] !== cfg.GOOGLE_CLIENT_ID) fail('bad_audience');
  if (typeof payload['exp'] !== 'number' || payload['exp'] + CLOCK_SKEW_SEC < nowSec) fail('token_expired');

  const sub = payload['sub'];
  if (typeof sub !== 'string' || !sub) fail('missing_sub');

  // 5. email 仅在 verified 时信任
  const emailVerified = payload['email_verified'] === true || payload['email_verified'] === 'true';
  const email = emailVerified && typeof payload['email'] === 'string' ? payload['email'].toLowerCase() : undefined;

  return {
    sub: sub as string,
    ...(email ? { email } : {}),
    ...(typeof payload['name'] === 'string' ? { name: payload['name'] } : {}),
    ...(typeof payload['picture'] === 'string' ? { picture: payload['picture'] } : {}),
  };
}
