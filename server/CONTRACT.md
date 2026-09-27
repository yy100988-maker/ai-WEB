# Vutu 后端 —— 模块契约（给并行开发者/子代理）

> 本文件是**冻结契约**。所有模块必须按此对接，禁止修改 `src/core/**` 的既有导出签名。
> 需求源：`docs/backend-prd.md` v0.5、`docs/backend-detailed-design.md` v0.4。

## 修订记录（Revision Log）

### R1 · 2026-09-23 · xiaoye-adoption F1-F5

依据：`docs/xiaoye-adoption-design.md`（决议 D1 扣积分 / D2 本期 A+B+C / D3 广场默认自动通过）。
**全部为加法扩展，不改动任何既有导出签名。**

| 位置 | 变更 |
|---|---|
| `core/types.ts` | `LEDGER_TYPES` += `'service_deduct'`（LLM 服务扣费，delta<0；仅扩大 union，无 exhaustive 消费方） |
| `billing/ledger.ts` | `LedgerApi` += `spend({ userId, type, amount, idempotencyKey, note?, tx? }) => { balanceAfter }`：P2002 on `(userId, idempotencyKey)` 重放返回原结果；`balance >= amount` 条件扣减，严格保持 `余额 = SUM(delta)` |
| 既有 RouteModule 内加注册（`main.ts` 挂载清单零改动） | `POST /v1/prompts/optimize`、`POST /v1/prompts/reverse`（prompts）；`POST /v1/billing/redeem`、`POST|GET /v1/admin/redeem-keys`（billing）；`POST /v1/prompt-library`、`DELETE /v1/prompt-library/:id`、`GET /v1/prompt-library/:id/image`（prompts）；`GET /v1/admin/prompt-posts`、`POST /v1/admin/prompt-posts/:id/approve|reject`（admin） |
| `tasks` | create body 可选 `batchId`（`^b_[A-Za-z0-9_-]{6,40}$`）；`serializeTaskListRow` += `prompt`/`params`/`batchId`（向后兼容的新增字段，根治列表缺字段导致的逐行 hydrate） |
| schema / migrations | `prompt_posts` += `status`/`created_by`/`reject_reason`；`tasks` += `batch_id` + `(user_id, batch_id)` 索引；新表 `redeem_keys` |
| 新 env（**模块内解析，不入 core/config**） | `PROMPT_OPTIMIZE_CREDITS=1`、`PROMPT_REVERSE_CREDITS=2`、`PROMPT_OPTIMIZE_PER_MIN=10`、`PROMPT_OPTIMIZE_PER_DAY=100`、`PROMPT_REVERSE_PER_MIN=6`、`PROMPT_REVERSE_PER_DAY=60`、`PROMPT_AUTO_APPROVE=true`、`LK_CHAT_MODEL`（真实模式必填，fail-fast） |
| 新共享件 | `src/modules/providers/chat.ts`：`chatOnce()`（`/v1/chat/completions` OpenAI 格式 —— 实测端点，docs/lk888-capabilities.md §3.2；MOCK_PROVIDER 返回样例零上游；同时是 moderation L2 的 Phase 2 替换入口） |

以下 §0 起为原始冻结内容，涉及上述条目处按修订后语义理解。

## 0. 工程约定

- 语言：TypeScript 5 strict（`noUncheckedIndexedAccess: true`），ESM（`"type": "module"`）。
- **所有相对导入必须带 `.js` 后缀**（如 `import { err } from '../core/errors.js'`），NodeNext 运行要求。
- 路径别名 `@/*` → `src/*`（tsconfig + vitest 已配）。
- 禁止 `any`；用 `unknown` + 收窄。
- 中文注释，代码标识符英文。
- 每个模块自带 `*.test.ts` 单元测试（Vitest），与源码同目录。

## 1. 已冻结的核心模块

| 文件 | 导出 | 说明 |
|---|---|---|
| `src/core/types.ts` | `Capability` `TaskStatus` `LedgerType` `BillingMethod` `ModelDescriptor` `GenerationRequest` `GenerationProvider` `PollResult` `QuoteResult` `DiscountLine` `Page<T>` `Locale` `parseAcceptLanguage` `isTerminal` `canTransition` `CAPABILITY_KIND` `KIND_TO_CAPABILITIES` `LOCALE_TIMEZONE` | 全部领域类型 |
| `src/core/errors.ts` | `AppError` `err.*` 构造器 `messageFor` `ERROR_STATUS` | 统一错误。**业务一律 `throw err.xxx()`** |
| `src/core/config.ts` | `getConfig()` `loadConfig()` `maskSecret` `STORAGE_PREFIX` | 环境变量 |
| `src/core/db.ts` | `db()` `transaction()` `Prisma` 类型 | Prisma 单例 |
| `src/core/redis.ts` | `redis()` `createRedis()` `REDIS_KEYS` `acquireCronLock()` | Redis |
| `src/core/storage.ts` | `presignPut/presignView/presignDelivery` `putObject` `getObjectBuffer` `headObject` `deleteObject` `outputKey` `uploadKey` `sanitizeFilename` | 三类 URL 三权分立 |
| `src/core/ids.ts` | `newPublicId('user'\|'task'\|'asset'\|'order'\|'checkin')` `newRequestId()` `ANONYMOUS_USER_ID` | 对外 ID |
| `src/core/crypto.ts` | `sha256` `idempotencyHash` `hmacSha256` `randomToken` `safeEqual` `canonicalJson` `specHashOf` `encryptSecret` `decryptSecret` | 哈希/加密 |
| `src/core/pricing-math.ts` | `costUnitsToCredits` `perCallCostUnits` `perSecondCostUnits` `perTokenCostUnits` `applyDiscounts` `sortDiscounts` `marginRate` `estimateVideoOutputTokens` `CREDIT_PACKS` `DEFAULT_PRICING` | **定价纯函数（唯一真源）** |
| `src/core/logger.ts` | `logger()` `childLogger()` `maskEmail` `maskPhone` `digest` | 日志 + 脱敏 |
| `src/core/http.ts` | `buildApp({routes})` `ok(req,data)` `paged(req,items,next)` `requireUserId(req)` `RouteModule` | Fastify 装配 |

## 2. 响应契约（详细设计 §2.1）

成功：`200/201` + `{ ok: true, data: {...}, requestId }`
失败：对应 HTTP 码 + `{ ok:false, error:{ code, message, details? }, requestId }`

路由里直接用 `return ok(req, payload)` / `paged(req, items, nextCursor)`；
错误直接 `throw err.notFound()`，由 `http.ts` 统一序列化并本地化（`req.locale`）。

分页统一 `?cursor=&limit=`（默认 20，最大 100）→ `{ items, nextCursor }`。
Cursor 用 base64url 编码的 `{createdAt ISO}|{id}`，倒序翻页。

## 3. 认证上下文

`src/modules/auth/guard.ts` 提供：

```ts
export function authGuard(app: FastifyInstance): void
// 注册 preHandler：解析 Bearer access token → req.userId / req.userPlanCode / req.userLocale
export function optionalAuth(app: FastifyInstance): void // 匿名可访问（提示词库等）
```

受保护路由：

```ts
app.post('/v1/tasks', { preHandler: [app.requireAuth] }, handler)
```

`app.requireAuth` 由 auth 模块通过 `app.decorate` 提供；未登录抛 `err.unauthorized()`。

## 4. 模块划分与所有权

| 模块 | 目录 | 负责路由 | 关键导出 |
|---|---|---|---|
| **A 认证/用户** | `src/modules/auth/**` | `/v1/auth/*` `/v1/users/me` `/v1/account/delete` | `authRoutes` `authGuard` `requireAuth` `AuthService` |
| **B 计费/账本** | `src/modules/billing/**` | `/v1/billing/*` `/v1/plans` `/v1/pricing/*` `/v1/admin/credits/*` | `billingRoutes` `PricingEngine.quote()` `Ledger.deduct()/refund()/grant()/balance()` `Concurrency.claim()/release()` |
| **C Provider/Router** | `src/modules/providers/**` `src/modules/router/**` | 无（被 Worker 调用） | `ProviderRegistry.get(code)` `LingkeProvider` `MockProvider` `Router.pick()` `CircuitBreaker` |
| **D 任务/Worker** | `src/modules/tasks/**` `src/workers/**` | `/v1/tasks/*` `/v1/pricing/quote` | `taskRoutes` `TaskService.create()/cancel()/retry()` `TaskStateMachine.transition()` `runWorker()` `sseHandler` |
| **E 目录/资产/签到/通知/提示词库** | `src/modules/catalog/**` `src/modules/assets/**` `src/modules/checkin/**` `src/modules/notifications/**` `src/modules/prompts/**` `src/modules/moderation/**` | `/v1/catalog/*` `/v1/assets/*` `/v1/checkin/*` `/v1/notifications/*` `/v1/prompt-library/*` | 各 `xxxRoutes` |

### 跨模块调用规则（依赖方向，禁止成环）

```
auth ──► (无业务依赖)
billing ──► core  (账本/定价自洽；被 tasks 调用)
providers ──► core (纯适配器，不碰 DB 业务表)
router ──► providers, core
assets ──► core
moderation ──► core, providers(llm 调用可选)
tasks ──► billing, router, providers, assets, moderation, notifications
catalog ──► core
```

**tasks 依赖 billing 的接口（Worker 结算用）**：

```ts
// src/modules/billing/ledger.ts
// 所有入口都接受可选 `tx`：传入则复用调用方事务与 advisory 锁
//（扣减必须与建任务同事务，否则会出现"扣了钱没建任务"的撕裂状态）。
export interface LedgerApi {
  balance(userId: string): Promise<number>;
  deduct(input: { userId: string; credits: number; taskId: string; idempotencyKey: string; tx?: Prisma.TransactionClient }): Promise<{ balanceAfter: number }>;
  refundTask(input: { userId: string; taskId: string; credits: number; tx?: Prisma.TransactionClient }): Promise<{ refunded: boolean; balanceAfter: number }>;
  grant(input: { userId: string; type: LedgerType; amount: number; idempotencyKey: string; expiresAt?: Date | null; note?: string; tx?: Prisma.TransactionClient }): Promise<{ balanceAfter: number }>;
  expiringSoon(userId: string, withinHours?: number): Promise<number>;
  expireBatch(input: { userId: string; ledgerId: string; amount: number; date: Date; tx?: Prisma.TransactionClient }): Promise<{ balanceAfter: number }>;
}
export const ledger: LedgerApi;
```

> **返还幂等的唯一裁决点**：`ledger.refundTask()` 内部的条件更新
> `UPDATE tasks SET settled_credits=0, refunded=true WHERE id=$1 AND refunded=false`。
> **调用方（`workers/settle.ts`）不得先自行把 `refunded` 置 true** —— 否则该条件更新必然命中 0 行，
> 判定失去依据，会有静默漏返还风险。`refunded` / `settled_credits` 一律只由账本写。

**tasks 依赖 router 的接口**：

```ts
// src/modules/router/index.ts
export interface PickResult { modelId: string; modelCode: string; channelId: string; channelCode: string; displayName: string; }
export interface RouterApi {
  pick(input: { capability: Capability; requestedModelId?: string; userId: string; params: Record<string, unknown> }): Promise<PickResult>;
}
export const router: RouterApi;
```

**tasks 依赖 providers 的接口**：

```ts
// src/modules/providers/registry.ts
export function getProvider(channelCode: string): GenerationProvider;
export function loadModelDescriptor(modelId: string): Promise<ModelDescriptor>; // 读 DB models 表
export function getChannelCreds(channelId: string): Promise<ChannelCreds>;      // 取 Key 池第一把可用
```

**任务进度广播（→ SSE）**：

```ts
// src/modules/tasks/events.ts
export async function publishTaskEvent(evt: {
  taskPublicId: string; status: TaskStatus; progress: number;
  results?: Array<{ assetId: string; url: string; mimeType: string; width?: number; height?: number; durationSec?: number }>;
  error?: { code: string; message: string };
  settledCredits?: number; refundedCredits?: number;
}): Promise<void>;
```

SSE 路由订阅 `REDIS_KEYS.taskChannel(taskPublicId)`。

## 5. Mock Provider 契约（**本期测试基线，禁止打真实上游**）

`MOCK_PROVIDER=true` 时 `getProvider()` 一律返回 `MockProvider`：

- `submit()` → `externalJobId = mock_<taskId>`；延迟 `MOCK_LATENCY_MS`（默认 3000）后 `poll()` 返回 succeeded。
- 失败注入：请求头/参数 `X-Mock-Fail: timeout|upstream_error|content_rejected|insufficient_balance`（**仅 `NODE_ENV !== 'production'` 或 `MOCK_FAIL_INJECTION=true` 生效**）。
- 产出：按 capability 返回对应 mimeType 的远端 URL（`http://minio:9000/mock-fixture/...`），供 transfer 队列走真实下载路径 —— 测试环境用本地生成的 fixture 文件。
- **绝不发起对 `api.lk888.ai` 的请求**。`LingkeProvider` 代码必须完整实现但仅在 `MOCK_PROVIDER=false` 时被选中。

## 6. 测试要求

| 层 | 位置 | 说明 |
|---|---|---|
| 单元 | `src/**/*.test.ts` | 纯函数：定价/映射/校验/账本数学/路由权重/审核 |
| 契约 | `tests/contract/*.contract.test.ts` | nock 拦 HTTP，用 fixture 测 LK888 报文解析（不真连） |
| 集成 | `tests/integration/*.int.test.ts` | 真 PG/Redis（Testcontainers 或本地 DATABASE_URL） |
| E2E | `tests/e2e/*.e2e.test.ts` | 起 app + MockProvider 跑完整闭环 |

集成/E2E 用 `tests/helpers/*` 提供的容器与环境辅助。

## 7. 验收映射（PRD §13 1~23）

必须为每条产出可执行测试或 CI 检查，见 `tests/ACCEPTANCE.md`（由 D 模块负责人汇总）。
