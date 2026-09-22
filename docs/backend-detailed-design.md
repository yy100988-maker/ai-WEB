# Vutu 后端详细设计（Detailed Design）

| 项 | 内容 |
|---|---|
| 文档版本 | **v0.4**（草稿，随 PRD v0.5；变更见文末附录） |
| 上游需求 | `docs/backend-prd.md` v0.5（§14 #2/#10/#11/#12 已锁死） |
| 技术栈 | Fastify 5 + TypeScript 5 strict / PostgreSQL 16 / Redis 7 + BullMQ / MinIO（S3）/ Prisma 6 / Zod / Vitest + Testcontainers |
| 部署 | 与前端同机，Docker Compose 同栈（`api` / `worker` / `postgres` / `redis` / `minio` / `caddy`） |

---

## 0. 范围与可追溯性

本文覆盖 PRD v0.5 的 Must + Should（M0~M4），Won't（支付功能、运营后台界面、Canvas/Editor 协同、视频翻译、数字人）不在实现范围，但表结构与接口预留扩展位。

| PRD 章节 | 本文档对应 |
|---|---|
| §4 总体架构/任务链路 | §2.5 提交链路 + §3 Worker 流程 |
| §5 多渠道/多模型 | §4 Provider 适配层 |
| §6 计费（cost×1.3 / 提交即扣失败即返 / 三层折扣） | §1 数据模型（账本/价格表），§2.6 计费与订阅 |
| §7 数据模型概要 | §1 完整 Prisma schema |
| §8 API 设计 | §2 OpenAPI 契约 |
| §9 非功能 | §6 可观测性与安全 |
| §10 前端对接 | §2 各接口前端映射备注 |
| §11 里程碑 M0~M4 | §8 部署 + §7 测试分阶段门禁 |
| §13 验收 1~23 | §7.7 验收映射表（每条对应测试用例 ID） |
| §15 Phase 2 remix | 表结构先行（§1.10），实现不在本期 |

**全局约定**
- 时间：DB 存 `timestamptz`（UTC），API 读写 ISO-8601，展示层按用户时区转。
- 金额：积分 `INTEGER`（最小单位，不用小数）；人民币/美元 `INTEGER` 分/cent；上游算力 `NUMERIC(18,6)`。
- ID：对外 `TEXT` 前缀编码（`usr_`/`tsk_`/`ast_`/`ord_`/`chk_`，nanoid 12 位）；DB 主键 `UUID DEFAULT gen_random_uuid()`，对外 ID 唯一索引。
- 软删除：`deleted_at`，查询默认过滤。
- 所有写接口支持 `Idempotency-Key` 请求头（见 §2.1）。

---

## 1. 数据库设计

Prisma + PostgreSQL 16。 Migration 顺序：`m0_init`（枚举/扩展）→ `m1_identity`（1.1 用户认证 + 1.2 订阅计划）→ `m2_catalog`（1.3 渠道/模型）→ `m3_assets_tasks`（1.4 资产 + 1.5 任务）→ `m4_billing`（1.6 账本/赠送/订单 + 1.7 定价）→ `m5_social`（1.8 通知/偏好 + 1.9 提示词库 + admin 审计）→ `m6_remix`（1.10 Phase 2 表结构，可推迟到 Phase 2 执行）。

```prisma
// ---------- m0: 扩展与枚举 ----------
generator client { provider = "prisma-client-js" }

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
// 需要 CREATE EXTENSION pgcrypto;（gen_random_uuid）

enum TaskStatus {
  queued
  running
  succeeded
  failed
  cancelled
  timeout
}

enum LedgerType {
  grant_signup
  grant_checkin
  purchase
  task_deduct
  task_refund
  refund
  admin_adjust
  promo
  expire
}

enum BillingMethod {
  per_call   // 按次
  per_token  // 按token
  per_second // 按秒
}

enum PlanCode {
  free
  pro
  enterprise
}

enum SubscriptionStatus {
  trialing
  active
  past_due
  cancelled
  expired
}

enum AssetKind {
  upload
  output
}

enum NotificationType {
  task_completed
  task_failed
  subscription_expiry
  promo
}
```

### 1.1 用户与认证（M1）

```prisma
model User {
  id             String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  publicId       String    @unique @map("public_id") // usr_xxx，对外暴露
  email          String?   @unique
  phone          String?   @unique
  passwordHash   String?   @map("password_hash")
  locale         String    @default("zh-CN") // en/zh-TW/zh-CN/ja/ko/es/fr/de/it/pt/ru
  planId         String    @map("plan_id") @db.Uuid
  plan           Plan      @relation(fields: [planId], references: [id])
  status         String    @default("active") // active | suspended | deleted
  lastLoginAt    DateTime? @map("last_login_at") @db.Timestamptz
  createdAt      DateTime  @default(now()) @map("created_at") @db.Timestamptz
  deletedAt      DateTime? @map("deleted_at") @db.Timestamptz

  profile        UserProfile?
  oauthAccounts  OAuthAccount[]
  refreshTokens  RefreshToken[]
  tasks          Task[]
  assets         Asset[]
  ledgerEntries  CreditLedger[]
  checkins       DailyCheckin[]
  notifications  UserNotification[]
  preferences    UserPreference?

  @@map("users")
}

model UserProfile {
  userId        String  @id @map("user_id") @db.Uuid
  user          User    @relation(fields: [userId], references: [id], onDelete: Cascade)
  displayName   String? @map("display_name") @db.VarChar(50)
  avatarAssetId String? @map("avatar_asset_id") @db.Uuid // → assets.id，需 kind=upload 且为图片

  @@map("user_profiles")
}

model OAuthAccount {
  id         String @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  userId     String @map("user_id") @db.Uuid
  user       User   @relation(fields: [userId], references: [id], onDelete: Cascade)
  provider   String @db.VarChar(20) // google | apple
  providerId String @map("provider_id")

  @@unique([provider, providerId])
  @@map("oauth_accounts")
}

model RefreshToken {
  id        String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  userId    String   @map("user_id") @db.Uuid
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  tokenHash String   @unique @map("token_hash") // sha256，不存明文
  expiresAt DateTime @map("expires_at") @db.Timestamptz // 30d
  revokedAt DateTime? @map("revoked_at") @db.Timestamptz
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz

  @@index([userId])
  @@map("refresh_tokens")
}
// 轮换语义：refresh 时旧 token 置 revokedAt + 发新 token（§2.2）。
```

### 1.2 订阅计划（M1，读多写少，启动时加载内存 + 5min 缓存）

```prisma
model Plan {
  id              String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  code            PlanCode @unique
  nameI18n        Json     @map("name_i18n") // { "zh-CN": "专业版", "en": "Pro", ... }
  listPriceUsd    Int      @map("list_price_usd")   // cent，如 Pro 999 = $9.99（展示用）
  monthlyCredits  Int      @map("monthly_credits")  // Free=0（靠签到），Pro=1000
  checkinCredits  Int      @map("checkin_credits")  // Free=5/d，Pro=5/d（叠加）
  maxConcurrency  Int      @map("max_concurrency")  // Free=1，Pro=3
  planDiscount    Decimal? @map("plan_discount") @db.Decimal(4, 3) // Pro 0.900
  features        Json     // ["1080p","去水印","优先队列",...] i18n key 数组
  active          Boolean  @default(true)
  updatedAt       DateTime @updatedAt @map("updated_at") @db.Timestamptz

  users         User[]
  subscriptions Subscription[]

  @@map("plans")
}

model Subscription {
  id                 String             @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  userId             String             @map("user_id") @db.Uuid
  planId             String             @map("plan_id") @db.Uuid
  plan               Plan               @relation(fields: [planId], references: [id])
  status             SubscriptionStatus
  currentPeriodStart DateTime           @map("current_period_start") @db.Timestamptz
  currentPeriodEnd   DateTime           @map("current_period_end") @db.Timestamptz
  // Phase 2 支付启用后使用：externalRef（Stripe subscription id），cancelAtPeriodEnd
  externalRef        String?            @map("external_ref")
  cancelAtPeriodEnd  Boolean            @default(false) @map("cancel_at_period_end")
  createdAt          DateTime           @default(now()) @map("created_at") @db.Timestamptz

  @@index([userId, status])
  @@map("subscriptions")
}
// 首期无支付：Pro 由运营发放（见 §2.7 admin 接口），subscription 手工创建 status=active。
```

### 1.3 渠道 / 模型目录（M1 建表，M4 灌入 ★9 模型 + OFF 数据）

```prisma
model Channel {
  id            String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  code          String   @unique // 'lk888'（首期唯一渠道，多渠道预留）
  name          String
  baseUrl       String   @map("base_url")
  enabled       Boolean  @default(true)
  rateLimitRpm  Int      @map("rate_limit_rpm") @default(120)
  timeoutMs     Int      @map("timeout_ms") @default(30000)
  healthStatus  String   @map("health_status") @default("unknown") // ok | degraded | down
  circuitState  String   @map("circuit_state") @default("closed")  // closed | open | half_open
  updatedAt     DateTime @updatedAt @map("updated_at") @db.Timestamptz

  apiKeys       ChannelApiKey[]
  models        Model[]
  tasks         Task[]

  @@map("channels")
}

model ChannelApiKey {
  id           String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  channelId    String   @map("channel_id") @db.Uuid
  channel      Channel  @relation(fields: [channelId], references: [id], onDelete: Cascade)
  keyRef       String   @map("key_ref") // KMS/环境变量引用名，DB 只存引用不存明文
  strategy     String   @default("价格优先") // 价格优先 | 成功率优先 | 自定义
  priority     Int      @default(1)      // 数字越小越优先（分组级 fallback 用）
  enabled      Boolean  @default(true)
  quotaLimit   Decimal? @map("quota_limit") @db.Decimal(18, 6) // Key 级额度上限（算力，与 costUnits 同精度）
  quotaUsed    Decimal  @default(0) @map("quota_used") @db.Decimal(18, 6)

  @@map("channel_api_keys")
}

model Model {
  id               String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  channelId        String   @map("channel_id") @db.Uuid
  channel          Channel  @relation(fields: [channelId], references: [id])
  code             String   // 上游模型名，如 kling-v3-video（调 API 用，永不展示）
  displayName      String   @map("display_name") // 唯一对客真源，如 Kling V3 / GPT Image 2.5
  capabilities     String[] // text_to_video | image_to_video | text_to_image | ...
  paramMapping     Json     @map("param_mapping")     // PRD §5.4 声明式映射表
  requiredParams   Json     @map("required_params")   // ["mode","duration"]
  constraints      Json     // { maxPromptChars, maxInputImages, ... }
  enabled          Boolean  @default(true)
  qualityScore     Int?     @map("quality_score")     // 运营打分（路由加权用）
  active           Boolean  @default(false) // ★ 上架开关：false=不同步价格、不参与路由、不下发 catalog
  updatedAt        DateTime @updatedAt @map("updated_at") @db.Timestamptz

  // 反向关系（Prisma 双侧必须声明，缺任一则 validate 失败）
  priceItems       PriceItem[]
  pricingSnapshots ModelPricingSnapshot[]
  syncLogs         PriceSyncLog[]
  tasks            Task[]

  @@unique([channelId, code])
  @@index([enabled, active])
  @@map("models")
}
```

### 1.4 资产（M1：直传 + import-url；M2：产物转存写入）

```prisma
model Asset {
  id           String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  publicId     String    @unique @map("public_id") // ast_xxx
  userId       String    @map("user_id") @db.Uuid
  user         User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  kind         AssetKind // upload | output
  mimeType     String    @map("mime_type")
  storageKey   String    @map("storage_key") @unique // outputs/{userPublicId}/{taskPublicId}/{file}（见 §3.6）
  sizeBytes    BigInt    @map("size_bytes")
  width        Int?
  height       Int?
  durationSec  Int?      @map("duration_sec")
  checksum     String?   // sha256（去重 + 完整性）
  sourceUrl    String?   @map("source_url") // import-url 来源（审计用）
  meta         Json      @default("{}")     // exif/编码等
  createdAt    DateTime  @default(now()) @map("created_at") @db.Timestamptz
  deletedAt    DateTime? @map("deleted_at") @db.Timestamptz

  @@index([userId, kind, createdAt(sort: Desc)])
  @@map("assets")
}
// 上传限制（应用层校验 + S3 policy 双保险）：图片 20MB / 视频 200MB / 音频 50MB。
// import-url 额外做 SSRF 防护（规则见 §2.4 资产节），失败返回 422 UNFETCHABLE_URL。
```

### 1.5 任务（M2 核心）

```prisma
model Task {
  id               String     @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  publicId         String     @unique @map("public_id") // tsk_xxx
  userId           String     @map("user_id") @db.Uuid
  user             User       @relation(fields: [userId], references: [id], onDelete: Cascade)
  capability       String     // text_to_video | image_to_video | ...
  modelId          String     @map("model_id") @db.Uuid
  channelId        String     @map("channel_id") @db.Uuid
  apiKeyId         String?    @map("api_key_id") @db.Uuid
  status           TaskStatus @default(queued)
  progress         Int        @default(0) // 0~100
  params           Json       // 统一参数原文（已校验）
  inputAssetIds    String[]   @map("input_asset_ids") @db.Uuid
  externalJobId    String?    @map("external_job_id") // LK888 task_id（用 String 而非 BigInt：
                                                      // Prisma BigInt 序列化需自定义，且上游返回本身是字符串）
  externalStatus   Json?      @map("external_status") // 平台原始 status/status_group/is_final
  resultAssetIds   String[]   @map("result_asset_ids") @db.Uuid // 转存后的本地资产
  error            Json?      // { code, message, retryable }
  priceSnapshot    Json       @map("price_snapshot") // {capability, model, resolution, duration, credits, quotedAt}
  quotedCredits    Int        @map("quoted_credits")
  deductedCredits  Int        @map("deducted_credits") // = quoted（提交时已扣）
  settledCredits   Int        @default(0) @map("settled_credits") // 成功=quoted；失败返还后=0
  refunded         Boolean    @default(false) // §3.4 返还幂等标志（终态返还后置 true）
  idempotencyKey   String     @map("idempotency_key")
  priority         Int        @default(0) // Pro/优先队列加权
  queuedAt         DateTime   @default(now()) @map("queued_at") @db.Timestamptz
  startedAt        DateTime?  @map("started_at") @db.Timestamptz
  finishedAt       DateTime?  @map("finished_at") @db.Timestamptz
  createdAt        DateTime   @default(now()) @map("created_at") @db.Timestamptz

  events TaskEvent[]
  costs  TaskCost[]

  @@unique([userId, idempotencyKey]) // 同一用户幂等键唯一 → 重放返回既有任务
  @@index([userId, status, createdAt(sort: Desc)])
  @@index([externalJobId])
  @@index([status, queuedAt]) // worker 扫超时/重试用
  @@map("tasks")
}

model TaskEvent {
  id         String     @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  taskId     String     @map("task_id") @db.Uuid
  task       Task       @relation(fields: [taskId], references: [id], onDelete: Cascade)
  fromStatus TaskStatus? @map("from_status")
  toStatus   TaskStatus @map("to_status")
  progress   Int        @default(0)
  message    String?
  payload    Json       @default("{}")
  createdAt  DateTime   @default(now()) @map("created_at") @db.Timestamptz

  @@index([taskId, createdAt])
  @@map("task_events")
}

model TaskCost {
  id                String        @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  taskId            String        @unique @map("task_id") @db.Uuid // 一任务一条终态成本
  task              Task          @relation(fields: [taskId], references: [id], onDelete: Cascade)
  channelId         String        @map("channel_id") @db.Uuid
  modelId           String        @map("model_id") @db.Uuid
  billingMethod     BillingMethod @map("billing_method")
  costUnits         Decimal       @map("cost_units") @db.Decimal(18, 6) // 平台实际扣费（算力）
  channelGroup      String?       @map("channel_group") // 实际命中分组，如 TX-Y3
  platformRefunded  Boolean       @default(false) @map("platform_refunded")
  refundedAmount    Decimal       @default(0) @map("refunded_amount") @db.Decimal(18, 6)
  durationSeconds   Int?          @map("duration_seconds")
  rawUsage          Json          @map("raw_usage") @default("{}")
  createdAt         DateTime      @default(now()) @map("created_at") @db.Timestamptz

  @@map("task_costs")
}
```

### 1.6 账本 / 赠送 / 订单（M2 账本，M3 订阅额度）

```prisma
model CreditLedger {
  id             String     @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  userId         String     @map("user_id") @db.Uuid
  user           User       @relation(fields: [userId], references: [id], onDelete: Cascade)
  delta          Int        // 正=增加，负=扣减
  type           LedgerType
  taskId         String?    @map("task_id") @db.Uuid
  orderId        String?    @map("order_id") @db.Uuid
  balanceAfter   Int        @map("balance_after")
  idempotencyKey String     @map("idempotency_key")
  expiresAt      DateTime?  @map("expires_at") // 仅"可过期"批次流水有值（signup +7天、checkin 次日零点）；
                                             // ⚠️ 仅供 00:00 过期任务定位批次用，**不参与余额计算**（余额=SUM(delta)）
  note           String?
  createdAt      DateTime   @default(now()) @map("created_at") @db.Timestamptz

  @@unique([userId, idempotencyKey]) // 幂等核心：同用户同键只记一次
  @@index([userId, createdAt(sort: Desc)])
  @@index([taskId])
  @@index([userId, expiresAt]) // 过期扫描用
  @@map("credit_ledger")
}
// 返还幂等：(task_id, task_refund) 由业务层保证单次触发 + 唯一键兜底。
// 建议补充迁移：CREATE UNIQUE INDEX ... WHERE type='task_refund'（部分唯一索引防重返）。

model DailyCheckin {
  id        String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  userId    String   @map("user_id") @db.Uuid
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  date      DateTime @db.Date // **用户本地日**（按 UserPreference.timezone 换算后写入，非 UTC 日）
  credits   Int      // Free/Pro 均为 5（v0.5 定案）
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz

  @@unique([userId, date]) // 同一天只能签到一次 → 409 ALREADY_CHECKED_IN
  @@map("daily_checkins")
}
// 时区规则（必须实现）：
//   1. 服务端取 UserPreference.timezone（默认 Asia/Shanghai），用该时区算"今天"再写 date；
//   2. 前端展示与后端判定必须同源（前端不再自行算日期，一律用 GET /v1/checkin/today 的返回）；
//   3. 用户改时区后，若新时区的"今天"恰好已签到，则返回 409（不补签、不回溯）；
//   4. 签到额度过期时间点 = 该时区次日 00:00，由 00:00 任务按各用户时区分批处理。
//   11 语种覆盖的默认时区映射见 seed（en→America/New_York、ja→Asia/Tokyo …），未覆盖时区回落 Asia/Shanghai。

model DailyBalanceReset {
  id          String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  userId      String   @map("user_id") @db.Uuid
  date        DateTime @db.Date
  resetAmount Int      @map("reset_amount") // 当日清零的签到剩余额度

  @@unique([userId, date])
  @@map("daily_balance_reset")
}

model Grant {
  id             String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  userId         String   @map("user_id") @db.Uuid
  type           String   // daily | monthly | signup
  amount         Int
  lastGrantedAt  DateTime @map("last_granted_at") @db.Timestamptz
  nextGrantAt    DateTime @map("next_grant_at") @db.Timestamptz
  expiresAt      DateTime? @map("expires_at") @db.Timestamptz // signup=发放+7天（计划层，与流水同值）

  @@index([nextGrantAt]) // 定时任务扫描
  @@map("grants")
}
// 余额计算规则：可用余额 = SUM(delta)，**不做 expires_at 过滤**（见 §2.5 反例）。
// 过期 = 00:00 定时任务扫描 → 写 `type=expire, delta=-剩余额度` 负向流水把账本拉平，并记 daily_balance_reset。
// Grant 表只承担"发放计划"职责（nextGrantAt 驱动发放/重置），过期结算一律以 ledger 为准，避免双写不一致。

model Order {
  id          String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  publicId    String   @unique @map("public_id") // ord_xxx
  userId      String   @map("user_id") @db.Uuid
  kind        String   // subscription | credit_pack（首期仅展示，无支付写入）
  amountCents Int      @map("amount_cents")
  currency    String   @default("USD")
  status      String   @default("pending") // pending | paid | cancelled | refunded
  externalRef String?  @map("external_ref") // Phase 2 支付单号
  createdAt   DateTime @default(now()) @map("created_at") @db.Timestamptz

  @@map("orders")
}

model WebhookEvent {
  id          String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  source      String    // channel | payment（Phase 2 用）
  externalId  String    @map("external_id")
  payload     Json
  processedAt DateTime? @map("processed_at") @db.Timestamptz
  error       String?

  @@unique([source, externalId]) // 回调去重
  @@map("webhook_events")
}
```

---

### 1.7 定价配置（M2 建表，M4 灌入 ★9 模型实测价 + OFF 数据，每日同步刷新）

```prisma
model PriceItem {
  id        String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  modelId   String   @map("model_id") @db.Uuid
  model     Model    @relation(fields: [modelId], references: [id])
  capability String
  spec      Json     // { resolution, durationSec, ... }，与 quote 入参同构
  specHash  String   @map("spec_hash") // sha256(规范化 JSON)，Prisma 不支持 Json 列唯一约束，用哈希列代替；规范化规则见 §5 价格同步
  costUnits Decimal  @map("cost_units") @db.Decimal(18, 6) // 上游成本（算力）
  markup    Decimal  @default(1.3) @db.Decimal(4, 3)
  credits   Int      // 对外积分 = ceil(costUnits × 18.84)，唯一真源
  active    Boolean  @default(false) // 新增默认 false，需人工确认后上线（★名单初始 true）
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz

  @@unique([modelId, capability, specHash])
  @@index([capability, active])
  @@map("price_items")
}

model PriceSyncLog {
  id            String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  modelId       String   @map("model_id") @db.Uuid
  oldCostUnits  Decimal? @map("old_cost_units") @db.Decimal(18, 6)
  newCostUnits  Decimal? @map("new_cost_units") @db.Decimal(18, 6)
  oldCredits    Int?     @map("old_credits")
  newCredits    Int?     @map("new_credits")
  triggeredAt   DateTime @default(now()) @map("triggered_at") @db.Timestamptz
  status        String   // ok | model_disabled | failed

  @@index([triggeredAt])
  @@map("price_sync_log")
}

model ModelPricingSnapshot {
  id                 String        @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  modelId            String        @map("model_id") @db.Uuid
  groupName          String        @map("group_name")
  isActive           Boolean       @map("is_active")
  billingMethod      BillingMethod @map("billing_method")
  basePrice          Decimal       @map("base_price") @db.Decimal(18, 6)
  minPrice           Decimal       @map("min_price") @db.Decimal(18, 6)
  inputTokenPrice    Decimal?      @map("input_token_price") @db.Decimal(18, 6)
  outputTokenPrice   Decimal?      @map("output_token_price") @db.Decimal(18, 6)
  optionPrices       Json          @map("option_prices")
  timeDiscounts      Json?         @map("time_discounts")
  successRate24h     Float?        @map("success_rate_24h")
  avgResponseSeconds Float?        @map("avg_response_seconds")
  capturedAt         DateTime      @default(now()) @map("captured_at") @db.Timestamptz

  @@index([modelId, capturedAt(sort: Desc)])
  @@map("model_pricing_snapshots")
}

model RoutingPolicy {
  id               String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  capability       String   @unique
  strategy         String   // weighted | cost_first | quality_first | latency_first
  candidates       Json     // [{ model, weight, enabled, grayPercent }]
  fallbackEnabled  Boolean  @map("fallback_enabled") @default(true)
  circuitBreaker   Json     @map("circuit_breaker") // { failureThreshold, cooldownSec }
  updatedAt        DateTime @updatedAt @map("updated_at") @db.Timestamptz

  @@map("routing_policies")
}

model Promotion {
  id        String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  scope     String    // global | capability | sku(modelId+spec)
  targetId  String?   @map("target_id")
  discount  Decimal   @db.Decimal(4, 3) // 0.75 = 75折
  startsAt  DateTime  @map("starts_at") @db.Timestamptz
  endsAt    DateTime  @map("ends_at") @db.Timestamptz
  nameI18n  Json      @map("name_i18n")
  active    Boolean   @default(true)

  @@index([active, startsAt, endsAt])
  @@map("promotions")
}

model UserCoupon {
  id        String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  userId    String    @map("user_id") @db.Uuid
  code      String
  discount  Decimal   @db.Decimal(18, 2) // 直接减免积分数（非比例）
  usedAt    DateTime? @map("used_at") @db.Timestamptz
  expiresAt DateTime  @map("expires_at") @db.Timestamptz

  @@index([userId, usedAt])
  @@map("user_coupons")
}
// 折扣叠加顺序（PRD §6.8 定义）：标准价 → 限时优惠 → 订阅权益（Pro 9折）→ 优惠券；下限 1 积分。
```

### 1.8 通知 / 偏好（M4）

```prisma
model UserNotification {
  id        String           @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  userId    String           @map("user_id") @db.Uuid
  user      User             @relation(fields: [userId], references: [id], onDelete: Cascade)
  type      NotificationType
  titleI18n Json             @map("title_i18n")
  bodyI18n  Json             @map("body_i18n")
  readAt    DateTime?        @map("read_at") @db.Timestamptz
  createdAt DateTime         @default(now()) @map("created_at") @db.Timestamptz

  @@index([userId, readAt, createdAt(sort: Desc)])
  @@map("user_notifications")
}

model UserPreference {
  id                 String  @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  userId             String  @unique @map("user_id") @db.Uuid
  user               User    @relation(fields: [userId], references: [id], onDelete: Cascade)
  locale             String  @default("zh-CN") // 与 users.locale 冗余：此处为"展示偏好"，users.locale 为"注册来源"
  timezone           String  @default("Asia/Shanghai") // ⚠️ 签到日判定依赖此值，见 §1.6 DailyCheckin
  emailNotifications Boolean @default(true) @map("email_notifications") // 预留（邮件通道 Phase 2）

  @@map("user_preferences")
}

model AdminAuditLog {
  id        String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  adminKey  String   @map("admin_key") // 调用所用的 key 指纹（sha256 前 12 位）
  action    String   // credits.adjust | models.active | users.suspend ...
  target    Json     // { userId, ... }
  payload   Json     @default("{}")
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz

  @@index([createdAt])
  @@map("admin_audit_logs")
}
```

### 1.9 提示词库（M4，后端接管前端硬编码）

```prisma
model PromptTab {
  id       String  @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  code     String  @unique // all | game | music | video | ads | ai | story
  labelI18n Json   @map("label_i18n")
  sort     Int     @default(0)
  active   Boolean @default(true)

  posts PromptPost[]

  @@map("prompt_tabs")
}

model PromptPost {
  id        String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tabCode   String    @map("tab_code")
  tab       PromptTab @relation(fields: [tabCode], references: [code])
  title     String    // 即 prompt 全文（卡片标题 = 可复制内容）
  imgUrl    String    @map("img_url")  // 封面（初期复用 public 静态路径）
  assetId   String?   @map("asset_id") @db.Uuid // 若已导入资产库
  views     Int       @default(0)
  likes     Int       @default(0)
  copies    Int       @default(0)
  sort      Int       @default(0)
  active    Boolean   @default(true)
  createdAt DateTime  @default(now()) @map("created_at") @db.Timestamptz

  events PromptPostEvent[]

  @@index([tabCode, active, sort])
  @@map("prompt_posts")
}

model PromptPostEvent {
  id        String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  postId    String   @map("post_id") @db.Uuid
  post      PromptPost @relation(fields: [postId], references: [id], onDelete: Cascade)
  userId    String   @map("user_id") @db.Uuid // ⚠️ 非空：匿名用哨兵值（见下），PG 唯一键不把 NULL 视为相等
  event     String   // view | copy | like | unlike
  date      DateTime @db.Date // 按 UserPreference.timezone 换算后的"用户本地日"
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz

  @@unique([postId, userId, event, date]) // 同人同天同事件去重（UV/copy 去重）
  @@index([postId, date])
  @@map("prompt_post_events")
}
// ⚠️ 匿名用户处理：userId 必须非空。匿名请求用哨兵 UUID
//    `00000000-0000-0000-0000-000000000000` 入库 + Redis 按 IP 做当日限频（1 次/天/事件）；
//    否则 PG 中 NULL != NULL，唯一键形同虚设，未登录用户可无限刷 views。
// like/unlike 不参与唯一键语义（用户可反复切换），由业务层按最新状态覆盖计数。
// views/likes/copies 由事件聚合（after-insert 触发器累加，避免 COUNT 全表）。
// 卡片深链：/app?prompt={title}&img={imgUrl} → 前端预填；提交时 img 经 import-url 转 assetId。
```

### 1.10 Remix（Phase 2 表结构先行，实现不在本期）

```prisma
model RemixProject {
  id            String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  userId        String   @map("user_id") @db.Uuid
  sourceAssetId String?  @map("source_asset_id") @db.Uuid
  sourceUrl     String?  @map("source_url")
  status        String   @default("analyzing") // analyzing|ready|generating|done|failed
  createdAt     DateTime @default(now()) @map("created_at") @db.Timestamptz

  scenes     RemixScene[]
  globalRefs RemixGlobalRef[]

  @@map("remix_projects")
}

model RemixScene {
  id           String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  projectId    String   @map("project_id") @db.Uuid
  project      RemixProject @relation(fields: [projectId], references: [id], onDelete: Cascade)
  idx          Int
  startSec     Int      @map("start_sec")
  endSec       Int      @map("end_sec")
  prompt       String
  thumbAssetId String?  @map("thumb_asset_id") @db.Uuid
  taskId       String?  @map("task_id") @db.Uuid
  status       String   @default("pending")

  @@unique([projectId, idx])
  @@map("remix_scenes")
}

model RemixGlobalRef {
  id        String @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  projectId String @map("project_id") @db.Uuid
  project   RemixProject @relation(fields: [projectId], references: [id], onDelete: Cascade)
  assetId   String @map("asset_id") @db.Uuid
  kind      String // character | product | style

  @@map("remix_global_refs")
}
```
## 2. API 契约

Base：`https://<host>/api/v1`（Caddy 反代，同域无 CORS）。`Authorization: Bearer <access_token>`（15min）。所有 `POST/PUT/PATCH/DELETE` 支持 `Idempotency-Key`。

### 2.1 通用约定

| 项 | 规则 |
|---|---|
| 成功 | `200/201` + `{ "ok": true, "data": {...}, "requestId" }` |
| 失败 | 对应 HTTP 码 + `{ "ok": false, "error": { "code", "message", "details?" }, "requestId" }`（错误码表见 PRD §8.8） |
| 分页 | cursor 风格：`?cursor=&limit=`（默认 20，最大 100）→ `{ items[], nextCursor }` |
| 幂等 | `(userId, idempotencyKey)` 唯一约束；重放返回首次结果（`409 DUPLICATE_REQUEST` 仅用于冲突且结果不一致的极端情况，正常重放直接返回原结果 `200` + `idempotentReplay: true`） |
| 限流 | IP 100/min + user 60/min（认证类 10/min）；`429` + `Retry-After`；计数器 Redis sliding window |
| 语言 | `Accept-Language` 决定 `error.message` 11 语种；`details` 机器可读不变 |

### 2.2 认证 `POST /v1/auth/*`

```
POST /v1/auth/register   { email|phone, locale? }
→ 201 { verificationId, expiresInSec: 300 }
   副作用：发验证码（首期：日志打印 + 万能码仅 dev 环境；生产接 SMS/邮件通道 Phase 2 前用运营白名单）
   限流：同一标识 1/min，同一 IP 10/min；失败 5 次锁定 15min

POST /v1/auth/verify     { verificationId, code }
→ 200 { user, accessToken, refreshToken, isNewUser }
   isNewUser=true → 同事务：建 user/profile/preference + grant_signup(+100, 7天有效) + ledger

POST /v1/auth/login       { email|phone, password } → token 对（密码错误计数进 Redis，5 次锁 15min）
POST /v1/auth/oauth/:provider { idToken } → 首次自动建号绑定
POST /v1/auth/refresh    { refreshToken } → 轮换（旧 token 置 revoked，tokenHash 索引查）
POST /v1/auth/logout     { refreshToken } → 撤销（幂等）
GET  /v1/auth/me         → { user, plan, balance: { credits, expiringSoon } }

PATCH /v1/users/me       { displayName?, avatarAssetId?, timezone? }
→ avatarAssetId 必须属于本人且 kind=upload 且为图片，否则 422
POST /v1/auth/change-password { oldPassword, newPassword } → 需旧密码正确
POST /v1/account/delete  { password } → status=deleted，RefreshToken 全撤销，资产/任务保留 30 天后硬删（合规）
```
前端映射：`SiteHeader` login/startFree → register/login；侧栏头像昵称 → `auth/me` + `PATCH users/me`。

### 2.3 目录 `GET /v1/catalog/*`（公开接口，限流宽松 200/min）

```
GET /v1/catalog/capabilities
→ [{ code: "text_to_video", nameI18n, icon }]
   过滤规则：无 active 模型的能力不返回（avatar_talk 本期为空 → 自动隐藏）

GET /v1/catalog/models?capability=text_to_video
→ [{ id, displayName, resolutions[], durations[], aspectRatios[], features[] }]
   只返回 active=true；displayName 取 models.display_name（禁裸 ID，规则见 PRD §8.2）

GET /v1/catalog/models/:id
→ { id, displayName, params: <params.options 完整定义>, pricing: [{spec, credits}] }
   驱动 PRD §8.4.1：模型 chip → 参数 chip 动态渲染 → quote 实时价格

GET /v1/catalog/templates
→ [{ id, title, sub, img, prompt, refImgUrl, capability, modelId?, params? }]
   点击按提示词库深链模式预填 ?prompt=&img=
```

### 2.4 资产 `POST/GET /v1/assets`

```
POST /v1/assets/upload-url   { mimeType, sizeBytes, kind }
→ 201 { assetId(ast_xxx), uploadUrl(presigned PUT 15min), requiredHeaders }
   校验：mime/大小（图20M/视频200M/音频50M）；S3 policy 同约束双保险

POST /v1/assets              { assetId }
→ 200 { asset }   // 确认上传完成；异步触发魔数/病毒扫描，失败标记 asset.quarantined
POST /v1/assets/import-url   { url, kind }
→ 202 { assetId, status: "fetching" } → Worker 下载转存后 asset 就绪
   SSRF 防护：禁内网段 + DNS pinning + 重定向≤3跳 + Content-Type/魔数/大小校验；失败 422 UNFETCHABLE_URL
GET  /v1/assets?kind=&cursor=&limit=  → 资产库（软删除过滤）
GET  /v1/assets/:id          → { asset, viewUrl(浏览 15min) }（仅 owner；交付 URL 永不经此下发）
DELETE /v1/assets/:id        → 软删除（被任务引用的资产拒绝删除，409 ASSET_IN_USE）
```

### 2.5 生成任务 `POST /v1/tasks`（核心，M2）

```
POST /v1/pricing/quote   { capability, modelId?, params }
→ 200 {
    sku: "video.720p.10s", model: "kling-v3-video", credits: 117,
    breakdown: { costUnits: 6.2072, markup: 1.3, discounts: [] },
    balance: { credits: 500, sufficient: true }, estimated: false
  }
   // 查 price_items（model+spec）；无行则按公式现算；estimated 恒 false（固定价目表）
   // 前端 PRD §8.4.1：切模型/参数 → 实时 quote → 按钮显示积分；余额不足置灰

POST /v1/tasks   { capability, modelId?, prompt, negativePrompt?, inputAssetIds[], params, idempotencyKey }
→ 201 { task: { id, status: "queued", progress: 0, capability, model: {id, displayName},
                quotedCredits, remainingCredits, createdAt, estimatedSec } }
```

**服务端处理顺序（单事务 + 行锁，P95 < 3s 含审核）**：
1. 鉴权 → 2. validate 参数（映射表，非法 400）→ 3. **Moderation L1+L2**（PRD §4.2，违规 422）
4. Router.pick → model/channel → 5. quote（读表）→ 6. **deduct 原子扣减**（余额不足 402）
   ```sql
   BEGIN;
   -- 余额无 users.credits 列，实时聚合 ledger；并发安全靠 advisory 锁串行化同用户提交
   SELECT pg_advisory_xact_lock(hashtext($1));          -- $1 = user_id
   -- ⚠️ 余额 = SUM(delta) 全量求和，不做 expires_at 过滤。
   -- 过期语义由「00:00 任务写入 expire 负向流水」表达（§5），保证两件事：
   --   ① SUM(delta) 恒等于真实可用余额（append-only 不变式）
   --   ② 已消费的扣减不会被过期规则"复活"成负余额
   SELECT COALESCE(SUM(delta), 0) INTO bal FROM credit_ledger WHERE user_id = $1;
   IF bal < quoted THEN ROLLBACK; RETURN 402; END IF;
   INSERT INTO credit_ledger(user_id, delta, type, task_id, balance_after, idempotency_key)
     VALUES ($1, -quoted, 'task_deduct', $taskId, bal - quoted, $idemKey);
   COMMIT;
   ```
   用 advisory 锁而非锁 ledger 行：避免热点行争抢，锁随事务自动释放。

   **为什么不能用 `expires_at` 过滤余额**（反例）：signup 送 +100（7 天后过期），用户当天花掉 30。
   若按行过滤：7 天后 +100 行被滤掉、-30 行（`expires_at` 为 NULL）仍在 → 余额 = **−30**，用户被凭空扣负。
   改用 `SUM(delta)` + `expire` 流水后：7 天时 00:00 任务扫到该 grant 剩余 70，写 `expire, delta=-70`，
   余额 = (100 − 30 − 70) = **0**，正确且可审计。
7. 落库 task(queued) + task_event → 8. BullMQ 入队（含幂等键）→ 9. 返回 201
- 幂等重放：`(userId, idempotencyKey)` 命中 → 直接返回原 task（`idempotentReplay: true`），不重复扣费。

```
GET  /v1/tasks?capability=&status=&type=&cursor=&limit=  → 创作记录（Filter 全部/视频/图片/音频）
GET  /v1/tasks/:id          → 详情（含 progress/resultAssetIds/error）
GET  /v1/tasks/:id/stream   → SSE（见 §3.5）
POST /v1/tasks/:id/cancel   → 仅 queued/running 可取消 → refund（§3.4）
POST /v1/tasks/:id/retry    → 失败任务新 task + 重新扣减（需确认余额；原 task 不动）
```

### 2.6 计费与订阅

```
GET  /v1/plans                    → [{ code, nameI18n, listPriceUsd, monthlyCredits, features }]（Free/Pro/Enterprise）
GET  /v1/billing/balance          → { credits, expiringSoon }（AppHomePage 侧栏 + 宝石数）
   credits     = SUM(credit_ledger.delta)（§2.5，无 expires_at 过滤）
   expiringSoon = 未来 24h 内将过期的额度合计（供前端提醒；由未过期 grant 批次聚合，仅提示不参与余额）
GET  /v1/billing/ledger?cursor=&limit= → 积分流水
GET  /v1/billing/subscription     → 当前订阅（侧栏 planName + upgrade 按钮显隐）
GET  /v1/billing/credit-packs     → 积分包列表（展示用；购买走运营手动）

# 对外价目表（PRD §8.4；驱动前端 pricing/page.tsx 的 PriceTier 卡片与套餐对比）
GET  /v1/pricing/skus             → [{ modelId, displayName, capability, specs: [{ spec, credits }] }]
   // 仅返回 model.active=true 且 price_item.active=true 的行；displayName 走 models.display_name
   // 缓存：Redis 5min（价格每日仅 2 变，无需实时）
GET  /v1/pricing/skus/:capability → 同上，按能力过滤（如 text_to_video）；非法能力 → 404 NOT_FOUND
GET  /v1/pricing/promotions       → [{ id, scope, targetId?, discount, startsAt, endsAt, nameI18n }]
   // 仅返回 active=true 且 startsAt <= now() <= endsAt；驱动前端"限时 X 折"角标

POST /v1/billing/checkout|portal + /v1/webhooks/payments/* → ⚠️ Phase 2：本期**不注册这些路由**（框架默认 404）；M3 只做展示类 + admin 手动发放
```

### 2.7 签到 / 通知 / 提示词库 / 管理

```
POST /v1/checkin            → { ok, credits: 5, balance }（UNIQUE 冲突 → 409 ALREADY_CHECKED_IN）
GET  /v1/checkin/today      → { checked_in, credits }
GET  /v1/checkin/history?limit= → { records[] }（纯记录，无 streak）
GET  /v1/notifications?cursor=&limit= → 列表； POST /v1/notifications/:id/read；POST /v1/notifications/read-all；GET /v1/notifications/unread-count（红点）
GET  /v1/prompt-library[?cat=] → { tabs[], cards[{id,title,img,cat,views,likes}] }（实时计数）
POST /v1/prompt-library/:id/view|copy → 计数+1（copy 返回原文供剪贴板）
POST /v1/prompt-library/:id/like      → 点赞切换（为后续前端按钮预留）

# 最小 admin 接口（内网 + ADMIN_TOKEN鉴权，不进对客文档，M3）
POST /v1/admin/credits/adjust  { userId, delta, reason } → ledger admin_adjust（Pro 开通/积分包发放走此口）
GET  /v1/admin/users?cursor=   → 用户列表（运营发放入口数据源）
POST /v1/admin/models/:id/active { active } → 上下架模型（运营开关 ★）
```

---

## 3. Worker 设计（常驻进程，BullMQ）

### 3.1 队列拓扑

| 队列 | 生产者 | 消费者 | 并发 | 重试 |
|---|---|---|---|---|
| `generation` | API 提交 | worker（多实例） | 按渠道限流（令牌桶/渠道） | 仅 `retryable` 错误 ≤3 次，指数退避 30s→120s→480s |
| `poll` | worker（delayed job） | worker | 50 | 平台 15s 超时即重调度 |
| `transfer` | worker（终态后） | worker | 10 | 下载 3 次，失败只告警 |
| `notify` | worker（终态后） | worker | 20 | 写通知表失败重试 5 次 |

队列全部 Redis 持久化（AOF）；`stalled` 任务 BullMQ 自动重入队。

### 3.2 任务状态机实现

```
queued --(worker取到)--> running --(is_final=true, success)--> succeeded
                             |--(is_final=true, failed)-------> failed → refund
                             |--(cancel请求)-------------------> cancelled → refund（先调 provider.cancel?，无论成败本地终态+返还）
                             └--(30min超时扫描)----------------> timeout → refund（保留 timeout 状态供客诉排查）
```
- 每次变迁写 `task_events` + `publish` 进度（Redis pub/sub → SSE）。
- `cancel` 仅 queued/running 有效；已终态返回 `409 TASK_FINAL`。
- **并发上限在提交时强制**：`GET running_count(user)`（Redis 计数器，任务终态时递减；启动时从 DB 重建）≥ plan.maxConcurrency → `429 TOO_MANY_TASKS`。计数器与任务状态机在同一事务外维护，允许短暂超限 1（终态事件驱动校准），宁可多放行不可误拦付费生成。
- `retry` = 新 task（新幂等键）+ 重新走提交链路，原 task 不动。

### 3.3 轮询器（首期只用轮询；渠道回调接口预留但不启用）

```
submit → externalJobId → BullMQ delayed job (15s) →
  GET task-status → 更新 progress/externalStatus →
    is_final ? 终态处理 : 再调度 delayed 15s
```
- 超时：`startedAt + 30min` 未终态 → timeout。
- 平台限流/5xx → 按退避重试；`refunded=true` 的失败直接进 failed（余额已退回，可原文案重提）。

**关于 `POST /v1/webhooks/channels/:channel`（PRD §8.4 列出的接口）**：
本期**不注册、不实现**——LK888 首期走 `notify_url` 回调的收益低于风险（回调地址需公网可达、签名机制未实测、丢回调仍需轮询兜底，等于双链路维护）。
处理方式：
1. 路由不注册（框架 404），与 Phase 2 支付路由同一处理；
2. 提交时**不传** `notify_url`，纯轮询（15s 间隔，P95 出片 2~14min，轮询次数可接受）；
3. 设计保留扩展位：`WebhookEvent` 表（`source=channel`）+ 幂等去重机制已建好，Phase 2 若确需回调，补签名校验（HMAC + 时间戳防重放）即可直接启用；
4. PRD §8.4 该行已同步改为"Phase 2 预留"。
- 触发条件：出现平台回调、或轮询配额不足时启用。

### 3.4 结算与退款（PRD §6.5 落地）

```ts
// 成功：无余额操作（提交时已扣），只记账
settledCredits = quotedCredits; task_costs.insert(cost from task-status.cost)
// 失败/取消/超时：幂等返还（状态机保证单次触发 + 唯一键兜底）
BEGIN;
  SELECT ... FOR UPDATE task WHERE id AND status IN ('failed','cancelled','timeout') AND refunded=false;
  INSERT credit_ledger (user, +quoted, task_refund, idempotencyKey=`refund:{taskId}`);
  UPDATE task SET settledCredits=0, refunded=true;
COMMIT;
```

### 3.5 SSE 进度流

```
GET /v1/tasks/:id/stream  →  text/event-stream
event: progress | data: { taskId, status, progress }
event: succeeded | data: { taskId, results: [{assetId, url, mimeType, ...}], settledCredits }
event: failed    | data: { taskId, error, refundedCredits }
```
- 实现：订阅 Redis channel `task:{id}`；断线前端重连后先 `GET /tasks/:id` 恢复当前态；
  SSE 首字节 < 500ms；心跳 15s comment 保活；Caddy 关闭 proxy buffering（`reverse_proxy` 默认即无缓冲，无需额外配置，但禁止在 Caddy 与 api 之间再套一层 Nginx）。

### 3.6 产物转存

终态成功后 `transfer` 队列：下载 `result_url`（重试 3 次，Range 续传）→ 校验魔数/大小 → `PUT outputs/{userPublicId}/{taskPublicId}/{sanitizedFilename}`（用对外 ID，可读且避免 UUID 暴露内部主键习惯）→ `assets(kind=output)` → `tasks.result_asset_ids[]`。
- 下载失败只告警（Sentry P2），**绝不重提生成任务**（平台已扣费）。
- Free 用户水印：转存后异步加水印 job（ffmpeg drawtext，幂等覆盖）。
- 时序说明（AI 生图右侧结果不显示修复，2026-09-22）：`succeeded` 先发布用于快速反馈，此时 `result_asset_ids` 可能仍为空；`transfer` 完成后必须补发一次 `succeeded` 事件（含 `results`）并刷新缓存，前端在 `succeeded` 后若 `results` 为空需继续轮询 `GET /v1/tasks/:id` 直到非空（最多 30 秒），期间展示转存中态而非空引导态。

---

## 4. Provider 适配层

### 4.1 接口（与 PRD §5.1 一致，补充交付 URL 注入点）

```ts
interface GenerationProvider {
  readonly channelId: string;                              // 'lingke-ai'
  readonly supportedCapabilities: Capability[];
  listModels(): Promise<ModelDescriptor[]>;
  validate(req: GenerationRequest): ValidationResult;
  // submit 前 Worker 已把 inputs 置换为 4h 交付 URL（PRD §8.3 三权分立），重试前重签
  submit(req: GenerationRequest, model: ModelDescriptor, creds: ChannelCreds): Promise<SubmitResult>;
  poll(externalJobId: string, creds: ChannelCreds): Promise<PollResult>;
  cancel?(externalJobId: string, creds: ChannelCreds): Promise<void>;
  mapError(err: unknown): { code: string; retryable: boolean; userMessage: string };
}
```

### 4.2 LK888 实现要点（`LingkeProvider`，唯一实现类 + Mock）

| 项 | 实现 |
|---|---|
| 提交 | `POST {base}/media/generate` `{model, prompt, params}`（**首期不传 `notify_url`**，纯轮询，见 §3.3）；成功判 `code=200`（非 HTTP 状态），读 `data.task_id` |
| 轮询 | `GET /v1/skills/task-status?task_id=`；终态判 `is_final=true`；`state` 映射 success→succeeded |
| 参数 | 严格按 `models/{name}` 返回的 params 定义组装；`required=true` 必传；`select` 必须命中 options；视频传交付 URL（禁 base64） |
| 错误映射 | `invalid_request_error`→400 不可重试；`insufficient_balance`→平台余额告警 P0；`rate_limit_exceeded`→退避；`upstream_error`→可重试；任务 `state=failed` + `refunded=true`→可安全重提 |
| 凭据 | `channel_api_keys.key_ref` → KMS/环境变量取明文，内存缓存 5min；日志脱敏 `sk-***ae56` |
| Mock | `MockProvider`（`MOCK_PROVIDER=true`）：固定延迟返回本地 fixture；支持失败注入（header `X-Mock-Fail: timeout|upstream_error|content_rejected`，仅 staging/CI 生效，生产强制忽略），用于前端联调 + 集成测试不花钱 + E2E-3 失败路径 |

### 4.3 Router.pick 实现（PRD §5.3 落地）

```
1. 显式 modelId → 校验 active+可用 → 不可用 409 MODEL_UNAVAILABLE + alternatives[]
2. 未指定 → candidates 过滤（enabled/active/能力/参数约束/熔断器状态）
3. 灰度：hash(userId)%100 < grayPercent 才可参与
4. 加权随机（strategy 备用：cost_first 按 10s 基准价排序）
5. 全灭 → 503 NO_HEALTHY_PROVIDER + estimatedRecoverySec（取熔断器最早恢复时间）
```
熔断器：Redis 计数，连续失败 ≥5 → open 120s → half_open 探活 1 次 → 恢复/继续 open。
降级通知：每次开/关熔断写日志 + 指标 + 可选通知运营（§6 告警）。

---

## 5. 定时任务（node-cron，单实例 leader 锁 via Redis SET NX）

| 任务 | 频率 | 逻辑 |
|---|---|---|
| 价格同步 | 每日 02:00 / 14:00（UTC+8） | 遍历启用模型 → `pricing?status=active` → 按三口径重算 → `price_items` + `price_sync_log`；`min_price` 变动 >20% → 告警 + 自动 `active=false`；新模型默认 `active=false` 待人工确认。`specHash = sha256(JSON.stringify(按key排序后的spec))`（数字保持数字类型，不转字符串；数组保序） |
| 额度重置 | 每日 00:05 | Pro 月度重置（按订阅周期）+ 签到额度清零（`daily_balance_reset` + `expire` 流水）+ signup 7 天过期扫描 |
| 账本对账 | 每日 03:00 | 逐用户重算 `SUM(delta)`（**全量，不过滤过期**）对比其最新 `balance_after`；差异 ≠0 → P0 告警；输出毛利日报（按 SKU/模型/能力） |
| 超时扫描 | 每 5min | `running` 超 30min → timeout → refund（兜底轮询器漏网） |
| 平台余额监控 | 每小时 | `GET /v1/skills/balance`；低于 10× 最高单次成本 → P0 告警 + 新提交返回 `503 NO_HEALTHY_PROVIDER`（`details.reason=platform_balance`，前端凭此展示停服提示，不新增错误码） |
| 产物清理 | 每日 04:00 | 超保留期（Free 30 天 / Pro 90 天）→ 软删除 + S3 删除（保留审计元数据） |
| 通知清理 | 每周 | 已读超 90 天的通知硬删 |

---

## 6. 可观测性与安全

### 6.1 日志（pino JSON）
- 全链路 `requestId`（API 生成 → Worker 透传 → 上游调用 header `X-Request-Id`）。
- 供应商调用必记：`model/channelGroup/costUnits/latency/success/errorType`（成本对账数据源）。
- 脱敏：API Key、prompt 全文（ERROR 以上才记哈希）、用户邮箱/手机掩码。

### 6.2 指标（Prometheus + Grafana，最小看板）
- `http_requests_total/duration`（按 route/status）
- `tasks_total{status,model,capability}`、`task_duration_seconds`（P50/P95/分模型）
- `provider_success_rate`、`provider_cost_units_total`（分渠道分组）
- `ledger_daily_delta`（对账用）、`margin_7d{sku,model}`
- `queue_depth`、`worker_stalled_total`、`circuit_breaker_state`

### 6.3 告警（Sentry + 看板阈值）
- P0：账本对账差异、平台余额不足、毛利率 <0%、5xx 突增、PG/Redis 不可用
- P1：毛利率 <20%、单模型成功率 <50%（1h）、同步失败、转存失败率 >5%

### 6.4 安全清单
- JWT：`JWT_SECRET` ≥32 字节，access 15min / refresh 30d 轮换；密码 bcrypt cost 12。
- 上传：mime + 魔数 + 大小三重校验；S3 policy 限定前缀；import-url SSRF 全套（§2.4）。
- 请求：全局限流 + 认证类严格限流 + 验证码；`trustProxy` 只信 Caddy；Helmet 头。
- 密钥：宿主机 `.env`，`LK_KEY`/`JWT_SECRET`/`S3_SECRET`/`ADMIN_TOKEN` 分开；永不进日志/前端。
- Admin 接口：内网监听 + `ADMIN_TOKEN`（Bearer，独立于用户 JWT）+ 操作审计表（`admin_audit_logs`，建议 M3 补表）。
- 合规：注销 30 天硬删；生成产物默认私有；AIGC 标识按监管要求打标（水印/元数据二选一，M6 定）。

---

## 7. 自动化测试方案

### 7.1 策略（测试金字塔 + 风险导向）

```
      ┌─────────────┐
      │  E2E (5%)   │  核心闭环冒烟：注册→签到→生成→查询→退款
      ├─────────────┤
      │ 集成 (25%)  │  Testcontainers 真 PG/Redis：账本/任务/并发/幂等
      ├─────────────┤
      │ 契约 (20%)  │  LK888 mock(nock)：提交/轮询/错误码/三口径计费
      ├─────────────┤
      │ 单元 (50%)  │  纯函数：定价/映射/校验/账本数学/路由权重
      └─────────────┘
      + 压测（M5 前） + 混沌（M6 前） + §13 验收映射（发布门禁）
```

**门禁**：`main` 合并要求 lint + typecheck + 全量单测 + 集成测试通过；覆盖率行覆盖 ≥80%、**计费/账本/退款相关文件 100%**（`npx vitest --coverage`，CI 强制）。

### 7.2 单元测试（Vitest，`*.test.ts` 同目录）

| 模块 | 用例要点 |
|---|---|
| `pricing/engine` | 三口径公式全组合；`ceil` 边界（如 58.47→59）；折扣叠加顺序与 1 积分下限；24 个价目表快照回归（改公式即爆红） |
| `providers/validate` | 全部模型 × 非法组合矩阵（如 gk-video-3 要 30s、hailuo-h3 传 mode 等）→ 400 + 可选值提示 |
| `billing/ledger` | 借贷平衡（`SUM(delta)` == 最新 `balance_after`）；过期批次写 `expire` 负向流水后账本仍平；`expire` 幂等（同批次不重复过期） |
| `router/pick` | 权重分布（χ² 检验 10k 次采样在 ±5% 内）；灰度哈希稳定性；全灭 503 |
| `moderation` | L1 命中/漏过集；L2 prompt 构造；fail-open 超时路径；哈希缓存命中 |
| `catalog` | displayName 无裸 ID 泄露（回归：全量模型断言 `!displayName.includes('tt-')` 等渠道代号规则） |

### 7.3 集成测试（Testcontainers：PG16 + Redis7，`*.int.test.ts`）

```ts
// helper: testcontainers 启动 PG/Redis → 跑 prisma migrate → 每个用例独立事务回滚
describe('billing', () => {
  test('并发100抢10个任务额度：恰好10成功/90个402，余额≥0', ...); // §13 #5
  test('同 Idempotency-Key 重放10次：1 task + 1 次扣费', ...);      // §13 #6
  test('失败→task_refund 全额返还；重放终态不二次返还', ...);        // §13 #4
  test('签到并发双击：仅一次成功，另一次 409', ...);
  test('注册 7 天过期：grant_signup 过期后余额剔除 + expire 流水', ...); // 时间旅行（mock Date）
});
describe('tasks', () => {
  test('提交→queued→(MockProvider)running→succeeded→转存→asset 可下载', ...);
  test('cancel 终态任务 → 409 TASK_FINAL', ...);
  test('SSE 断线重连恢复当前态', ...);
});
```

### 7.4 契约测试（LK888，nock 录制真实响应 fixture）

- fixtures 来自 `docs/lk888-capabilities.md` 实测报文（POC 0.2753、task-status 终态、`refunded=true` 样例）。
- 覆盖：`code!=200` 判失败；`is_final` 为准（非 status 文本）；中文兼容字段忽略（`任务ids` 等下线字段变更不炸）；三口径 cost 解析；`channel_group` 忽略（平台行为锁定）。
- 每日同步解析器单测：全部上架模型 pricing fixture → price_items 行断言。

### 7.5 E2E（M5，临 staging 环境，MockProvider + 真 PG/Redis/MinIO）

| ID | 路径 | 断言 |
|---|---|---|
| E2E-1 | 注册→签到→quote→提交→SSE 到 succeeded→创作记录可见 | §13 #1 |
| E2E-2 | 余额不足提交 → 402 → 签到/充值后重试成功 | — |
| E2E-3 | 注入渠道失败 → failed → refund → 余额恢复 | §13 #4 |
| E2E-4 | 提示词库卡片 → 深链预填 → refImg import → 带图提交成功 | §13 #20 |
| E2E-5 | 违规 prompt → 422（不建 task、无流水） | §13 #23 |

### 7.6 压测与混沌（M5/M6）

- 压测（k6，同机 staging）：`POST /tasks` 50 rps/10min（P95 < 3s）；SSE 500 并发连接；BullMQ 堆积 10k 任务 drain 时间。**禁打生产上游**：压测一律 `MOCK_PROVIDER=true`。
- 混沌：PG 主库 kill → 重连恢复；Redis flush → 队列重建 + 幂等键丢失预案（DB 唯一键兜底）；LK888 5xx/超时注入 → 熔断开合符合预期；MinIO 宕机 → 转存重试 + 告警。

### 7.7 §13 验收映射（发布门禁检查表）

| §13 # | 验收项 | 对应测试 |
|---|---|---|
| 1,2,3 | 注册/赠送/签到 | 集成 billing + E2E-1 |
| 4,6 | 失败退款 / 幂等 | 集成 billing ×3 |
| 5 | 不超卖 | 集成 billing 并发用例 |
| 7,13 | 路由/熔断 | 单元 router + 混沌熔断 |
| 8 | mock 清零 | CI `grep` 检查项（非 E2E） |
| 9,11,12,14,15 | 进度/价格同步/折扣叠加/三口径/可观测 | 契约 + 集成 + 看板 |
| 10 | 前端硬编码模型名替换 | CI `grep` + catalog 单测 |
| 16 | 产物转存 | 集成 tasks |
| 17,18 | 通知/注销 | 集成 + E2E |
| 19 | 模型差异化定价 | 单元价目表快照 + E2E（切 chip 变价） |
| 20,21,22 | 提示词库/import 安全/交付链路 | E2E-4 + 集成 |
| 23 | 前置审核 | 单元 moderation + E2E-5 |
| — | 已移除项 | 原 #17（连续签到）已删，其后各项顺延 1 位 |

### 7.8 CI 流水线（GitHub Actions）

```
push/PR → lint(eslint) → typecheck(tsc) → unit(vitest, coverage门禁)
        → integration(Testcontainers, services: none, 全容器内起)
        → build(Docker api+worker) → E2E(staging compose, 仅 main/打tag)
        → 压测(手动触发 workflow_dispatch)
```
- 机密：CI 用 `MOCK_PROVIDER=true` + 测试 Key，**永不调生产上游**；集成测试不花一分钱。
- 产物：覆盖率报告 + SBOM（`npm audit` 高危阻断合并）。

---

## 8. 部署（同机 Docker Compose，见 PRD §3.6）

```yaml
# ai-cloner/docker-compose.yml 追加
services:
  api:
    build: { context: ../server, dockerfile: Dockerfile }
    command: ["node", "dist/main.js"]
    expose: ["8080"]
    env_file: [/opt/vutu/.env]
    depends_on: { postgres: { condition: service_healthy }, redis: { condition: service_healthy } }
    deploy: { resources: { limits: { cpus: "2", memory: 2G } } }
    healthcheck: { test: ["CMD-SHELL", "wget -qO- http://localhost:8080/v1/health || exit 1"], interval: 30s }
  worker:
    build: { context: ../server }
    command: ["node", "dist/worker.js"]
    env_file: [/opt/vutu/.env]
    depends_on: [postgres, redis, minio]
    deploy: { resources: { limits: { cpus: "4", memory: 4G } } }  # ffmpeg/轮询大户，单独封顶
    # replicas: 2  # 单机 compose 不支持 deploy.replicas；多开用 docker compose up --scale worker=2
  postgres:
    image: postgres:16-alpine
    volumes: [pgdata:/var/lib/postgresql/data, /opt/vutu/backup:/backup]
    environment: { POSTGRES_PASSWORD: ${PG_PASSWORD} }  # 与 DATABASE_URL 内密码同源，禁止 secrets-file 与 URL 混用
    healthcheck: { test: ["CMD-SHELL", "pg_isready -U vutu"], interval: 10s, retries: 5 }
  redis:
    image: redis:7-alpine
    command: ["redis-server", "--appendonly", "yes"]
    volumes: [redisdata:/data]
    healthcheck: { test: ["CMD", "redis-cli", "ping"], interval: 10s, retries: 5 }
  minio:
    image: minio/minio
    command: ["server", "/data", "--console-address", ":9001"]
    volumes: [miniodata:/data]
  caddy:
    image: caddy:2-alpine
    ports: ["80:80", "443:443"]
    volumes: [./Caddyfile:/etc/caddy/Caddyfile, caddydata:/data]
    # Caddyfile 必含：reverse_proxy /api/* → api:8080（SSE 不开缓冲）；其余 → app:3000

volumes:
  pgdata:
  redisdata:
  miniodata:
  caddydata:
```

### 8.1 环境变量清单（宿主机 `/opt/vutu/.env`，不进仓库）

| 变量 | 示例 | 说明 |
|---|---|---|
| `DATABASE_URL` | `postgresql://vutu:...@postgres:5432/vutu` | Prisma |
| `REDIS_URL` | `redis://redis:6379` | BullMQ/缓存/限流 |
| `S3_ENDPOINT/KEY/SECRET/BUCKET` | `http://minio:9000` | MinIO（S3 协议） |
| `LK_BASE_URL` / `LK_API_KEYS` | `https://api.lk888.ai/api` / JSON 数组 | 多 Key 池（Could 用） |
| `JWT_SECRET` / `ADMIN_TOKEN` | 随机 32B+ | 独立管理 |
| `MOCK_PROVIDER` | `false`（staging/压测=true） | Mock 开关 |
| `USD_TO_CNY` / `MARKUP` / `CREDITS_PER_USD` | `6.9` / `1.3` / `100` | 定价三常数（改此即改全站价） |
| `SENTRY_DSN` | … | 错误追踪 |

### 8.2 上线检查表（M6）
- [ ] `.env` 齐全且权限 600；`LK_KEY` 已轮换（旧 Key 作废）
- [ ] `prisma migrate deploy` 成功；seed 写入 plans / moderation 基线词库 / ★模型及路由策略（无 roles 表，权限靠 ADMIN_TOKEN）
- [ ] `price_items` 行数 == ★上架模型 × 其规格数且 `updatedAt` 当天；`GET /v1/catalog/models` 非空且无 `active=false` 混入
- [ ] 平台余额 > 阈值；冒烟 E2E-1~E2E-5 全绿；备份任务跑通一次恢复演练

---

## 附录：版本记录

**版本规则**：`0.x` = 草稿；`1.0` = 评审通过基线（与 PRD 对齐）。

| 版本 | 变更 |
|---|---|
| v0.1 | 初稿：§0~§8 全章节（schema/API/Worker/Provider/定时任务/可观测/测试/部署） |
| v0.2 | 评审修订：修复 WebhookEvent 模型损坏 + RemixGlobalRef 重复定义；Task 补 `refunded`；PriceItem 改 `specHash` 唯一键；migration 编号对齐真实小节；扣减 SQL 去草稿化；Phase 2 路由改为不注册；补并发上限落点 + `TASK_FINAL` 入表；Mock 加失败注入；对账/停服/规范化规则补齐；compose 实操修正 5 处；§0 对照表章节号纠错 |
| v0.3 | 二轮评审：Model 补 4 个反向关系 + Channel 补 `tasks`（缺失会导致 `prisma validate` 失败）；`externalJobId` BigInt→String（JSON 序列化）；`quotaLimit` 精度对齐 Decimal；`Asset.storageKey` 路径与 §3.6 对外 ID 一致；§7.7 验收映射按 PRD 现编号 1~23 重排（原连续签到项已删）；"18 模型"表述统一改为 ★9 上架模型 |
| v0.4 | 三轮评审（跨文档一致性）：**修余额计算严重 bug**（扣减 SQL 改 `SUM(delta)` 全量，过期改由 `expire` 流水表达，附反例说明）；补 PRD 已定义但设计缺失的 3 个接口（`pricing/skus`、`pricing/skus/:capability`、`pricing/promotions`）；webhook 与轮询矛盾对齐（本期不注册、不传 `notify_url`，PRD 同步标 Phase 2 预留）；`PromptPostEvent.userId` 改非空 + 匿名哨兵 UUID（修 NULL 唯一键失效可刷计数）；签到时区规则落地（4 条规则 + 默认时区映射）；Grant 表定位澄清（只做发放计划，过期以 ledger 为准）；`cancel` 语义与 PRD 对齐（上游不支持也本地终态并返还）；错误码表排序 + 补 `UNFETCHABLE_URL` |
| v0.5 | 生图结果显示修复：明确 `succeeded` 先于转存发布，转存完成后补发带 `results` 事件；前端 `succeeded` 后空结果需轮询至多 30 秒并显示转存中态 |

