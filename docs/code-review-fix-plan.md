
# 代码审查问题修复方案

> 制定日期：2026-09-30
> 范围：`server/`（Fastify 后端）、`vutu-web/`（生图工作台 SPA）、`ai-cloner/`（Next.js 营销站 + 工作台）、部署与 CI
> 依据：2026-09-30 全量代码审查（后端安全 / 资金链路 / 前端 / 部署 CI 四条线）
> 状态：**待执行**（本文件仅为方案，未修改任何业务代码）

---

## 0. 原则与分批

修复顺序遵循**依赖倒置 + 风险降级**：

| 批次 | 内容 | 理由 |
|---|---|---|
| **批次 0** | 仓库完整性（`.gitignore` 误排除源码） | **前置条件**。仓库不完整时，任何基于 `git clone` 的 CI / 评审都不可信 |
| **批次 1** | 安全 P0（SSRF 绕过） | 元数据凭据泄露风险，最高优先 |
| **批次 2** | 前端可用性（4 个相互叠加的缺陷） | 叠加后等于「刷新一次就再也看不到任何结果图」 |
| **批次 3** | 资金链路（孤儿任务） | 直接卡用户的钱 |
| **批次 4** | CI / 部署 / 容器硬化 | 防止同类问题再次静默通过 |

**每批次独立提交、独立验证**，不混在一个 PR 里。

**贯穿性原则**：本仓库最系统性的问题是「门禁存在却不生效」。因此每一批修复都必须**同时补上让该缺陷能被再次发现的机制**（回归测试或 CI 守卫），否则只是把症状抹平。

---

## 批次 0：仓库完整性（前置，必须先做）

### 0.1 `.gitignore` 的 `*token*` 把认证源码挡在版本库外

**根因**：[.gitignore:18](../.gitignore#L18) 的 `*token*` 规则本意是防本地 JWT 文件（`_token.txt`、`_rtoken.txt`），但它同时匹配了 4 个**必须入库的源码文件**：

| 文件 | 引用方 |
|---|---|
| `server/src/modules/auth/tokens.ts` | service.ts:47、guard.ts:19 |
| `server/src/modules/auth/verified-token.ts` | service.ts:28 |
| `server/src/modules/auth/tokens.test.ts` | — |
| `vutu-web/src/styles/tokens.css` | vutu-web/src/main.tsx:4 |

**影响**：`git clone` 得到的仓库缺少核心认证模块，`tsc` / `vite build` 因模块缺失直接失败。生产之所以正常，是因为部署走 SFTP 脚本绕过了 git。

**改动 1 — 收窄规则**（`.gitignore`）：

```gitignore
# 原：*token*   ← 会误伤 server/src/modules/auth/tokens.ts
*_token.*
*_rtoken.*
*.token

# 环境变量模板应入库（仅占位符，无真值）；.env 本体继续忽略
!.env.example
```

**改动 2 — 补入文件**：

```bash
git add -f server/src/modules/auth/tokens.ts \
            server/src/modules/auth/tokens.test.ts \
            server/src/modules/auth/verified-token.ts \
            vutu-web/src/styles/tokens.css \
            server/.env.example
```

> `server/.env.example` 同理：它被 `.env*` 规则挡掉，而 deploy.sh:15-18 明确要求 `cp .env.example .env`。已核对该文件全部为 `CHANGE_ME` / 示例值，**无真实密钥**，可安全入库。

**改动 3 — CI 守卫（防止复发）**

在 `.github/workflows/ci.yml` 的 `quality` job 末尾新增：

```yaml
- name: Guard - no source file is git-ignored
  run: |
    # src/ 下出现被忽略的文件 = .gitignore 规则误伤，必须显式白名单
    IGNORED=$(git ls-files --others --ignored --exclude-standard -- 'server/src/**' 'vutu-web/src/**' 'ai-cloner/src/**' || true)
    if [ -n "$IGNORED" ]; then
      echo "::error::源码被 .gitignore 误排除，clone 后将无法构建："
      echo "$IGNORED"
      exit 1
    fi
```

**验证**：

```bash
# 这 5 个文件现在应被 git 跟踪
git ls-files server/src/modules/auth/tokens.ts vutu-web/src/styles/tokens.css server/.env.example
# 守卫本身应通过（输出为空）
git ls-files --others --ignored --exclude-standard -- 'server/src/**'
```

**风险**：低。注意 `git add -f` 后用 `git diff --cached --stat` 复核，确认只有 5 个文件——**绝不能连带把 `_token.txt` 等真实 JWT 加进去**。

---

## 批次 1：安全 P0

### 1.1 SSRF 防护被十六进制 IPv4-mapped IPv6 绕过

**根因**：ssrf.ts:108-111

```ts
const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(lower);  // 只认点分十进制
```

正则只匹配点分十进制形式。十六进制写法（`URL` 会自动规范化）直接穿透：

| 输入 | 现状 | 实际指向 |
|---|---|---|
| `::ffff:127.0.0.1` | 已拦截 | — |
| `::ffff:7f00:1` | **放行** | 127.0.0.1 |
| `::ffff:a9fe:a9fe` | **放行** | **169.254.169.254（云元数据）** |
| `::ffff:c0a8:101` | **放行** | 192.168.1.1 |
| `0:0:0:0:0:ffff:127.0.0.1` | **放行**（规范化为 `::ffff:7f00:1`） | 127.0.0.1 |

**已实测确认**：本地起 HTTP 服务作为「内网目标」，调用真实 `safeFetch`（URL 为 `http://[::ffff:7f00:1]:18098/latest/meta-data/`）四层防护全过，返回 200 并读出内网响应体；裸 `net.connect`（host 为 `::ffff:7f00:1`）确认内核映射到 127.0.0.1。

这是 CONTRACT.md §13 #21 的明文验收项，当前不达标。

**方案选择**：推荐引入 `ipaddr.js`，而非继续手写正则 / 位运算——**手写 IPv6 归一化本身就是本次事故的成因**，再手写一次只是把风险推后。

`ipaddr.js@2.5.0` 目前已在 `node_modules` 中（传递依赖），但**必须提为直接依赖**，不能依赖传递依赖的提升（hoisting 行为无保证）。

```bash
cd server && npm i ipaddr.js@^2.5.0
```

**改动** — 重写 ssrf.ts 的 `isBlockedIpv6`：

```ts
import ipaddr from 'ipaddr.js';

function isBlockedIpv6(ip: string): boolean {
  let addr: ipaddr.IPv6;
  try {
    addr = ipaddr.parse(ip);
  } catch {
    return true;                     // 解析不了 → 宁可误杀
  }
  if (addr.kind() !== 'ipv6') return true;

  // IPv4-mapped / IPv4-compatible：拆出内嵌 IPv4 再判
  // （::ffff:7f00:1 这类十六进制写法正是原实现的漏网之处）
  const asV4 = addr.toIPv4Address();
  if (asV4.kind() === 'ipv4') return isBlockedIpv4(asV4.toString());

  switch (addr.range()) {
    case 'unspecified':   // ::
    case 'loopback':      // ::1
    case 'linkLocal':     // fe80::/10
    case 'uniqueLocal':   // fc00::/7
    case 'multicast':     // ff00::/8
    case 'reserved':      // 6to4 / Teredo / 文档段等由库判定
    case 'rfc6145':       // ::ffff:0:0/96
    case 'rfc6052':       // 64:ff9b::/96 NAT64
    case '6to4':          // 2002::/16
      return true;
    default:
      return addr.range() !== 'unicast';   // 只放行真正的全球单播
  }
}
```

> ⚠️ `switch` 分支名需对照 `ipaddr.js@2` 实际 `range()` 取值集合核对后定稿（`ipv4Mapped` / `rfc6145` / `rfc6052` 等常量在不同版本有差异）。**定稿前必须跑通下方回归测试，以测试为准。**

**改动 2 — 回归测试**（ssrf.test.ts 补参数化用例）：

```ts
it.each([
  ['::ffff:127.0.0.1', true],
  ['::ffff:7f00:1', true],            // 十六进制 127.0.0.1 —— 本次漏洞
  ['::ffff:a9fe:a9fe', true],         // 十六进制 169.254.169.254 —— 云元数据
  ['::ffff:c0a8:101', true],          // 十六进制 192.168.1.1
  ['::ffff:10.0.0.1', true],          // 点分形式（回归）
  ['0:0:0:0:0:ffff:127.0.0.1', true], // 全展开形式
  ['::1', true], ['::', true],
  ['fe80::1', true], ['fc00::1', true], ['ff02::1', true],
  ['2606:4700:4700::1111', false],    // 合法公网 IPv6 —— 必须放行
])('%s → blocked=%s', (ip, expected) => {
  expect(isBlockedIp(ip)).toBe(expected);
});
```

同时补 `validateUrlSyntax` 层的 URL 用例（`http://[::ffff:7f00:1]/` 等）。

**验证**：`npm test`（当前 781 例）+ 新增用例全绿。

**风险**：低—中。拒绝面会**变严**（误杀部分边缘 IPv6 写法），这是预期行为——安全边界宁可误杀。

### 1.2 `trustProxy: true` 使 `req.ip` 可被客户端伪造

**根因**：两处叠加。

- `core/http.ts:60`：`trustProxy: true` → Fastify 信任**整条** XFF 链，取**最左**值作为 `req.ip`；
- `deploy/nginx-ai.vutu.cc.conf:29`：`proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for` —— nginx 把客户端**自带的** XFF 值追加到真实 IP **之前**，而非覆盖。

结果：客户端发 `X-Forwarded-For: 1.2.3.4`，nginx 产出 `1.2.3.4, <真实IP>`，Fastify 取最左 → `req.ip` 变成 1.2.3.4。**已实测确认。**

受影响：全局限流的 IP 键（未登录）、注册 IP 限流 `hitRegisterIp`（10/min）、审计日志 IP。

**改动（两端都改，纵深防御）**：

1. nginx **覆写**而非追加（`/api/` 与 `/` 两个 location 都要）：

   ```nginx
   proxy_set_header X-Real-IP       $remote_addr;
   proxy_set_header X-Forwarded-For $remote_addr;   # 原 $proxy_add_x_forwarded_for
   ```

2. Fastify 收紧信任跳数：

   ```ts
   trustProxy: 1,   // 仅信任紧邻一跳（nginx）。原为 true
   ```

> nginx 是边缘（443 直连，无前置 CDN / LB），故 `$remote_addr` 即真实客户端 IP。

**验证**：带 `X-Forwarded-For: 1.2.3.4` 请求生产 `/api/v1/health`，服务端日志里的来源 IP 应为真实 IP 而非 1.2.3.4。

**风险**：低。**但需先确认 `ai.vutu.cc` 前面没有 CDN / 负载均衡**——若有，`$remote_addr` 会变成 CDN 节点 IP，需改用 `real_ip` 模块。

### 1.3 限流键恒定，全体用户共用一个桶

**根因**：core/http.ts:94 用 `auth.slice(7, 27)`（JWT 前 20 字符）构造桶键。

JWT 第一段是固定 header，HS256 下恒为 `eyJhbGciOiJIUzI1NiIs`。**已实测**：两个不同用户（不同 `sub` / `plan`）签出的 token 前 20 字符完全相同，限流键均为 `u:eyJhbGciOiJIUzI1NiIs`。

后果：所谓「用户维度限流」实为**全站共享 100 req/min**——任一用户刷满即让所有人 429（低成本 DoS），且单用户限流形同虚设。

**改动 — 「IP 兜底 + 用户分桶」双维度**：

单靠 `userId` 不够：未登录攻击者可以伪造海量 `sub` 造出无限个桶。所以必须**同时保留一条不可伪造的 IP 维度**。

```ts
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 只解码不验签：仅用于「分到哪个桶」，不参与任何授权判断 */
function extractSub(token: string): string | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(
      Buffer.from(parts[1] as string, 'base64url').toString(),
    ) as { sub?: unknown };
    return typeof payload.sub === 'string' && UUID_RE.test(payload.sub) ? payload.sub : null;
  } catch {
    return null;
  }
}

keyGenerator: (req) => {
  const auth = req.headers.authorization;
  const sub = auth?.startsWith('Bearer ') ? extractSub(auth.slice(7)) : null;
  return sub ? 'u:' + sub : 'ip:' + req.ip;
},
```

**设计说明（重要）**：`extractSub` **不验签**，这是可接受的——它只决定分桶，不参与授权；攻击者伪造 `sub` 只能改变自己的桶标识，**无法提权**。而海量伪造 token 的洪泛由 `ip:` 分支兜住。**因此 1.2 必须先于 1.3 上线**（`req.ip` 可信之后，IP 兜底才成立）。

**验证**：两个不同 JWT 请求后，检查 Redis 应出现两个不同的 `u:<uuid>` 键。

**风险**：中。强依赖 1.2 先落地。

---

## 批次 2：前端可用性（vutu-web）

四个缺陷相互叠加，**合并效果 = 刷新页面后结果流再也不显示任何图**。必须一起修。

### 2.1 批量生成把整个列表替换成同一条任务（P0）

vutu-web/src/App.tsx:198

```tsx
prev.map((x) => (x.id === tempId ? { ...task, prompt: cfg.prompt } : task))
//                                                     ^^^^ 应为 x
```

`map` 回退分支返回 `task` 而非 `x`。首个请求返回后，列表中**其余所有行（含全部历史任务）**被替换成同一条真实任务（React key 重复，SSE 会为重复 id 反复建流）。

同文件 **489 行单条提交写法是正确的 `: x`**，可确认是笔误。

**修法**：改为 `: x`。**一个字符。**

### 2.2 刷新后历史任务永久停在灰骨架（P1）

成因三连：

1. 列表接口 `serializeTaskListRow` **不返回 `results`**；
2. SSE effect 对终态行直接 `continue`（App.tsx:352）；
3. `api.task()` 详情**只在 SSE error 回调里调用一次**。

于是：任何 `succeeded` 行既不建流也无人 hydrate → ResultFeed 的 `task.results?.[0]`（ResultFeed.tsx:81）恒 `undefined` → 永久骨架；反推 / 发布按钮（依赖 `image && status==='succeeded'`）永不渲染。

**修法**：初始加载后，对**终态且无 results** 的行做一次详情 hydrate（复用已有 `waitForTaskResults`，它本就是干这个的），配合 2.4 的 URL 签发。

### 2.3 vutu-web 的 SSE 恒 401（P1）

`lib/api.ts:663` 用 `EventSource`，该 API **无法携带 `Authorization` 头**；而服务端 `auth/guard.ts:41` 只读 `Authorization: Bearer` → 连接必被拒。

error 分支只做一次 `api.task()`；若任务仍 running，`streamsRef` 记录不删除且 effect 无轮询 → **状态 / 进度永久冻结在 0%**。

**修法**：改用 `fetch` + `ReadableStream` 解析 SSE 流。同仓库 `ai-cloner/src/lib/api/client.ts:158-172` 已有正确实现，**直接对齐该模式**，不新造轮子。

### 2.4 `results[].url` 是类型谎言（P1）

后端详情 `results` 只返回 `assetId`（publicId）/ `mimeType` / `width` / `height` / `durationSec` / `sizeBytes`（service.ts:369-375），**没有 `url`**；`url` 只存在于 SSE 终态事件（workers/index.ts:291）。

而前端 `lib/api.ts:322` 把 `url` 声明为必填，并直接用于 `img src` 与下载链接（ResultFeed.tsx:91 与 :189）。类型系统把契约缺口掩盖了。

**连带问题**：`waitForTaskResults` 只轮询 `api.task()`，而详情没有 url → **即使 2.2 补上 hydrate，也拿不到图片地址**。

**修法（不改后端契约，走已有端点）**：

`GET /v1/assets/:id` 已返回 `viewUrl`（assets/routes.ts:159，前端 `lib/api.ts:476` 已封装 `api.asset()`）。hydrate 时按 `assetId` 逐个签发，用 `Map` 做 TTL 缓存——对齐 `ai-cloner/TaskListPane.tsx:304-322` 的 `urlCache` 做法。

同时**修正类型**：`url` 改为可选，或拆出两个类型（`TaskResultItem` 含 url / `TaskDetailResultItem` 不含 url），避免再次用类型撒谎掩盖契约缺口。

> 备选（更优但改动更大）：后端新增批量签发端点 `POST /v1/assets/view-urls`（全加法，不动冻结签名）——20 条任务从 20 次请求降到 1 次。**建议先做前端侧，后续视性能实测再决定。**

**验证**：`npm run build && npm run dev`，登录后提交一个任务，确认：① 图正常显示；② **F5 刷新后历史任务的图仍在**；③ 跑一次批量，列表中其他任务不被冲掉。

---

## 批次 3：资金链路

### 3.1 `queued` 任务成为资金孤儿（P1）

成因链：

- service.ts:217-277：事务内扣费 + 建任务，状态 `queued`；
- service.ts:280：`enqueueGeneration` 在**事务提交之后、try 之外**调用。它抛错（Redis 抖动 / 队列不可达）时，钱已扣、任务永久 `queued`、并发占位不释放；
- cron/index.ts:114：超时扫描**只查 `status = 'running'`** → `queued` 不在范围；
- `concurrency.rebuild()` 是**死代码**（全仓零调用），且它只重建计数器、**不退款**；
- `retry` 接口对 `queued` 直接拒绝（service.ts:463）。

用户只能手动点「取消」才能拿回钱。

**修法（两道）**：

1. **兜底扫描**——`scanTimeouts` 的 where 扩展为：

   ```ts
   where: {
     status: { in: ['queued', 'running'] },
     OR: [
       { startedAt: { lt: deadline } },
       { startedAt: null, createdAt: { lt: deadline } },
     ],
   }
   ```

   并按实际状态选 `toStatus`（建议 `queued` → `timeout`，与既有语义一致）。**注意 `take: 200` 的分页**要配合「只捞真超时的」条件，避免每 5 分钟重复捞同一批。

2. **入队失败补偿**——在 service.ts 既有 catch 中增加分支：若失败原因是入队，则调用 `refundTaskTerminal` 把任务置终态并退款，而不是只释放并发占位后重新抛出。

**回归测试**（integration，验证钱不丢）：

- 构造「事务提交成功但入队失败」的故障注入（mock `enqueueGeneration` 抛错）；
- 断言：任务最终为终态 + `credit_ledger` 有一条 `refund:<taskId>` 流水 + 余额回到提交前。

**风险**：中—高（涉及资金）。必须跑通集成测试（**本地无 docker**，需服务器或 CI）；灰度期间盯 `ledger-reconcile` cron（03:00）无 mismatch。

---

## 批次 4：CI / 部署 / 容器硬化

### 4.1 CI 三处空转（P1）

| # | 位置 | 问题 | 修法 |
|---|---|---|---|
| a | ci.yml:42 | `npx vitest run tests/contract` 走默认配置，`include` 不含 `tests/contract` → **匹配 0 个测试**；再被 `\|\| true` 吞掉 | 改 `npm run test:contract` 并**去掉 \|\| true** |
| b | ci.yml:106 | `defaults.run.working-directory: server` 生效于所有 run 步骤，`docker build ./server` 解析为 `server/server` → 必然失败 | 改 `docker build -t vutu-api:ci .`（或给该 step 设 `working-directory: .`） |
| c | ai-cloner/.github/workflows/ci.yml | 触发分支写 `master`，仓库已是单 `main` → **永不触发**；且 GitHub 只执行**仓库根**的 workflow，子目录文件是死文件；另 `actions/checkout@v7` / `setup-node@v7` 大版本不存在 | 迁到根目录 + 改 `main` + 改 `v4`/`v5` + 设 `working-directory: ai-cloner` + `cache-dependency-path` |

**验证**：改完在 PR 上实跑，确认三个 job 均真绿且**有测试计数**（不是「no test files」）。

### 4.2 Dockerfile `test` 阶段缺 devDependencies（P1）

Dockerfile:20 在 builder 阶段执行 `npm prune --omit=dev`；Dockerfile:23 的 `FROM builder AS test` 继承这份**已裁剪**的 `node_modules`，但 Dockerfile:30 的 CMD 要跑 `npx vitest`——而 `vitest` / `nock` / `@vitest/coverage-v8` 全在 devDependencies。注释却写「含 devDependencies」，与实际相反。

后果：`docker compose run --rm test` / run-tests.sh:28 时容器内无 vitest，`npx` 会**联网现拉**不受 lock 约束的版本（断网即失败），测试依赖与 CI 不一致。

**修法**——把 test 阶段改为独立安装（意图更清晰）：

```dockerfile
FROM node:22-alpine AS builder
... npm ci / prisma generate / build ...          # 不 prune

FROM builder AS test                               # 继承完整 devDependencies
COPY vitest.*.config.ts ./
COPY tests ./tests
CMD ["npx","vitest","run","--config","vitest.integration.config.ts"]

FROM builder AS prod-deps
RUN npm prune --omit=dev && npm install --no-save prisma@6 tsx@4
# 原有 runner 阶段改 FROM prod-deps
```

**验证**：`docker compose --profile test build test` 后，在容器内执行 `npx vitest --version` 应直接可用（不联网）。

### 4.3 容器硬化（P2）

- **无 `.dockerignore`**：`server/.dockerignore` 与根 `.dockerignore` 均不存在，build context 是 `server/` → 部署机上的真实 `.env`（`JWT_SECRET` / `PG_PASSWORD` / `LK_API_KEYS`）、`node_modules/`、`dist/`、`backup/` 全部进入 build context 与 BuildKit 缓存。
  **修法**：新增 `server/.dockerignore`，至少忽略 `.env*`、`node_modules`、`dist`、`backup`、`tests`、`*.log`。
- **runner 以 root 运行**：Dockerfile:33-51 无 `USER` 指令。
  **修法**：新增非 root 用户并切换（注意 prisma / migrate 写权限）。**需实际验证**，若引入权限问题可回退。

### 4.4 部署无原子性与回滚（P1 / P2）

- deploy.sh:22：api 与 worker 共用 `image: vutu-api:latest`，`build` 直接覆盖同名 tag，旧镜像变 dangling，无版本标记、无 `docker save`；
- deploy.sh:47-58：`up -d api worker` 后健康检查失败只 `echo WARN`，**脚本仍以 0 退出**，无 `exit 1`、无回滚；
- setup-nginx.sh:20-28：先把新配置 `cp` 到 sites-enabled，**再** `nginx -t`；`set -e` 下校验失败即退出，**坏配置留在原地**，第 17 行的 `.bak` 从不使用。此后任何 reload（certbot 续期 / 重启）都会失败。

**修法**：

1. nginx 改成**先验证后启用**：临时文件校验 → 通过才覆盖 → 失败自动还原 `.bak`（对照 `vutu-web/deploy/deploy.py:154-158` 已有的正确做法）；
2. deploy.sh 健康检查超时改为 `exit 1`；
3. 镜像按 commit 短 SHA 打 tag，并 `docker save` 保留上一版。

### 4.5 minio 健康检查疑似失效（待生产确认）

docker-compose.yml:145 与 docker-compose.test.yml 用 `curl` 探活，但 MinIO 官方镜像已移除 `curl`（[minio/minio#18371](https://github.com/minio/minio/issues/18371)）。

若成立，minio 永远 `unhealthy`，而 api / worker / minio-init 依赖 `condition: service_healthy` → deploy.sh:25 首次部署即卡死。

**但与生产现状矛盾**：线上 api 健康（uptime 27h+），历史记录显示「5 容器全 healthy」。**本机因 clash 代理屏蔽 SSH（直连超时、跳板机私钥权限被拒），未能取到实证。**

**处理方式**——先在服务器确认，再决定是否改：

```bash
docker inspect vutu-minio --format '{{.State.Health.Status}}'
docker exec vutu-minio sh -c 'command -v curl || echo NO_CURL'
```

若确无 `curl`，改用镜像自带的 `mc`：

```yaml
test: ["CMD-SHELL", "mc ready local || exit 1"]
```

（`minio-init` 已使用 `mc`，证明镜像内有该二进制。）

**顺带**：docker-compose.yml:132,190 用 `quay.io/minio/minio:latest` 未固定 tag，上游仓库已归档，重建即版本漂移。建议固定到具体 digest。

---

## 测试策略

| 层 | 现状 | 本次补充 |
|---|---|---|
| 单元 `src/**/*.test.ts` | 781 例全绿 | SSRF IPv6 参数化用例；限流 `extractSub` 用例 |
| 契约 `tests/contract` | 57 例通过，但 **CI 从未真正执行** | 修好 CI 后自然生效 |
| 集成 `tests/integration` | 本地无 docker，无法运行 | 孤儿任务退款回归测试 |
| CI 守卫 | — | 新增「src 下无被忽略文件」守卫 |

**已知盲区**：`vutu-web` 目前**没有任何测试**（无 test script、无 testing library）。本次 4 个前端缺陷全部靠人工发现。建议至少为 2.1（map 笔误）与 2.4（契约对齐）引入 Vitest + Testing Library，否则同类笔误必然复发。

---

## 风险与回滚

| 批次 | 风险 | 回滚 |
|---|---|---|
| 0 | 低（仅 .gitignore + add） | `git revert` |
| 1.1 | 低—中（拒绝面变严，可能误杀边缘 IPv6） | `git revert`；误杀反馈走 issue |
| 1.2 | 低（需确认无 CDN 前置） | `git revert` + 改回 nginx |
| 1.3 | 中（强依赖 1.2 先落地） | 先只上 1.2，观察后再上 1.3 |
| 2 | 低（前端，无数据风险） | `git revert` |
| 3 | **中—高（资金）** | 必须先在服务器 test profile 跑通集成测试；灰度盯 `ledger-reconcile` 无 mismatch |
| 4.2 | 中（镜像层重组） | 保留旧 tag 可回退 |
| 4.3 / 4.4 | 中（部署路径） | 需服务器实测 |

---

## 待拍板项

1. **是否引入 `ipaddr.js` 直接依赖？** 推荐引入（批次 1.1）。备选：手写 `expandIpv6` 归一化——但需承认手写正是本次事故成因，风险更高。
2. **`server/.env.example` 是否入库？** 本方案默认「入库」（仅占位符）。若你担心，改用 `.env.template` 之类避开 `.env*` 规则。
3. **公开仓库的 IP 收敛**（P2，8+ 文件硬编码 `13.229.183.21` 与私钥路径）。属既有决策，本次不动；建议后续统一改为环境变量。
4. **vutu-web 是否引入测试框架**？不引入则前端缺陷仍靠人工发现。
5. **限流阈值**：修复后不再全站共享 100/min，但每用户 100/min 是否合理需按业务定。

---

## 建议执行顺序

```
批次 0（仓库完整性，单独提交并推送）   ← 必须最先，否则后续验证不可信
  ↓
批次 1.2 → 1.3（限流必须按序，1.3 依赖 1.2）
  + 批次 1.1（SSRF，可并行）
  ↓
批次 2（前端四处一起改，一次验证）
  ↓
批次 3（资金，需服务器环境验证后再上生产）
  ↓
批次 4（CI / 部署 / 硬化）
```

**预计改动规模**：批次 0 约 7 个文件；批次 1 约 4 个文件 + 1 个新依赖；批次 2 约 4 个文件；批次 3 约 2 个文件 + 1 个新测试；批次 4 约 8 个文件。

