# Vutu × xiaoye-ai 功能吸收改造设计方案

> 状态：**已定稿 v1.1**（2026-09-23 决议生效）
> 参考项目：https://github.com/capybara-zy/xiaoye-ai （AGPL-3.0，仅功能与接口规格参考）
> 前置阅读：`docs/backend-prd.md`、`docs/backend-detailed-design.md`、`docs/lk888-capabilities.md`、`server/CONTRACT.md`、`docs/UI-DIFF-deevid-vs-vutu.md`

---

## 0. 决议摘要（2026-09-23 拍板，覆盖 §3/§6/§15 的原推荐）

| # | 决议 |
|---|---|
| D1 | **F1/F2 计费 = 走账本扣积分**。触发**契约修订 R1**：`LEDGER_TYPES` 加法新增 `'service_deduct'`、`LedgerApi` 加法新增 `spend()`（详见 §3.1 与 §9） |
| D2 | **本期范围 = A+B+C 全做**（Phase D 邀请奖励/审核 UI/L2 真调用/代理配置另排期） |
| D3 | **`PROMPT_AUTO_APPROVE` 默认 `true`**：发布即上首页（标题已过 L1+L2 审核），admin 驳回接口仍保留可下架 |

---

## 0.1 背景与范围

xiaoye-ai（小野AI）与 vutu 同赛道（多模态内容创作平台），其**提示词优化 / 反推提示词 / 兑换码 / 灵感广场审核闭环 / 电商批量生成**是 vutu 尚缺且有直接产品价值的功能。本方案按**清洁室方式**（只参考功能行为与交互规格，不复制其 AGPL 代码）给出 vutu 侧的改造设计。

**范围内**

| # | 功能 | 优先级 | 分期 |
|---|---|---|---|
| F1 | 提示词优化（AI 改写） | P0 | A |
| F3 | 积分兑换码（密钥生成 + 兑换） | P0 | A |
| F2 | 反推提示词（图片 → 提示词） | P1 | B |
| F4 | 灵感广场：用户发布 + 管理审核闭环 | P1 | B |
| F5 | 电商模板批量生成 | P1 | C |
| F6 | 邀请奖励 | P2 | D |

**范围外（不抄）**：Linux.do OAuth / Linux.do 支付通道（社区专属，vutu 已有 Google JWKS + 自建支付 Phase 2）、Go/MySQL/Vue 栈、独立 admin SPA、任务轮询（vutu 已是 SSE+轮询，更优）、i18n（vutu 11 语 > 其 2 语）、画布实现（对方也仅在 roadmap，只借鉴其规格：图层/局部重绘/自由拼接）。

---

## 1. 取证：vutu 可复用资产（写方案前逐项核对过源码）

| 资产 | 代码位置 | 本方案用途 |
|---|---|---|
| `LEDGER_TYPES` 冻结 9 类，**含 `promo`** | `core/types.ts:233` | F3/F6 入账零契约变更；F1/F2 扣费走 R1 新增类型 |
| `ledger.grant/deduct` 冻结签名 + P2002 幂等重放 | `CONTRACT.md` §ledger、`billing/ledger.ts` | `spend()` 照搬同款裁决模式 |
| `PromptPost/Tab/PostEvent` 表**已存在**（views/likes/copies + 唯一键日去重） | `schema.prisma:554-598` | F4 只需加 `status/createdBy/rejectReason` 三列 |
| `Task` 表无 `batchId` | `schema.prisma:256` | F5 加一列 + 索引 |
| 审核：L1 blocklist + L2 fail-open，**L2 替换点已标注 = `LK888 /v1/chat/completions`** | `moderation/index.ts:11,186` | F4 发布前审核复用；chat client 同时解锁 Phase 2 L2 真调用 |
| 匿名限频模式（IP+事件+日，429 带 retryAfter） | `prompts/routes.ts:14` | F1/F2 限频语义对齐 |
| `adminGuard`/`verifyAdminToken`（常量时间比较）+ `AdminAuditLog` | `admin/routes.ts` | F3 生成、F4 审核接口复用鉴权与审计 |
| 图片 base64 ≤10MB 上游允许（视频才必须公网 URL） | `providers/validate.ts`、lk888 文档 | F2 图片入参走 base64（免 URL 过期） |
| `PlanView.maxConcurrency` 随 auth/me 下发 | `core/types.ts` | F5 前端并发上限 |
| `TaskListPane`（2026-09-22 上线：hydrate+缓存+15s 轮询） | `ai-cloner/.../TaskListPane.tsx` | F5 批量分组、F4「发布」按钮宿主 |
| `MOCK_PROVIDER=true` 绝不真连上游（CI 铁律） | `server/README.md` | chat client 必须遵守 |
| `assets batch-delete` 逐项独立语义 | `assets/routes.ts` | F5 单项失败不中断的先例 |

**⚠️ 关联发现**：`serializeTaskListRow`（`tasks/service.ts:91`）**不下发 prompt/params**，TaskListPane 被迫逐行 hydrate（20 行 = 40 请求）。本方案 §10 顺手在列表序列化补 `prompt/params/batchId`，**一次修复两个问题**（也消除 vutu-web `TaskSummary.prompt` 永远为空的隐患）。

---

## 2. 总体设计

### 2.1 新增唯一共享组件：LK888 Chat Client

```
src/modules/providers/chat.ts
export interface ChatInput {
  system?: string;          // 优化指令 / 反推指令 / 审核指令
  prompt: string;           // 用户输入（调用方负责截断）
  imageUrl?: string;        // 视觉调用：data:image/...;base64, 优先；回退公网 URL
  maxTokens?: number;
  timeoutMs?: number;       // 默认 15000
}
export async function chatOnce(input: ChatInput): Promise<{ text: string; latencyMs: number }>
```

- 端点 `${LK_BASE_URL}/v1/chat/completions`（与 `moderation/index.ts:11` 标注的 Phase 2 替换点**同一端点**，一份实现三处受益）
- **`MOCK_PROVIDER=true` 时返回固定样例文本，绝不发请求**（测试/CI 零上游费用）
- 未设置 `LK_CHAT_MODEL` 且非 mock 时 **fail-fast** 抛配置错误（模型名不做臆测默认值，`.env.example` 注明）
- 超时15s，超时重试 1 次；请求构造/响应解析各收敛到一个函数，**真实 key 实测一次后在 `tests/contract/` 用 nock 固化**（仿 `lingke.contract.test.ts`）

### 2.2 三条设计铁律

1. **`core/**` 冻结面只做已获批的加法**：R1 修订（§9）新增 `service_deduct` 与 `spend()` 均为**加法**，不改任何既有导出签名；错误优先复用既有 `err.*` 工厂。
2. **所有 LLM 输出进业务路径前必过既有审核**：F1 优化结果在任务提交时走既有前置审核；F4 标题在发布时走 `moderation.check`。
3. **AGPL 清洁室**：只按接口行为、数据结构与交互规格重写，不复制对方任何代码；出处见文首链接。

---

## 3. F1 · 提示词优化（P0，分期 A）

**接口** `POST /v1/prompts/optimize`（auth 必需，Header `Idempotency-Key` 可选）

```jsonc
// 请求
{ "prompt": "string(1..2000)" }
// 200
{ "optimized": "string", "credits": 1, "latencyMs": 812 }
```

**流程（扣费顺序，D1 决议）**：

```
限频(分钟/日) → 输入截断2000 → 预检余额(不足 402，先于上游调用)
  → chatOnce({system:优化指令, prompt})   ← 失败/超时则不扣费，直接上抛
  → ledger.spend(type:'service_deduct', idempotencyKey: Idempotency-Key)
  → 返回 { optimized, credits }
```

- **charge-after 而非 charge-then-refund**：避免为一次 15s 的 LLM 调用引入退费机器。竞态说明：预检与 spend 之间存在极小窗口，`spend()` 内部 `WHERE balance >= amount` 条件更新兜底——窗口内被别人花光则该次**不扣费也不返回**（502+可重试），配合每分钟限频窗口，损失上界可控且不破坏 SUM(delta) 不变式。
- **幂等**：`Idempotency-Key` 缺省服务端生成；重放（P2002 on `(userId, idempotencyKey)`）返回原扣费结果不重复扣。
- 优化指令要点（自撰）：保留用户语义与主体、补充镜头/光线/风格细节、输出与输入同语言、**不做内容安全判定**（安全由提交时 moderation 负责）。
- **金额**：`PROMPT_OPTIMIZE_CREDITS`（默认 **1**，模块内 `process.env` 解析，不动 `core/config`；`.env.example` 追加注释行）。
- **限频**：`PROMPT_OPTIMIZE_PER_MIN`（默认10）+ `PROMPT_OPTIMIZE_PER_PER_DAY`（默认100）/用户；超限 429 复用 `err.rateLimited(retryAfter)`。单实例内存滑动窗（api 当前单容器部署），多实例化时换 Redis——留注释说明。

**前端落点**

| 端 | 位置 | 交互 |
|---|---|---|
| vutu-web（/studio/） | `Composer` 提示词工具行 | ✨按钮 → pending 转圈 → 回填 textarea；402/429 toast，不清空原文 |
| ai-cloner `ToolComposer` / `AppHomePage` / `HeroComposer` | 提示词框工具行 | 同上 |

API client：`vutu-web/src/lib/api.ts` 与 `ai-cloner/src/lib/api/resources.ts` 各加 `promptsApi.optimize()`（两套 client 并存是现状，各自维护）。

---

## 4. F2 · 反推提示词（P1，分期 B）

**接口** `POST /v1/prompts/reverse`（auth 必需）

```jsonc
{ "assetId": "uuid" }                    // 请求
{ "prompt": "...", "assetId": "...", "credits": 2, "latencyMs": 1450 }   // 200
```

- **校验**：`asset.userId === user` 否则 404（不泄露存在性，对齐 assets 模块）；upload/output 均可（参考图也能反推）
- **图片入参**：读 MinIO → `data:image/*;base64,`（优先，上游允许 ≤10MB，彻底规避 URL 过期）；>10MB 回退**交付 URL**（4h 足够单次调用，绝不下发 15min 浏览 URL）
- **指令**（自撰）：输出可复现该图的生成提示词（主体/构图/风格/光线/镜头/负向词），纯文本、语言随 `Accept-Language`（复用 `parseAcceptLanguage`）
- 结果**不入库**（会话态）；回填 composer 后提交时仍走既有 moderation
- **计费（D1）**：`PROMPT_REVERSE_CREDITS`（默认 **2**，视觉调用更贵），机制与 F1 完全一致（预检→上游→spend）；限频 `PROMPT_REVERSE_PER_MIN=6` / `PROMPT_REVERSE_PER_DAY=60`

**前端落点**：vutu-web `ResultFeed` 卡片「反推提示词」+ `Composer` 参考图旁「从参考图提取」；ai-cloner `TaskListPane` 行第 6 图标、`WorksGallery` 卡片操作、`AppHomePage` 参考图预览区；回填统一 `setPrompt` + toast「已填入，可编辑后生成」。

---

## 5. F3 · 积分兑换码（P0，分期 A）

**新表**：

```prisma
model RedeemKey {
  id           String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  codeHash     String    @unique @map("code_hash")   // sha256(code)，不存明文（对齐 adminKeyFingerprint 教训）
  batchId      String    @map("batch_id")
  credits      Int
  note         String?
  expiresAt    DateTime? @map("expires_at") @db.Timestamptz
  redeemedById String?   @map("redeemed_by_id") @db.Uuid
  redeemedAt   DateTime? @map("redeemed_at") @db.Timestamptz
  createdBy    String    @map("created_by")
  createdAt    DateTime  @default(now()) @map("created_at") @db.Timestamptz
  @@index([batchId])
  @@map("redeem_keys")
}
```

**接口**

| Method | Path | Auth | 说明 |
|---|---|---|---|
| POST | `/v1/billing/redeem` | user | `{code}`；**条件更新** `WHERE redeemed_by IS NULL`（0 行 → 409 已被兑，防双花——与 `ledger.refundTask` 唯一裁决点同思路）→ 同事务 `ledger.grant({type:'promo', amount, idempotencyKey:'redeem:'+hash前16, tx})` → `{credits, balanceAfter}`；过期 422 |
| POST | `/v1/admin/redeem-keys` | admin | `{count, credits, expiresInDays?, note?}` → `VUTU-XXXX-XXXX-XXXX`（Crockford base32 防误输，20 位≈60bit 熵），**明文仅此一次返回**，DB 只存 sha256 |
| GET | `/v1/admin/redeem-keys?batchId=` | admin | 批次统计：total/redeemed/pending |

- 归属：credits 语义归 **billing 模块**（CONTRACT 归属表），admin 生成挂 `app.requireAdmin`（admin 模块已幂等 decorate，跨模块复用是既定模式）
- 兑换积分**不过期**（`expiresAt` 留列供未来批次策略），note 记批次用途

---

## 6. F4 · 灵感广场：发布 + 审核闭环（P1，分期 B）

**Migration**（PromptPost 加列，存量 seed 行默认 published 不刷数据）：

```prisma
status       String  @default("published")  // pending | published | rejected
createdBy    String? @map("created_by") @db.Uuid
rejectReason String? @map("reject_reason")
```

**接口**

| Method | Path | Auth | 说明 |
|---|---|---|---|
| POST | `/v1/prompt-library` | user | `{tabCode, title(1..2000 = 提示词全文，对齐 title 即可复制内容的既有语义), assetId}` → ①asset 归属（非本人 404）②`moderation.check({prompt: title})` 违规422 ③**`PROMPT_AUTO_APPROVE=true`（D3 决议默认）→ published**，false → pending → 201 |
| DELETE | `/v1/prompt-library/:id` | user | 仅 `createdBy === user` 撤回自己的 pending/published；他人 403 |
| GET | `/v1/prompt-library/:id/image` | optional | **稳定图片路由**（见6.1），限频同 view 档 |
| GET | `/v1/admin/prompt-posts?status=pending` | admin | 待审列表（`Page<T>` 分页） |
| POST | `/v1/admin/prompt-posts/:id/approve` \| `/reject` | admin | pending→published / pending→rejected（+rejectReason），写 `AdminAuditLog`；**published→rejected 也允许（事后下架）** |

- `listLibrary()` 恒过滤 `status='published'`——未审内容绝不进首页（autoApprove=false 时生效；D3=true 时主要兜 `reject` 后状态与人工下架）
- env：`PROMPT_AUTO_APPROVE`，**默认 `true`**（D3 决议：标题已过 L1/L2，发布即可见，admin 保留驳回/下架能力）

**6.1 稳定图片路由（关键正确性，吸取 2026-09-22 生图不显示教训）**

- `PromptPost.imgUrl` **不能存 15min 预签名 URL**：SSR/浏览器缓存拿到即开始倒计时，过期后首页卡片全挂——"预签名 URL 不得进静态内容"的同族问题
- 方案：`imgUrl` 存**相对键** `pp/<postId>`；`GET /v1/prompt-library/:id/image`（optionalAuth）按 postId→assetId→重新签发流式转发；前端 `src` = 站点绝对地址 + 该路由（与 SSE 同源拼法）
- **不采用**：把 output asset 改公开读——违背"三类 URL 分权"契约

**前端**：`TaskListPane` 行第 6 图标「发布到广场」（取首图 assetId + prompt → POST → toast「已发布」/「已提交审核」，pending 行灰标）；`WorksGallery` 卡片同款；首页 `PromptLibrary` 区块零改动自动混入已发布 UGC。

---

## 7. F5 · 电商模板批量生成（P1，分期 C）

**Migration**：`Task` 加 `batchId String?` + `@@index([userId, batchId])`。

**接口：不新增 batch endpoint**（设计决策）

- create body 允许可选 `batchId`（校验 `^b_[A-Za-z0-9_-]{6,40}$`），其余完全走既有 `POST /v1/tasks`（quote→deduct→enqueue 原子链不变），idempotencyKey 客户端按 `b:<batchId>:<n>` 生成
- **为什么不建批量原子接口**：CONTRACT 固化的幂等/退费模型是"一任务一扣一退"；单请求建 N 任务会把部分失败/部分退款裁决塞进新事务语义，风险远大于收益。客户端扇出 = **零新不变式**，复用已验证路径
- 失败语义对齐 `assets batch-delete`：**逐项独立**，单项 402/422 不影响其余，前端逐项 toast

**前端（vutu-web studio 为主战场）**：批量面板（模板 `catalogApi.templates` × 多参考图 × 数量 N × 参数）；**信号量并发 = `plan.maxConcurrency`**（auth/me 已下发，主动排队而非靠上游限流）；`TaskListPane` 按 batchId 分组渲染组头卡（`批量 3/8 · 失败 1` + 整组进度条），组内沿用现有行，无 batchId 行为不变，统计口径不变，SSE 每任务一 stream 不变。

---

## 8. F6 · 邀请奖励（Phase D 概要，本期不做）

- 邀请码 = `User.publicId`（不加列）；register/set-password 可选 `inviteCode`
- 校验：非自邀 + 新注册 + `signup-risk` 信号 + Redis `invited:<ip>:<day>` 去重
- 入账：双方各 `ledger.grant({type:'promo'})`，邀请人日上限 `INVITE_REWARD_MAX`（默认50）
- 风控：xiaoye 靠 Linux.do 社区身份抗刷，vutu 只能靠风险信号+日上限；**建议次日发放**（复用签到 nextGrantAt 思路）→ 开放问题 D 期定夺

---

## 9. 数据模型与契约变更

**Migrations（4 个文件，deploy.sh 自带 migrate deploy）**

1. `prompt_posts` += `status` / `created_by` / `reject_reason`
2. `tasks` += `batch_id` + `(user_id, batch_id)` 索引
3. 新表 `redeem_keys`
4. 无 core 数据面其他改动

**契约修订 R1（加法，不破坏既有签名）**

| 文件 | 变更 |
|---|---|
| `core/types.ts` | `LEDGER_TYPES` += `'service_deduct'`（union 扩大；ledger 层只透传 type，无 exhaustive 消费方） |
| `billing/ledger.ts` | `LedgerApi` += `spend({userId, type, amount, idempotencyKey, note?, tx?}) => {balanceAfter}`：P2002 重放返回原结果 + `WHERE balance >= amount` 条件更新 + `delta=-amount`，严格保持 `余额=SUM(delta)` |
| `.env.example` | 追加 F1/F2/F4 新 env 注释行（非 core，可直接改） |

**新 env（全部模块内解析，不动 `core/config`）**：`PROMPT_OPTIMIZE_CREDITS=1`、`PROMPT_REVERSE_CREDITS=2`、`PROMPT_OPTIMIZE_PER_MIN=10`、`PROMPT_OPTIMIZE_PER_DAY=100`、`PROMPT_REVERSE_PER_MIN=6`、`PROMPT_REVERSE_PER_DAY=60`、`PROMPT_AUTO_APPROVE=true`、`LK_CHAT_MODEL`（真实模式必填，fail-fast）

## 10. API 变更汇总

**新增（11）**

| Method | Path | Auth |
|---|---|---|
| POST | `/v1/prompts/optimize` | user |
| POST | `/v1/prompts/reverse` | user |
| POST | `/v1/billing/redeem` | user |
| POST | `/v1/admin/redeem-keys` | admin |
| GET | `/v1/admin/redeem-keys` | admin |
| POST | `/v1/prompt-library` | user |
| DELETE | `/v1/prompt-library/:id` | user(creator) |
| GET | `/v1/prompt-library/:id/image` | optional |
| GET | `/v1/admin/prompt-posts` | admin |
| POST | `/v1/admin/prompt-posts/:id/approve` | admin |
| POST | `/v1/admin/prompt-posts/:id/reject` | admin |

**修改（2，向后兼容）**

| Path | 变更 |
|---|---|
| POST `/v1/tasks` | body + 可选 `batchId`（严格格式校验） |
| GET `/v1/tasks` | `serializeTaskListRow` += `prompt`（全量，前端 truncate）/ `params` / `batchId` —— **根治 TaskListPane 逐行 hydrate 的 40 请求问题** |

归属对照 CONTRACT §4：`prompts/*`→prompts、`billing/redeem`→billing（credits 语义）、`admin/*`→admin（credits/users 例外归 billing 的既有约定继续遵守）；均为既有 RouteModule 内加注册，`main.ts` 挂载清单零改动。

## 11. 前端改动清单

**vutu-web（/studio/ 主战场）**：`lib/api.ts` +`promptsApi.optimize/reverse`、tasks 传 batchId；`Composer` ✨优化 + 参考图「反推」；`ResultFeed` 行「反推」「发布到广场」；新增 `BatchPanel`（模板 × N 参考图 × 参数，信号量 = maxConcurrency）。

**ai-cloner（营销站 + /{lang}/app）**：`resources.ts` +optimize/reverse；`ToolComposer`/`HeroComposer`/`AppHomePage` 优化按钮（同一交互组件复制不合并，保持各页独立演进）；`TaskListPane` ①batchId 分组卡头 ②第6图标「发布到广场」③列表接口补 prompt 后 hydrate 层简化（保留缓存兼容旧后端）；`WorksGallery` 反推+发布入口；首页广场区块零改动带 UGC。

两套 API client 并存是现状，各自加方法、不强行合并（合并属另立项）。

## 12. 安全与风控

| 面 | 措施 |
|---|---|
| LLM 成本 | 每接口独立限频（分钟+日）+ 输入截断2000 + 图片≤10MB base64 + 15s 超时 + 余额预检先于上游 |
| 扣费正确性 | charge-after（上游失败不扣费）+ `(userId, idempotencyKey)` P2002 重放 + `balance>=amount` 条件更新；竞态窗口内未扣费则该次不返回（可重试），不产生负余额 |
| 输出进业务 | F1 输出→提交时 moderation（既有）；F4 标题→发布时 moderation（新增，fail-open 语义与任务一致） |
| 兑换码 | 只存 sha256、条件更新防双花、明文仅生成响应返回、admin 全挂 requireAdmin + AdminAuditLog |
| 广场 | 非本人资产404、发布审核开关、管理操作全审计、图片走稳定路由（不泄露预签名） |
| 批量 | 前端并发 ≤ maxConcurrency、逐项独立失败、batchId 严格校验 |
| 通用 | MOCK_PROVIDER 下 chatOnce 返回样例零上游；新增路由全部进限频配置表；限频单实例内存实现注明多实例迁移路径 |

## 13. 测试计划（按仓库测试金字塔）

- **unit**：chatOnce(mock 样例/超时重试)、优化/反推指令构造与截断、限频窗口、spend 幂等（P2002 模拟）与余额守卫、code 生成/hash/过期、batchId 校验、发布状态机、图片路由 asset 归属
- **contract**：`/v1/chat/completions` nock 固化（仿 `lingke.contract.test.ts`；真实 key 实测一次后录制）
- **integration**（真 PG/Redis）：兑换码双花 409、发布→autoApprove=true 即列表可见 / false 需 approve、admin reject 后首页不可见、批量并发 ≤ max、optimize 预检 402 先于上游、reverse 越权404、GET /v1/tasks 新字段形状
- **e2e**：优化 prompt → 提交 → 成功 闭环（MOCK_PROVIDER=true）
- **不花钱保证**：MOCK_PROVIDER=true 时 chatOnce 返回固定样例，CI 永不触达 LK888

## 14. 分期与工作量（D2 决议：本期 A+B+C 全做）

| 期 | 内容 | 估时 |
|---|---|---|
| **A** | R1 契约修订 + chat client + F1 优化 + F3 兑换码（migrations #3、admin 生成、前后端、测试） | 2-3 天 |
| **B** | F2 反推 + 稳定图片路由 + F4 后端（migrations #1、发布/审核、listLibrary 过滤）+ 发布按钮 | 3-5 天 |
| **C** | F5 批量（migrations #2、batchId 透传、列表补 prompt/params、TaskListPane 分组、vutu-web 批量面板） | 2-3 天 |
| **D** | F6 邀请奖励 + 审核 UI + Phase 2 L2 真调用 + 出站代理 | 另排期 |

部署：全部走 `_deploy.py backend` → `deploy.sh`（含 migrate deploy）；前端 `vutu-web/deploy/deploy.py` / `_deploy.py frontend`。**一律单次串行执行**（2026-09-23 教训：并行部署曾致 SFTP/构建锁竞争）。

## 15. 决议记录（原开放问题，已全部拍板）

| 原问题 | 决议 |
|---|---|
| F1/F2 计费 | **D1：账本扣积分**（R1 契约修订，见 §3.1/§9） |
| `PROMPT_AUTO_APPROVE` | **D3：默认 `true`**，发布即上首页，admin 驳回/下架能力保留 |
| 本期范围 | **D2：A+B+C 全做**，D 期另排 |
| 邀请奖励发放时机 | 留到 D 期开工时定（即时 vs 次日） |
| LK888 chat 报文/图片入参 | 实现期真实 key 实测一次 → nock 固化；设计已按 base64≤10MB 优先 + 交付 URL 回退双分支实现，实测不符只需调 `buildChatRequest` 单点 |

## 16. 法务红线

xiaoye-ai 为 **AGPL-3.0**：将其任何代码片段直接并入 vutu 闭源部署会触发传染性开源义务。本方案全部功能均为**清洁室重写**——参考其接口形状、字段语义与交互设计，不复制代码文件；优化/反推 system prompt 为自撰；本文引用其仓库地址与功能名作为出处。若未来发现实现趋同，以本方案文档 + vutu 自有测试为准留痕。
