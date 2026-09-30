/**
 * SSRF 防护（PRD §8.3 `import-url 安全约束` / §13 #21 是**验收项**）。
 *
 * 攻击面：`POST /v1/assets/import-url { url }` 让**服务端**去拉一个用户给的 URL。
 * 不加防护，攻击者就能：
 *   - 拉 `http://169.254.169.254/latest/meta-data/iam/security-credentials/` 偷云元数据凭据；
 *   - 拉 `http://127.0.0.1:6379/` / `http://10.0.0.5:5432/` 探测甚至写入内网服务；
 *   - 用 `http://internal-admin.local/` 借服务端身份访问内网后台；
 *   - 用**先解析到公网、连接时改回内网**（DNS rebinding）绕过"解析即校验"的实现。
 *
 * 因此本文件的防护是**纵深四层**，任何一层不过就拒绝：
 *  ① 协议白名单：仅 http/https（挡 `file:` `gopher:` `ftp:` `data:` 等）；
 *  ② 字面 IP 校验：URL 里直接写 IP 的，先查一遍内网段；
 *  ③ DNS 解析后**复验所有 IP**：不仅看第一个，任一解析结果落在内网段就拒绝
 *     （攻击者常配一条公网 A + 一条内网 A，只查第一个会漏）；
 *  ④ **IP pinning**：用解析出的 IP 直连并带 `Host` 头，**完全跳过二次 DNS 解析**，
 *     这是防 DNS rebinding 的唯一可靠手段 —— 只要还有一次"按域名再解析"，
 *     攻击者就能在 TTL=0 的记录上把公网 IP 换成内网 IP。
 *
 * 重定向：**手动跟随，最多 3 跳，每跳都重跑 ②③④**（PRD §8.3）。
 * 用 `undici` 的 `request` + 自建 `Agent`（`maxRedirections: 0`），不用全局 fetch 拿裸 socket。
 */

import { lookup as dnsLookup } from 'node:dns/promises';
import type { LookupAddress } from 'node:dns';
import { isIP } from 'node:net';
import ipaddr from 'ipaddr.js';
import { Agent, request } from 'undici';
import { childLogger } from '../../core/logger.js';

const log = childLogger({ mod: 'ssrf-guard' });

/** 重定向最大跳数（PRD §8.3：跟随重定向 ≤ 3 跳，每跳复验） */
export const MAX_REDIRECTS = 3;

/** import-url 整体超时（PRD §8.3：超时 30s） */
export const FETCH_TIMEOUT_MS = 30_000;

/** 单次 DNS 解析超时（防止敌意域名挂住解析） */
const DNS_TIMEOUT_MS = 5_000;

export class SsrfError extends Error {
  constructor(
    readonly reason: string,
    readonly detail?: Record<string, unknown>,
  ) {
    super(reason);
    this.name = 'SsrfError';
  }
}

// ---------------------------------------------------------------- 内网地址判定

/**
 * 判定一个 IP 是否属于**禁止访问的地址范围**。
 *
 * IPv4 禁止段（PRD §8.3 列举 + 补全同类风险段）：
 *   0.0.0.0/8        "本网络"，部分栈上等价 127.0.0.1
 *   10.0.0.0/8       私网 A
 *   100.64.0.0/10    CGNAT / 云厂商内部（AWS 部分服务用）
 *   127.0.0.0/8      环回
 *   169.254.0.0/16   链路本地 —— **云元数据 169.254.169.254 在这里**
 *   172.16.0.0/12    私网 B
 *   192.0.0.0/24     IETF 协议保留
 *   192.168.0.0/16   私网 C
 *   198.18.0.0/15    基准测试保留
 *   224.0.0.0/4      组播
 *   240.0.0.0/4      保留（含 255.255.255.255 广播）
 *
 * IPv6 禁止段（由 ipaddr.js 的规范化解析判定，书写形式不影响结果）：
 *   ::/128           未指定
 *   ::1/128          环回
 *   ::ffff:0:0/96    IPv4-mapped —— **必须拆出内嵌 IPv4 再判**，
 *                    否则 ::ffff:7f00:1（=127.0.0.1）会漏
 *   fc00::/7         唯一本地地址（ULA）
 *   fe80::/10        链路本地
 *   ff00::/8         组播
 *   2001:db8::/32    文档用（reserved）
 *   64:ff9b::/96     NAT64（可映射 IPv4）
 *   2002::/16        6to4（可内嵌任意 IPv4）
 */
export function isBlockedIp(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) return isBlockedIpv4(ip);
  if (version === 6) return isBlockedIpv6(ip);
  return true; // 不是合法 IP → 一律拒绝（宁可误杀）
}

function isBlockedIpv4(ip: string): boolean {
  const parts = ip.split('.').map((p) => Number.parseInt(p, 10));
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) return true;
  const [a, b] = parts as [number, number, number, number];

  if (a === 0) return true; // 0.0.0.0/8
  if (a === 10) return true; // 10/8
  if (a === 127) return true; // 127/8
  if (a === 169 && b === 254) return true; // 169.254/16（云元数据）
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
  if (a === 192 && b === 168) return true; // 192.168/16
  if (a === 192 && b === 0 && parts[2] === 0) return true; // 192.0.0/24
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64/10 CGNAT
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18/15
  if (a >= 224) return true; // 组播 + 保留 + 广播
  return false;
}

function isBlockedIpv6(ip: string): boolean {
  // ⚠️ 这里必须做**规范化解析**而不是前缀匹配。
  //
  // 历史事故（2026-09-30 修复）：旧实现用正则只识别点分十进制的
  // ::ffff:127.0.0.1，而 IPv6 允许十六进制写法 ::ffff:7f00:1。
  // 两者是**同一个地址**，但后者完全绕过正则 → 可直连 127.0.0.1 与
  // 169.254.169.254（云元数据）。已用真实 safeFetch 端到端验证过该绕过。
  //
  // 现在改用 ipaddr.js 做规范化：先 parse 出真实的字节表示，再判定网段，
  // 书写形式（点分/十六进制/全展开/大小写/zone id）不再影响结果。
  let addr: ipaddr.IPv6;
  try {
    const parsed = ipaddr.parse(ip.split('%')[0] ?? '');
    if (parsed.kind() !== 'ipv6') {
      // 理论上不会走到（isBlockedIp 已分流），兜底按 IPv4 判
      return isBlockedIpv4(parsed.toString());
    }
    addr = parsed as ipaddr.IPv6;
  } catch {
    return true; // 解析不了 → 宁可误杀
  }

  // IPv4-mapped（::ffff:a.b.c.d）：
  // 必须拆出内嵌 IPv4 复用 IPv4 网段表，否则 ::ffff:7f00:1 → 127.0.0.1 会漏
  if (addr.isIPv4MappedAddress()) {
    return isBlockedIpv4(addr.toIPv4Address().toString());
  }

  // IPv4-compatible（::a.b.c.d，RFC 4291 已废弃，但内核仍会路由）——
  // ⚠️ ipaddr.js v2 **不识别十六进制写法**：::7f00:1 会被误判为 'unicast' 而放行
  // （回归测试实测）。因此这里自己按「前 96 位全 0」判定并拆出内嵌 IPv4。
  // ::/96 本身是保留段，无论拆出的 IPv4 是什么都应拒绝，因此统一走 IPv4 网段表。
  const [g0, g1, g2, g3, g4, g5, g6, g7] = addr.parts as number[];
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) {
    const hi = (g6 as number) >>> 8;
    const lo = (g7 as number) >>> 8;
    const v4 = [hi >>> 8, hi & 0xff, lo >>> 8, lo & 0xff].join('.');
    return isBlockedIpv4(v4);
  }

  switch (addr.range()) {
    case 'unspecified': // ::
    case 'loopback': // ::1
    case 'linkLocal': // fe80::/10
    case 'uniqueLocal': // fc00::/7 ULA
    case 'multicast': // ff00::/8
    case 'reserved': // 含 2001:db8::/32 文档段等
    case '6to4': // 2002::/16 —— 可内嵌任意 IPv4
    case 'rfc6052': // 64:ff9b::/96 NAT64 —— 可映射任意 IPv4
      return true;
    default:
      // 只放行真正的全球单播；未知 range 一律拒绝（宁可误杀）
      return addr.range() !== 'unicast';
  }
}

/** 附加防御：主机名黑名单（不改 DNS 也能识别的内网别名） */
const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'ip6-localhost',
  'ip6-loopback',
  'metadata',
  'metadata.google.internal',
  'metadata.goog',
  'instance-data',
]);

/** 常见内网/保留 TLD 与后缀 */
const BLOCKED_HOST_SUFFIXES = ['.local', '.internal', '.intranet', '.lan', '.home', '.corp', '.localhost'];

export function isBlockedHostname(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, ''); // 去掉 FQDN 尾部点
  if (BLOCKED_HOSTNAMES.has(h)) return true;
  if (h.endsWith('.localhost')) return true;
  return BLOCKED_HOST_SUFFIXES.some((s) => h.endsWith(s));
}

// ---------------------------------------------------------------- URL 校验

export interface ParsedTarget {
  url: URL;
  hostname: string;
  port: number;
}

/**
 * 第 ①② 层：协议白名单 + 字面 IP / 主机名黑名单。
 * **不做 DNS 解析**，所以是同步的（可在路由层快速失败）。
 */
export function validateUrlSyntax(rawUrl: string): ParsedTarget {
  if (typeof rawUrl !== 'string' || rawUrl.length === 0 || rawUrl.length > 2048) {
    throw new SsrfError('URL 长度非法');
  }

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SsrfError('URL 格式非法');
  }

  // ① 协议白名单：仅 http/https（挡 file:/gopher:/ftp:/data:/dict: 等）
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new SsrfError(`不支持的协议：${url.protocol}`, { protocol: url.protocol });
  }

  // 禁止携带用户名密码（可被用于构造钓鱼/绕过某些解析器的歧义写法）
  if (url.username || url.password) {
    throw new SsrfError('URL 不允许携带用户凭据');
  }

  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, ''); // 去掉 IPv6 方括号

  if (!hostname) throw new SsrfError('URL 缺少主机名');

  // 主机名黑名单（localhost / .local / .internal …）
  if (isBlockedHostname(hostname)) {
    throw new SsrfError(`禁止访问的内网主机名：${hostname}`, { hostname });
  }

  // ② 字面 IP 直接判定（无需 DNS）
  if (isIP(hostname) !== 0 && isBlockedIp(hostname)) {
    throw new SsrfError(`禁止访问的内网地址：${hostname}`, { hostname });
  }

  const port = url.port ? Number.parseInt(url.port, 10) : url.protocol === 'https:' ? 443 : 80;
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new SsrfError('端口非法');
  }

  return { url, hostname, port };
}

// ---------------------------------------------------------------- DNS 解析 + 复验

export interface ResolvedTarget {
  hostname: string;
  /** 全部解析结果（**每一个都通过校验**才会返回） */
  addresses: LookupAddress[];
  /** pinning 用的首个可用地址 */
  pinnedAddress: string;
  family: 4 | 6;
}

/**
 * 第 ③ 层：DNS 解析 + **复验所有解析出的 IP**。
 *
 * ⚠️ 为什么必须复验**全部**而不是第一个：
 * 攻击者可以配 `evil.com → [1.2.3.4（公网）, 127.0.0.1]`。
 * 只查第一个 IP 的实现会放行，而系统底层（getaddrinfo 的轮转）可能连到第二个。
 * 所以这里的规则是"任一解析结果非法 → 整体拒绝"。
 *
 * ⚠️ 为什么解析结果要**固定下来**（pinning）：
 * 这是防 DNS rebinding 的核心。如果解析完再用域名发请求，底层会**再解析一次**，
 * 攻击者用 TTL=0 的记录就能把那一刻的答案换成内网 IP。
 * 因此 `ResolvedTarget.pinnedAddress` 必须被连接层直接使用（见 `fetchWithPinning`）。
 */
export async function resolveAndVerify(hostname: string): Promise<ResolvedTarget> {
  // 已经是 IP 字面量：不必解析，直接复用
  const literalVersion = isIP(hostname);
  if (literalVersion !== 0) {
    if (isBlockedIp(hostname)) {
      throw new SsrfError(`禁止访问的内网地址：${hostname}`, { hostname });
    }
    return {
      hostname,
      addresses: [{ address: hostname, family: literalVersion }],
      pinnedAddress: hostname,
      family: literalVersion === 6 ? 6 : 4,
    };
  }

  let addresses: LookupAddress[];
  try {
    addresses = await withTimeout(
      dnsLookup(hostname, { all: true, verbatim: true }),
      DNS_TIMEOUT_MS,
      `DNS 解析超时：${hostname}`,
    );
  } catch (e) {
    if (e instanceof SsrfError) throw e;
    throw new SsrfError(`域名无法解析：${hostname}`, { hostname });
  }

  if (!addresses || addresses.length === 0) {
    throw new SsrfError(`域名无解析结果：${hostname}`, { hostname });
  }

  // 复验全部（任一非法即拒绝）
  for (const addr of addresses) {
    if (isBlockedIp(addr.address)) {
      throw new SsrfError(`域名解析到内网地址：${hostname} → ${addr.address}`, {
        hostname,
        address: addr.address,
      });
    }
  }

  // 优先 IPv4（IPv6 出口在部分机房不可达，且 IPv4 更常见）
  const preferred = addresses.find((a) => a.family === 4) ?? addresses[0]!;

  return {
    hostname,
    addresses,
    pinnedAddress: preferred.address,
    family: preferred.family === 6 ? 6 : 4,
  };
}

function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new SsrfError(message)), ms);
    if (typeof timer.unref === 'function') timer.unref();
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(timer);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

// ---------------------------------------------------------------- 带 pinning 的抓取

export interface FetchHopResult {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  contentType: string;
  /** 已读入内存的 body（导入资源本身就是小文件，且有大小上限） */
  body: Buffer;
}

export interface FetchOptions {
  /** 字节上限，超出即中断（边下边断） */
  maxBytes: number;
  /** 只在 body 开头需要的字节数，供魔数校验（避免为校验多读） */
  headBytes?: number;
  timeoutMs?: number;
  /** 已跟随的跳数（内部递归用） */
  redirectCount?: number;
  /** 已访问过的 URL（防重定向自环打转） */
  seen?: Set<string>;
}

export interface FetchOutcome extends FetchHopResult {
  finalUrl: string;
  pinnedAddress: string;
  /** 实际读取的字节数 */
  sizeBytes: number;
}

/**
 * 第 ④ 层：用 pinned IP 直连抓取，手动跟随重定向。
 *
 * 三个关键点：
 *  1. `maxRedirections: 0` —— 让 undici **不要**自己跟重定向。它的内部跟随会用域名重新解析，
 *     等于绕过了 pinning；我们必须每一跳都自己复验。
 *  2. `connect` 自定义 connector —— 把 TCP 目标换成 `pinnedAddress`，同时用 `servername`
 *     保留原域名（否则 HTTPS 的 SNI/证书校验会失败）。这就是标准的 "IP pinning" 做法。
 *  3. `Host` 头显式带上原域名 —— 虚拟主机站点靠它路由；缺了会拿到错误站点或 404。
 *
 * 大小控制：检查 `Content-Length` 预筛 + 流式累加时**立即中断**（边下边断），
 * 避免"先下完 2GB 再判断超限"的 DoS。
 */
export async function fetchWithPinning(
  target: ParsedTarget,
  options: FetchOptions,
): Promise<FetchOutcome> {
  const timeoutMs = options.timeoutMs ?? FETCH_TIMEOUT_MS;
  const redirectCount = options.redirectCount ?? 0;
  const seen = options.seen ?? new Set<string>();

  if (seen.has(target.url.href)) {
    throw new SsrfError('检测到重定向环路');
  }
  seen.add(target.url.href);

  // 每跳都重新解析 + 复验（攻击者可能只在第 2 跳指向内网）
  const resolved = await resolveAndVerify(target.hostname);

  const connector = buildPinningConnector(resolved);
  const agent = new Agent({
    // undici 的 `connect` 联合类型含 `Partial<BuildOptions>` 分支，与自定义 connector 签名不兼容，
    // 因此把整个 options 断言一次（运行时行为不变：undici 就是按 connector 签名调用它的）。
    connect: connector,
    headersTimeout: timeoutMs,
    bodyTimeout: timeoutMs,
  } as unknown as ConstructorParameters<typeof Agent>[0]);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  if (typeof timer.unref === 'function') timer.unref();

  try {
    /**
     * origin 用 **pinned IP**（`http://93.184.216.34:443`），路径含 query。
     * 这是 IP pinning 的落地方式：undici 直接连这个 IP，**不再做任何 DNS 解析**，
     * 从根上杜绝 DNS rebinding。
     * `Host` 头显式设回原域名，保证虚拟主机路由正确、HTTPS 的 SNI/证书校验也对得上。
     */
    const origin = `${target.url.protocol}//${formatHostForUrl(resolved.pinnedAddress)}:${target.port}`;
    const path = `${target.url.pathname}${target.url.search}`;

    const res = await request(new URL(`${origin}${path}`), {
      method: 'GET',
      headers: {
        host: target.hostname,
        'user-agent': 'vutu-asset-importer/1.0',
        accept: 'image/*,video/*,audio/*;q=0.9,*/*;q=0.1',
        // 不给压缩：避免解压炸弹，且我们要的字节数与声明字节数一致
        'accept-encoding': 'identity',
      },
      /**
       * ⚠️ undici 的 `request` **本身就不跟随重定向**（只有 `fetch` + redirect interceptor 会），
       * 3xx 会原样返回 —— 这正是"手动跟随、每跳复验"所需的行为。
       * 换句话说，"不自动重定向"在这里是 undici 的默认语义，无需任何配置项；
       * 也就不会出现"内部跟随时用域名二次解析、绕过 pinning"的风险。
       * （注：undici 7 的 `request` 若传 `maxRedirections !== 0` 会直接抛
       *   `maxRedirections is not supported, use the redirect interceptor`，
       *   因此这里既不需要、也不能设置该字段。）
       */
      headersTimeout: timeoutMs,
      bodyTimeout: timeoutMs,
      signal: controller.signal,
      dispatcher: agent,
    });

    const headers = res.headers as Record<string, string | string[] | undefined>;
    const contentType = headerValue(headers['content-type']) ?? '';

    // ---- 重定向：手动跟随，≤3 跳，每跳复验 ----
    if (res.statusCode >= 300 && res.statusCode < 400) {
      const location = headerValue(headers['location']);
      // 消费掉 body，释放 socket
      await res.body.dump().catch(() => undefined);

      if (!location) throw new SsrfError(`重定向缺少 Location 头（HTTP ${res.statusCode}）`);
      if (redirectCount >= MAX_REDIRECTS) {
        throw new SsrfError(`重定向超过 ${MAX_REDIRECTS} 跳`);
      }

      // 相对跳转要基于当前 URL 解析
      const nextUrl = new URL(location, target.url.href);
      const nextTarget = validateUrlSyntax(nextUrl.href); // ①② 重新校验

      log.debug(
        { from: target.url.href, to: nextUrl.href, hop: redirectCount + 1 },
        'import-url redirect hop',
      );

      return fetchWithPinning(nextTarget, {
        ...options,
        redirectCount: redirectCount + 1,
        seen,
      });
    }

    if (res.statusCode < 200 || res.statusCode >= 300) {
      await res.body.dump().catch(() => undefined);
      throw new SsrfError(`上游返回 HTTP ${res.statusCode}`, { status: res.statusCode });
    }

    // ---- Content-Length 预筛（早失败，省流量）----
    const declaredLength = Number.parseInt(headerValue(headers['content-length']) ?? '', 10);
    if (Number.isFinite(declaredLength) && declaredLength > options.maxBytes) {
      await res.body.dump().catch(() => undefined);
      throw new SsrfError(
        `文件超出大小限制：声明 ${declaredLength} 字节，上限 ${options.maxBytes} 字节`,
        { declaredLength, maxBytes: options.maxBytes },
      );
    }

    // ---- 流式读取 + 边下边断 ----
    const chunks: Buffer[] = [];
    let total = 0;

    for await (const chunk of res.body) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
      total += buf.length;

      if (total > options.maxBytes) {
        // 立即中断：不把剩余内容读完（这正是"边下边断"的意义）
        res.body.destroy();
        throw new SsrfError(`文件超出大小限制：已读 ${total} 字节，上限 ${options.maxBytes} 字节`, {
          readBytes: total,
          maxBytes: options.maxBytes,
        });
      }

      chunks.push(buf);
    }

    const body = Buffer.concat(chunks);

    return {
      status: res.statusCode,
      headers,
      contentType,
      body,
      finalUrl: target.url.href,
      pinnedAddress: resolved.pinnedAddress,
      sizeBytes: body.length,
    };
  } catch (e) {
    if (e instanceof SsrfError) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    if (controller.signal.aborted || /abort/i.test(msg)) {
      throw new SsrfError(`拉取超时（${timeoutMs}ms）`);
    }
    throw new SsrfError(`拉取失败：${msg}`);
  } finally {
    clearTimeout(timer);
    // 关闭 agent，避免连接池泄漏（每个请求一个独立 agent，因为 pinning 目标不同）
    void agent.close().catch(() => undefined);
  }
}

/**
 * 自定义 connector 的形状（undici `buildConnector.connector`）。
 *
 * 这里**本地声明**而不是 import undici 的 `buildConnector` 命名空间类型：
 *  - undici 的 `Agent.Options.connect` 联合类型是 `Partial<BuildOptions> | connector`，
 *    直接赋值自定义函数会被 TS 判为与 `Partial<BuildOptions>` 分支不兼容而报错；
 *  - 本地声明这个最小形状后，用 `satisfies` 校验、用一次 `as` 落到 Agent 选项上即可，
 *    运行时行为完全不变（undici 就是这么调用 connector 的）。
 */
type PinningConnector = (
  options: { hostname: string; servername?: string; protocol?: string; port?: string },
  callback: (err: Error | null, socket: unknown) => void,
) => void;

function buildPinningConnector(resolved: ResolvedTarget): PinningConnector {
  return (options, callback) => {
    const isTls = (options.protocol ?? '').startsWith('https');

    if (isTls) {
      void import('node:tls').then(({ connect: tlsConnect }) => {
        const socket = tlsConnect({
          host: resolved.pinnedAddress, // ← 固定 IP，杜绝 DNS rebinding
          port: Number.parseInt(options.port ?? '443', 10) || 443,
          servername: options.servername ?? resolved.hostname, // ← 原域名，保证证书/SNI 正确
        });
        socket.once('secureConnect', () => callback(null, socket));
        socket.once('error', (err: Error) => callback(err, null));
      });
      return;
    }

    void import('node:net').then(({ connect }) => {
      const socket = connect({
        host: resolved.pinnedAddress, // ← 固定 IP
        port: Number.parseInt(options.port ?? '80', 10) || 80,
      });
      socket.once('connect', () => callback(null, socket));
      socket.once('error', (err: Error) => callback(err, null));
    });
  };
}

function formatHostForUrl(ip: string): string {
  return isIP(ip) === 6 ? `[${ip}]` : ip;
}

function headerValue(v: string | string[] | undefined): string | null {
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}

/**
 * 一站式：从原始 URL 字符串到抓取结果，包含全部四层防护。
 * 任何一层失败都抛 `SsrfError`，调用方统一转成 `err.unfetchableUrl(reason)`（422）。
 */
export async function safeFetch(
  rawUrl: string,
  options: { maxBytes: number; timeoutMs?: number },
): Promise<FetchOutcome> {
  const target = validateUrlSyntax(rawUrl); // ①②
  return fetchWithPinning(target, options); // ③④（每跳复验）
}
