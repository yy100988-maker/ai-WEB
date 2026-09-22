# Vutu 后端服务需求文档（PRD）

> **v0.5 变更**：**18 视频模型全量实测入库**（7 文生 + 11 图生位，含 grok 改名 GK 系、omni 系 4 模型）：① §6.3 视频价目表改为"各模型原生时长档"（hailuo/wan3.0/minimax 按秒计费实测价替换估算）；② 新增视频模型能力矩阵（时长/分辨率/参考输入/有声/成功率/出片耗时）；③ §5.4 参数映射扩展 8 个新模型；④ `GenerationRequest.params` 改为开放键值（以 catalog 下发的 options 为准）；⑤ 明确 costUnits 三口径计算规则。
>
> **v0.5.1 修订**（跨文档评审，与详细设计 v0.4 同步）：渠道回调接口改标 Phase 2 预留（本期纯轮询）；`cancel` 语义明确（上游不支持也本地终态 + 全额返还）；错误码表按 HTTP 排序并补 `UNFETCHABLE_URL`。
>
> **v0.4 变更**：**定价简化为 cost×1.3**（固定 30% 毛利），公式 `credits = ceil(costUnits × 18.84)`。图片表增加 `tt-image-2`/`tt-image-2.5` 系列（成本低至 1 积分/张）。新增每日 2 次自动同步上游价格并重算积分（`price_sync_log`）。
>
> **v0.2 变更**：已确认首期生成渠道为 **灵客 AI（墨然AI / LK888）聚合网关**，并完成真实 POC 验证（视频生成成功、LLM 调用成功）。能力清单见 `docs/lk888-capabilities.md`。

| 项 | 内容 |
| --- | --- |
| 文档版本 | **v0.5** |
| 状态 | 待评审 |
| 关联前端 | `ai-cloner/`（vutu AI 创作平台 1:1 复刻，Next.js 16 + React 19 + Tailwind v4） |
| 首期范围 | 核心闭环：账号 + 积分 + 任务 + 资产 + 订阅 |
| 关键要求 | 多渠道、多模型、可计费的生成能力 |
| 生成渠道 | **灵客 AI / LK888**（`https://api.lk888.ai/api`），已实测 |
| 定价体系 | **成本×1.3（固定 30% 毛利），每日 2 次同步上游价格自动重算积分** |

---

## 0. 定价体系速览

```
公式：credits = ceil(上游成本(算力≈RMB) × 1.3 × 100 ÷ 6.9)
      即：credits = ceil(costUnits × 18.84)
```

| 汇率 | 1 USD = **6.9** RMB，1 USD = **100** 积分（1 积分 ≈ ¥0.069） |
| --- | --- |
| 毛利 | 固定 30%（成本 ×1.3），通过每日 2 次同步自动跟随上游调价 |
| 同步 | 每日 02:00 / 14:00 自动调 `/v1/skills/models/{name}/pricing` 重算积分 |
| 保护 | 成本变化超 20% → 告警；成本 > 售价 → 自动禁用该模型 |
| 双账本 | `credit_ledger`（用户积分）与 `task_costs`（上游成本）**永不互相换算** |

---

## 1. 背景与目标

### 1.1 现状

前端已完成 vutu（AI 多模态创作平台）的 1:1 复刻，覆盖 11 种语言、首页、工具页（text-to-video / image-to-video）、定价页、以及 App 工作台（AI 视频 / 图像 / 音频 / 画布 / 编辑器 + 爆款工作室 / 口播虚拟人 / 视频翻译 + 资产 / 探索 / 支持 / 语言）。

当前所有交互均为**前端 mock**，无服务端：

| 前端文件 | Mock 行为 | 需要的后端能力 |
| --- | --- | --- |
| `HeroComposer.tsx` | `setInterval` 假进度条，随机 +6~20%，320ms/tick | 真实任务提交 + 进度查询 |
| `ToolComposer.tsx` | `setTimeout` 2200ms 后直接 `done=true` | 任务状态机 + 结果回传 |
| `AppHomePage.tsx` | `create()` 空跑进度到 100% | 任务队列 + 并发/配额校验 |
| `AppHomePage.tsx` 侧栏 | 硬编码 `planName="免费方案"`、积分为 `0` | 订阅/积分账户查询 |
| `SiteHeader.tsx` | `login` / `startFree` 无跳转目标 | 认证与注册 |
| `AppHomePage.tsx` 创作记录 | Filter 全部/视频/图片/音频，无数据 | 历史任务列表 + 筛选 |
| `AppHomePage.tsx` 资产视图 | 4 个占位色块 | 资产库 CRUD |
| 上传控件 | `accept="image/*,video/*,audio/*"` 仅取文件名 | 对象存储直传 + 资产登记 |
| `proxy.ts` | Cookie `vutu-locale` + Accept-Language 重定向 | 用户语言偏好持久化（远期） |

**核心差距**：前端"看起来能生成"，实际没有任何服务端状态。用户刷新即丢失全部结果。

### 1.2 目标

构建一套后端服务，支撑"注册 → 领点数（签到/赠送/运营发放） → 提交生成 → 扣点 → 取回成片 → 管理资产"的完整商业闭环，并具备：

1. **多渠道、多模型**：同一能力（如 text-to-video）下可挂多个模型（海螺 H3 / 万相 3.0 / Seedance 2.5 / MiniMax H3 / PixVerse / 快乐马…），可按策略路由、可热切换、可灰度。**首期统一经灵客 AI（LK888）聚合网关接入**，保留直连其他厂商的扩展位。
2. **可计费**：按模型 + 参数（分辨率/时长/画质）差异化计价，支持提交即扣减、失败即返还的账本语义，避免超卖与重复扣费。**必须兼容平台的三种计费口径（按次 / 按 token / 按秒）**。
3. **可运营**：模型健康度、成本、成功率可观测；渠道异常自动降级。

### 1.2.1 渠道已确认（2026-09-14 实测）

| 项 | 结论 |
| --- | --- |
| 渠道 | 灵客 AI（墨然AI / LK888），聚合网关 |
| 基础地址 | `https://api.lk888.ai/api` |
| 认证 | `Authorization: Bearer {API Key}` |
| 余额 | 60.31 算力（POC 后） |
| 当前渠道策略 | 价格优先（可在 Key 管理页改） |
| 模型规模 | 视频 74 / 图片 19 / 音频 7 / 语言模型 68 / 音色 368 |

**已完成 POC**：
- 视频生成 `viduq3`（540p/4s/turbo/错峰）→ 61 秒完成，**实扣 0.2753 算力**，产出 mp4
- LLM 调用 `tt-5.4-mini` → 正常返回，42 tokens

详见 `docs/lk888-capabilities.md`。

### 1.3 非目标（首期不做）

- 自研/微调模型、自持 GPU 推理集群
- 运营后台界面（后续迭代；本期只提供 API 与数据模型）
- CMS 内容管理后台（FAQ、定价文案、模板库继续由前端 i18n 文件承载）
- 内容审核后台、社交/分享、团队协作与企业版权限
- 视频编辑器（Canvas / Editor）的协同编辑与实时时间线存储

---

## 2. 术语

| 术语 | 定义 |
| --- | --- |
| **Capability（能力）** | 前端可见的生成能力单元，如 `text_to_video`、`image_to_video`、`text_to_image`、`text_to_audio`、`tts`、`avatar_talk`、`video_translate` |
| **Channel（渠道）** | 一个供应商接入，如 `openai`、`google-veo`、`replicate`。含凭据、限流、健康检查配置 |
| **Model（模型）** | 渠道下的具体模型 + 版本，如 `hailuo-h3`、`hailuo-h3-quannengcankao`、`gk-video-3`。绑定能力、计价、参数约束 |
| **Provider Adapter（适配器）** | 将统一内部请求翻译为某渠道 API 调用的代码单元，实现 `GenerationProvider` 接口 |
| **Task（任务）** | 一次生成请求的全生命周期记录，含状态机、参数、结果、计费流水 |
| **Asset（资产）** | 用户上传的源文件或生成产物，存于对象存储，有 URI、元信息、归属 |
| **Credit（积分/点数）** | 计费单位。1 USD = 100 积分，1 积分 ≈ ¥0.069。**用户侧唯一计价单位** |
| **算力（cost unit）** | **上游 LK888 的内部成本单位（RMB 口径）**，仅用于成本核算与毛利分析，**绝不对外展示，也不参与用户计费** |
| **SKU** | 对外计价单元，由"能力 + 模型 + 规格"组成，如 `text_to_video / hailuo-h3-quannengcankao / 1080p / 10s`，对应 `price_items` 表一行 |
| **Ledger（账本）** | 积分变动的只追加流水表，所有余额由流水聚合得出 |
| **Deduct（提交扣减）** | 任务提交时直接扣减报价积分；成功无二次操作，失败/取消/超时全额返还 |

---

## 3. 技术栈选型：详细分析与对比

### 3.1 候选方案

| # | 方案 | 形态 | 一句话描述 |
| --- | --- | --- | --- |
| **A** | **Next.js 16 Route Handlers + TypeScript**（同仓 BFF） | 与前端同仓库、同进程 | 在现有 `ai-cloner` 中加 `src/app/api/**`，复用 Next 的构建与部署 |
| **B** | **独立 Node 服务（NestJS）+ TypeScript** | 独立进程/仓库 | DDD 分层 + DI + 装饰器，企业级约定 |
| **C** | **独立 Node 服务（Fastify）+ TypeScript** | 独立进程/仓库 | 轻量、性能高、显式路由，无框架魔法 |
| **D** | **Python FastAPI** | 独立进程/仓库 | 贴近 ML 生态，异步原生，便于后期自研模型 |
| **E** | **Hono + Node/Bun** | 独立进程/仓库 | 极轻量、Web 标准 API、可跑边缘 |

### 3.2 逐维度对比

| 维度 | A. Next Route Handlers | B. NestJS | C. Fastify | D. FastAPI | E. Hono |
| --- | --- | --- | --- | --- | --- |
| **与现有前端集成成本** | ★★★★★ 零新增部署单元，同仓同栈，直接复用 `site-data.ts` 的类型 | ★★☆ 需独立仓库/CI/域名 | ★★☆ 同 B | ★★☆ 同 B | ★★☆ 同 B（可同仓不同进程） |
| **长任务/队列适配** | ★★☆ Serverless 有执行时长上限；需外置 Worker，BFF 只做提交 | ★★★★★ 天然常驻进程，同一 codebase 内跑消费者 | ★★★★★ 同 B | ★★★★★ 同 B | ★★★☆ 常驻 OK，但边缘运行时不适合 |
| **多渠道适配器抽象** | ★★★☆ TS interface 足够，但缺 DI，需手写工厂 | ★★★★★ DI + Module + Provider 天然匹配"可插拔渠道" | ★★★★ 显式注册，清晰可控 | ★★★★ Pydantic + 依赖注入够用 | ★★★☆ 同 C，但生态薄 |
| **计费/账本（强事务）** | ★★★☆ 依赖 ORM 事务，与页面同进程有资源争抢风险 | ★★★★★ 独立服务可独立伸缩，事务边界清晰 | ★★★★★ 同 B | ★★★★★ 同 B | ★★★★ 同 B |
| **类型与前端共享** | ★★★★★ 同一份 TS 类型，`zod` schema 前后端复用 | ★★★★ 需 monorepo / shared package 才能共享 | ★★★★ 同 B | ★★ 需 codegen 或重复定义 | ★★★★ 同 B |
| **Webhook 回调（供应商异步通知）** | ★★★☆ 可做，但冷启动影响回调时延 | ★★★★★ 常驻，稳定 | ★★★★★ 常驻，稳定 | ★★★★★ 常驻，稳定 | ★★★★ 常驻 OK |
| **部署与运维复杂度** | ★★★★★ 最低（Vercel 一键） | ★★★ 需容器编排 | ★★★★ 轻量容器 | ★★★ 需容器 + Python 栈 | ★★★★ 轻量容器 |
| **性能（HTTP 吞吐）** | ★★★☆ 受 Next 运行时约束 | ★★★★ Express/Fastify 底层 | ★★★★★ Node 中最高一档 | ★★★★ 异步原生，够用 | ★★★★★ 极快 |
| **生态：队列/ORM/鉴权库** | ★★★★ Node 生态通用 | ★★★★★ 官方模块齐全 | ★★★★ 插件丰富 | ★★★★ Bull 需 Node，Python 侧用 Celery/ARQ | ★★★☆ 生态较新 |
| **团队上手成本** | ★★★★★ 前端同学即可写 | ★★★ 需学装饰器/DI/Module | ★★★★ 概念少 | ★★ 语言切换成本 | ★★★★ 概念少 |
| **未来接 ML/自研模型** | ★★☆ | ★★☆ | ★★☆ | ★★★★★ Python 生态天然优势 | ★★☆ |
| **成本（首期人力）** | 最低 | 中 | 中 | 较高 | 中 |

### 3.3 关键约束分析

**（1）生成任务是长任务，这是首要架构约束。**

视频生成供应商的典型耗时是 **30 秒 ~ 数分钟**（Sora/Veo/Hailuo 均在此量级），且绝大多数为**异步 API**：提交拿 `job_id`，再轮询或等 webhook。这意味着：

- 不能在 HTTP 请求内同步等待结果；
- 必须有**持久化任务表 + 独立 Worker** 做轮询/回调处理；
- 必须有**进度查询接口**供前端轮询或 SSE 推送。

→ **A 方案（Next Route Handlers）在 Serverless 部署下有函数执行时长上限（Vercel Hobby 60s / Pro 300s），无法承载 Worker 轮询。** 若坚持 A，必须额外部署一个常驻 Worker 进程——那"零新增部署单元"的优势就不复存在了。若部署为长期运行的 Node 容器（`next start`），A 也可行，但把 CPU 密集的轮询调度与页面渲染挤在同一进程，资源争抢风险高。

**（2）"多渠道 + 可插拔"需要清晰的依赖注入边界。**

你的核心诉求是"多渠道、多模型"。这意味着 `GenerationProvider` 会有 10+ 个实现，每个实现有自己的凭据、限流、参数映射、错误码映射。这天然需要一个 **Registry + 工厂 + 配置驱动的路由层**。

- NestJS 的 DI + Module 系统开箱即用，最适合表达"一堆可替换的 Provider"；
- Fastify 需手写注册，但代码量不大且完全可控；
- Next Route Handlers 没有 DI，需自建工厂（可行但略糙）。

**（3）计费是金融语义，需要强事务与独立伸缩。**

"提交即扣、失败即返"的账本必须保证：不超卖、不重复扣、失败必返。这部分逻辑应该在一个**能独立部署、独立伸缩、事务边界清晰**的服务里，而不是和页面渲染混在一起。

**（4）Python 的价值在"未来"，代价在"现在"。**

FastAPI 的最大优势是贴近 ML 生态。但本期是**接第三方 API**（HTTP 调用），不是自研推理——Python 在这个场景下没有实质加成，反而引入：语言/工具链切换、前端类型无法共享（需 codegen 维护双份）、Node 生态里现成的 `better-auth`/`prisma`/`bullmq` 需换成 Python 对应物。**建议把 "未来是否自研模型" 作为独立决策点，如果 6 个月内无自研计划，不应为它预付成本。**

### 3.4 推荐结论

> **推荐：C 方案 —— 独立 Node 服务（Fastify + TypeScript），与前端同仓（`apps/api` + `apps/web`，或最小化为 `server/` 目录）。**

理由：

1. **长任务与 Worker 是刚需**，独立常驻进程是唯一干净解法；Fastify 作为常驻服务，提交、webhook、轮询 Worker 可在同一 codebase 内以不同入口启动（`api` / `worker`）。
2. **Fastify 相对 NestJS 更轻**：NestJS 的 DI/装饰器体系在"10+ 个 Provider 适配器"场景确实优雅，但带来较重的框架心智与样板代码；Fastify + 一个显式 `ProviderRegistry`（约 100 行）+ `zod` 校验，足以表达同样的可插拔性，且调试链路短、启动快。
3. **TypeScript 全栈**：前端已用 `zod`（在 `ai-cloner` 依赖中）、TS strict。请求/响应 schema 可与前端共享，避免双份类型漂移。
4. **部署简单**：单个 Docker 镜像，两个入口（`api` / `worker`），`docker-compose` 里与现有 `app` 并列，无需引入 K8s。
5. **不锁死未来**：Provider 接口与传输层解耦；若将来要上 Python 推理服务，只是新增一个 `provider` 指向内部 HTTP 端点，主服务无需重写。

**何时改选 B（NestJS）**：团队规模 > 5 人长期维护此服务，或明确需要 Nest 生态的 OpenAPI 自动生成、`@nestjs/bull`、微服务 Transport 等成套能力。

**何时改选 D（FastAPI）**：明确 6 个月内启动自研模型/微调/私有化推理部署。

**不推荐 A 作为主服务形态**：可作为**过渡**——若希望 2 周内先跑通演示，可用 Next Route Handlers 做薄代理层，但它不应承载 Worker 与账本。

### 3.5 推荐技术栈明细

| 层 | 选型 | 说明 |
| --- | --- | --- |
| 运行时 | **Node.js 22 LTS**（前端要求 ≥24，服务端 22 更稳；若统一则 24） | 与前端统一用 24 也可，降低心智 |
| 语言 | **TypeScript 5.x strict** | 与前端一致，禁止 `any` |
| HTTP 框架 | **Fastify 5** | 插件化，schema 校验，`@fastify/*` 生态 |
| 校验 | **Zod** | 前端已有依赖；服务端用 zod 定义 DTO，可共享 |
| ORM | **Prisma 6** | 迁移可控、类型安全；账本表用原生 SQL 事务补充 |
| 数据库 | **PostgreSQL 16** | 账本需事务 + 行锁；`SELECT ... FOR UPDATE` 保证并发安全 |
| 缓存/队列 | **Redis 7 + BullMQ** | 任务队列、限流、幂等键、进度发布 |
| 对象存储 | **S3 协议**（默认同机 MinIO，零 egress 费；经配置可切 AWS S3 / R2 / OSS） | 前端直传用预签名 PUT；回传给供应商的用 4h 交付 URL；桶默认私有 |
| 认证 | 自建 **JWT（access 15min + refresh 30d 轮换）** + OAuth（Google/Apple） | 或用 `better-auth`（Node 生态，TS 友好） |
| 可观测 | **OpenTelemetry + Prometheus + Grafana**；**Sentry** 错误追踪；**pino** 结构化日志 | 供应商调用必须打点（耗时/成功率/成本） |
| 实时进度 | **SSE**（`GET /v1/tasks/:id/stream`）为主，轮询 `GET /v1/tasks/:id` 为降级 | WebSocket 对纯进度推送过重 |
| 测试 | **Vitest** 单测 + **Testcontainers** 集成测（真 PG/Redis） | Provider 层用 mock HTTP（`nock`/`msw`） |
| 部署 | **与前端同一台服务器**，Docker Compose 同栈（`ai-cloner/docker-compose.yml` 追加服务） | 单镜像两入口；无 K8s；见 §3.6 同机部署拓扑 |

### 3.6 同机部署拓扑（已定：与前端同一台服务器）

```yaml
# ai-cloner/docker-compose.yml 追加（示意）
services:
  app:      # 已有：Next.js standalone，${PORT:-3000}:3000
  api:      # 新增：Fastify，127.0.0.1:8080:8080（不对公网暴露，经反代）
  worker:   # 新增：BullMQ 消费者，同 api 镜像不同入口，不暴露端口
  postgres: # 新增：PG16，volume pgdata 持久化，不暴露端口
  redis:    # 新增：Redis7，volume redisdata（AOF 持久化 BullMQ），不暴露端口
  minio:    # 新增：对象存储，volume miniodata，127.0.0.1:9000:9000（内网）
  caddy:    # 新增：反向代理，80/443:80/443，/ → app:3000，/api → api:8080，自动 HTTPS
```

| 项 | 方案 |
|---|---|
| 入口 | 单公网 IP，Caddy 反代：`/` → 前端，`/api/*` → 后端；前后端同域，Cookie 无跨域问题 |
| 数据持久化 | `pgdata` / `redisdata` / `miniodata` 三个 named volume；PG 每日 `pg_dump` 到宿主机目录 + 保留 7 天 |
| 单点风险 | 整机是单点：接受（首期），靠每日备份 + 异地拷贝兜底；见 §12 新增风险行 |
| 资源隔离 | worker 设 `mem_limit` + `cpus` 上限，避免视频轮询挤占 Next.js 渲染；PG shared_buffers 按宿主机内存 25% 配 |
| 密钥 | 全部经宿主机 `.env` 注入，不进仓库；`LK_KEY`、`JWT_SECRET`、`S3_SECRET` 分开管理 |
| 日志 | 各容器 `json-file` 驱动 + 按天 rotate；Prometheus/Grafana 可选同机另起（资源不足先只留健康检查 + Sentry） |

---

## 4. 总体架构

```
┌─────────────────────────────────────────────────────────────────┐
│                    前端  ai-cloner (Next.js 16)                  │
│  HeroComposer │ ToolComposer │ AppHomePage │ SiteHeader │ proxy  │
└───────────────┬─────────────────────────────────────────────────┘
                │ HTTPS / JSON   (Bearer JWT)
                │ 直传文件 ──────────────────────────┐
                ▼                                    ▼
┌───────────────────────────────────┐   ┌──────────────────────────┐
│      API Service  (Fastify)       │   │   对象存储 (S3 兼容)      │
│  ┌─────────────────────────────┐  │   │  uploads/  → 源文件       │
│  │ auth    │ users  │ billing  │  │   │  outputs/  → 生成产物     │
│  │ tasks   │ assets │ catalog  │  │   └──────────────────────────┘
│  │ webhooks│ admin  │ health   │  │
│  └──────────────┬──────────────┘  │
│                 │                 │
│  ┌──────────────▼──────────────┐  │
│  │   ProviderRegistry          │  │   路由策略：能力 → 模型 → 渠道
│  │   ┌────┐┌────┐┌────┐┌────┐  │  │   • 静态权重 / 成本优先 / 质量优先
│  │   │Sora││Veo ││Hailuo││...│  │  │   • 健康检查 + 自动降级/熔断
│  │   └────┘└────┘└────┘└────┘  │  │   • 灰度（按 user_id 哈希分流）
│  │   GenerationProvider 接口    │  │
│  └──────────────┬──────────────┘  │
└─────────────────┼─────────────────┘
                  │ BullMQ: generation jobs
                  ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Worker Service (常驻)                         │
│  • 提交任务到渠道  • 轮询 job status  • 接收回调  • 落库结果      │
│  • 结算积分（成功扣减 / 失败退还）    • 重试与死信  • 成本记录    │
└─────────────────────────────────────────────────────────────────┘
        │                    │                      │
        ▼                    ▼                      ▼
┌──────────────┐   ┌──────────────────┐   ┌──────────────────┐
│ PostgreSQL 16│   │  Redis 7 (BullMQ)│   │ 第三方模型 API     │
│ 用户/订阅     │   │  队列·限流·幂等   │   │ Sora/Veo/Hailuo/… │
│ 任务/资产     │   │  进度 pub/sub    │   │                  │
│ 账本/流水     │   └──────────────────┘   └──────────────────┘
└──────────────┘
```

### 4.1 核心流程：一次生成的完整链路

```
 1. 前端 POST /v1/assets/upload-url   → 预签名 URL（不经过服务端）
 2. 前端 直传 S3，PUT 文件
  2b. 或服务端拉取：POST /v1/assets/import-url → 下载公网 URL → 转存 → assetId（深链 refImg 走此分支，SSRF 防护见 §8.3）
 3. 前端 POST /v1/assets              → 登记资产（assetId，直传分支用；import 分支已登记则跳过）
 4. 前端 POST /v1/tasks               → { capability, model?, params, assetIds[] }
       ├─ 校验：登录态、能力可用性、参数合法性、并发上限
       ├─ 内容审核（生图/生视频必经，§4.2）：Moderation.check(prompt + negativePrompt)
       │       ├─ L1 敏感词库命中 → 直接 422 CONTENT_REJECTED（不建任务、不扣费）
       │       └─ L2 LLM 二审不通过 → 422；LLM 超时/异常 → 放行 + 告警日志（fail-open，上游还有二道审核）
       ├─ 计价：PricingEngine.quote(model, params) → credits
       ├─ 计费：Billing.deduct(userId, credits, taskId)   ← 事务 + 行锁，原子检查并扣减
       │       余额不足 → 402 INSUFFICIENT_CREDITS（含所需/现有额度）
       ├─ 路由：Router.pick(capability, model?, userId) → (channel, model)
       ├─ 落库：Task(status=queued) + TaskEvent
       └─ 入队：BullMQ generation queue（含幂等键）
 5. Worker 消费
       ├─ 解析输入：将 `input_asset_ids[]` 逐个签发**交付 URL**（4h，仅本次 submit 有效）
       ├─ submit(task, deliveryUrls) → provider.submit() → externalJobId（传上游的必须是交付 URL，禁止传 15min 的浏览 URL）
       ├─ status=running，publish 进度
       ├─ 轮询 / 等 webhook，直到 succeeded | failed
       ├─ 重试 submit 前**重新签发**交付 URL（旧 URL 可能已过期）
       └─ 结算：Billing.settle(taskId)
               成功 → 已在提交时扣减，无二次操作（记 settled_credits = quoted）
               失败 / 取消 / 超时 → 全额返还（task_refund 流水，幂等：同一 task 只返一次）
 6. 前端 SSE /tasks/:id/stream 或轮询 → 拿到 status + progress + resultAssetUrl
 7. 前端 创作记录列表 GET /v1/tasks?type=video 渲染
```

**关键设计：提交即扣、失败即返**。提交时原子扣减报价积分，账本永远精确、无冻结态；成功无需二次操作，失败/取消/超时全额返还。并发提交靠行锁串行化不会超卖。

**LK888 特有的对接要点**

| 要点 | 说明 |
| --- | --- |
| 成功判定 | `POST /v1/media/generate` 用 `{code,msg,data}`，**判 `code=200`**；而 `/v1/skills/*` 用 `{error:{type}}` |
| 任务 ID | 读 `data.task_id`（`任务ids`/`对话组ID`/`成功数量` 即将下线） |
| 终态判定 | `is_final=true` 才停止轮询，**不要**只看 `status` 文本 |
| 结果下载 | `result_url` 是稳定直链；下载失败只重试下载，**绝不重提任务**（已扣费） |
| 视频输入 | 必须公网 URL，不支持 base64 → 依赖我方对象存储直传（步骤 1-3 不可省） |
| 失败重试 | `refunded=true` 的失败可原样重提（间隔 5-30s）；内容政策类应改提示词；参数类重试无效 |
| 回调 | 支持 `notify_url`，但轮询更简单可靠 —— **首期用轮询，webhook 作为优化项** |

### 4.2 Prompt 前置审核（生图 / 生视频必经）

范围：`text_to_image` / `image_to_image` / `text_to_video` / `image_to_video` 四个能力的 `prompt` + `negativePrompt`（藏违规词的高发区）。TTS / 音乐描述词 / Agent 询问暂不纳入（Could）。

```
submit → validate(参数) → ┌─ L1 本地敏感词库 ──命中──→ 422（不建任务，不扣费）
                          │   正则多模式匹配，P50 < 10ms
                          └─通过─→ ┌─ L2 LLM 二审 ──不通过──→ 422（同上）
                                     │  LK888 chat 小模型分类，超时 3s
                                     │  结论按 prompt sha256 缓存 24h（Redis）
                                     └─通过/超时异常──→ 继续 quote → deduct
                                       （超时走 fail-open + error 日志 + 告警计数，
                                        上游自带二道审核兜底）
```

**L1 词库**（`moderation_keywords` 表，运营可配、无需发版）：`term / category（政治/色情/暴力/违法/引流/广告）/ lang（zh/en）/ severity / active`。中英文分开维护；11 语种前端共用同一套词库（小语种靠 L2 覆盖）。

**L2 分类 prompt**（system）：要求模型只输出 JSON `{safe: bool, categories: string[]}`；`safe=false` 即拒。输入拼接待审文本（prompt + negativePrompt，截断 2000 字）。

**拒绝响应**（422，不建 task、无 ledger 流水，仅记审计）：

```jsonc
{ "ok": false,
  "error": { "code": "CONTENT_REJECTED",
             "message": "提示词包含违规内容，无法生成",   // 按 Accept-Language 本地化
             "details": { "layer": "blocklist", "categories": ["色情"] } },
  "requestId": "req_..." }
```

**审计**（`moderation_logs` 表）：只存 `prompt_hash`（sha256，不存原文，隐私），+ `verdict / layer / latency_ms / task_id? / created_at`。命中率、误杀申诉靠此表复盘。

**成本**：平台承担，不向用户收费；缓存目标命中率 > 60%（模板化 prompt 复用多）。

---

## 5. 多渠道 / 多模型设计（核心）

### 5.1 统一 Provider 接口

所有渠道适配器实现同一接口，新增渠道 = 新增一个文件 + 一条配置，不动业务代码。

```ts
// 统一内部请求
export interface GenerationRequest {
  capability: Capability;              // 'text_to_video' | 'image_to_video' | ...
  prompt: string;
  negativePrompt?: string;
  inputs: AssetRef[];                  // 源资产（图/视频/音频，存 assetId；
                                         // Worker 在 submit 前置换为 4h 交付 URL 再传上游）
  params: {
    // 开放键值，合法取值以 GET /v1/catalog/models/:id 返回的 params.options 为准；
    // 提交前由 validate() 按该模型的映射表校验（非法组合返回 400 INVALID_PARAMS）。
    // 例：gk-video-3 { duration: '6'|'10', aspect_ratio 5 种, images 首帧可选, ... }；
    //     hailuo-h3 { resolution: '768P'|'1080P'|'2K', duration: '4'~'15'任意整数, ... }。
    //     hailuo-h3 { resolution: '768P'|'1080P'|'2K', duration: '4'~'15'任意整数, ... }。
    //     完整矩阵见 §5.4。
    [key: string]: string | number | boolean | string[];
    count?: number;                    // 生成几个
    seed?: number;
  };
  callbackUrl?: string;                // 供应商 webhook
  idempotencyKey: string;
}

export interface SubmitResult {
  externalJobId: string;
  estimatedSec?: number;
  raw?: unknown;                       // 原始响应，排障用
}

export interface PollResult {
  state: 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  progress?: number;                   // 0-100；渠道不给则按时间估算
  outputs?: Array<{
    mimeType: 'video/mp4' | 'image/png' | 'audio/mpeg';
    remoteUrl?: string;                // 需回传到我方对象存储
    base64?: string;
    meta?: { width: number; height: number; durationSec?: number; sizeBytes?: number };
  }>;
  error?: { code: string; message: string; retryable: boolean };
  raw?: unknown;
}

// 适配器必须实现
export interface GenerationProvider {
  readonly channelId: string;                              // 'lingke-ai'
  readonly supportedCapabilities: Capability[];
  listModels(): Promise<ModelDescriptor[]>;                // 可选：拉取渠道模型目录
  validate(req: GenerationRequest): ValidationResult;       // 参数约束校验（时长/分辨率/比例组合）
  submit(req: GenerationRequest, model: ModelDescriptor, creds: ChannelCreds): Promise<SubmitResult>;
  poll(externalJobId: string, creds: ChannelCreds): Promise<PollResult>;
  cancel?(externalJobId: string, creds: ChannelCreds): Promise<void>;
  parseWebhook?(payload: unknown, headers: Record<string,string>): Promise<{ externalJobId: string; result: PollResult }>;
  mapError(err: unknown): { code: string; retryable: boolean; userMessage: string };
}
```

### 5.2 三层模型：能力 → 模型 → 渠道

| 层 | 实体 | 作用 |
| --- | --- | --- |
| 能力 | `Capability` | 面向前端的稳定语义，如 `text_to_video`。前端只认能力，不认供应商 |
| 模型 | `Model` | 具体模型，如 `hailuo-h3`、`gk-video-3`。绑定能力、参数约束、计价规则 |
| 渠道 | `Channel` | 供应商账号接入：凭据、BaseURL、限流、超时、健康状态、启停开关 |

**首期只有 1 个渠道（LK888），但同一渠道下有 100 个模型** —— 所以"多模型"是本期重点，"多渠道"是架构预留。

```
Channel: lk888 (灵客AI 聚合网关, base=https://api.lk888.ai/api)
   │
   ├─ Capability: text_to_video
   │     ├── Model: doubao-seedance-2-5-260628     (按token, 4~30s, 待POC)
   │     ├── Model: hailuo-h3                      (按秒, 4~15s, 768P/1080P/2K)
   │     ├── Model: wan3.0-video                   (按秒, 2~30s, 有声开关)
   │     ├── Model: hailuo-h3-quannengcankao        (按秒, 4~15s, 4K, 多模态参考全OPT)
   │     ├── Model: seedance-2.0-guanfang           (按token, auto|4~15s, 4K, 全形态一体)
   │     ├── Model: seedance-2.5-guanfang           (按token, auto|4~30s, 联网搜索)
   │     ├── Model: happyhorse-t2v                 (按秒, 3~15s, 无可靠性样本)
   │     ├── Model: omni-1.1                       (按次, 3~10s, 4K, 首帧)
   │     ├── Model: omni-flash                     (按次, 4/6/8/10s, 超分开关)
   │     └── Model: gk-video-3                     (按秒, 6/10s, 固定720P, 原grok)
   │
   ├─ Capability: image_to_video
   │     ├── Model: wan2.7-shouweizhen    (首尾帧, 无成功率样本)
   │     ├── Model: seedance-2.5-anmiao-shouweizhen (首尾帧, 无成功率样本)
   │     ├── Model: gk-video-3.5          (首帧必填, 自带音频, 成功率99%)
   │     ├── Model: happyhorse-i2v        (首帧, 93s最快)
   │     ├── Model: happyhorse-1.1-i2v    (首帧, 无成功率样本)
   │     └── Model: hailuo-h3-quannengcankao (多模态参考: 图/视频/音频全可选)
   │
   ├─ Capability: text_to_image
   │     ├── Model: tt-image-2   (GPT Image 2，按次，size 多档)
   │     └── Model: tt-image-2.5 (GPT Image 2.5，按次，resolution 1K/2K/4K + 透明背景)
   │
   ├─ Capability: tts
   │     ├── Model: doubao-tts-2.0  (按token input 414)
   │     ├── Model: gem-3.1-tts / gem-2.5-tts
   │     └── Model: speech-2.8      (含语音克隆)
   │
   ├─ Capability: text_to_music
   │     ├── Model: music-2.5 / music-2.5+  (按次 1.38)
   │     └── Model: suno-v4.5
   │
   └─ Capability: avatar_talk
         └── （空：kling-avatar-image2video 已排除；口播数字人模型待选，见 §14 #11）
```

**前端"模型"选择器**（`ToolComposer` 的 `dict.modelLabel`、首页 `models[]`）由 `GET /v1/catalog/models` 动态下发。**注意：前端原硬编码的 14 个模型名（Sora 2 / Veo 3.1 等在 LK888 上不存在）已替换为真实模型名**（Hailuo H3 / MiniMax H3 / GK Video 3 / Omni 1.1 / Omni Flash / Wan 3.0 / Seedance 2.0 / Seedance 2.5 / HappyHorse / PixVerse / Wan 2.7 / Hailuo Max），过渡期静态展示，后续由 catalog 接口动态下发。

### 5.3 路由策略（Router）

**⚠️ 关键约束：LK888 的渠道路由由 API Key 策略决定，请求参数无法覆盖。**

请求体 `channel_group` 与请求头 `X-Channel-Group` **均被平台忽略**。因此：

- **模型级路由**（我们完全可控）：由我方 `Router` 决定用哪个 `model`
- **分组级 fallback**（平台内不同渠道分组）：需**为每条链路各建一把 API Key**，各配不同策略（价格优先 / 成功率优先 / 自定义），我方按顺序切换重试

**Router.pick(capability, requestedModel?, userId, params)** 决策顺序：

1. **显式指定**：用户选了模型 → 直接用（校验可用性，不可用返回 409 + 可替代建议）
2. **能力/参数过滤**：模型必须支持该 capability 且满足参数约束（如 `gk-video-3` 仅支持 6/10s，`doubao-seedance-2-5-260628` 支持 4~30 秒）
3. **健康过滤**：剔除 `enabled=false`、熔断中、连续失败超阈值的模型
4. **灰度分流**：按 `hash(userId) % 100` 命中灰度规则的模型置于优先
5. **加权选择**：在剩余候选中按 `weight` 加权随机
6. **降级**：全不可用 → 返回 `503 NO_HEALTHY_PROVIDER`

**策略可配置**（存 DB，运营可改，无需发版）：

```jsonc
{
  "capability": "text_to_video",
  "strategy": "weighted",          // weighted | cost_first | quality_first | latency_first
  "fallbackEnabled": true,
  "candidates": [
    { "model": "gk-video-3", "weight": 40, "enabled": true, "grayPercent": 100 },
    { "model": "hailuo-h3",  "weight": 25, "enabled": true, "grayPercent": 100 },
    { "model": "wan3.0-video","weight": 20, "enabled": true, "grayPercent": 50 },
    { "model": "hailuo-h3-quannengcankao","weight": 15, "enabled": true, "grayPercent": 0 }
  ],
  "circuitBreaker": { "failureThreshold": 5, "cooldownSec": 120 }
}
```

**多 Key fallback 配置**（分组级）：

```jsonc
{
  "channel": "lk888",
  "keys": [
    { "id": "lk-price",  "strategy": "价格优先",   "priority": 1 },
    { "id": "lk-success","strategy": "成功率优先", "priority": 2 },
    { "id": "lk-custom", "strategy": "自定义",     "priority": 3 }
  ]
}
```

### 5.4 参数映射（按 LK888 真实定义）

LK888 的参数定义可从 `GET /v1/skills/models/{name}` 拉取，我方用**声明式映射表**做统一参数 → 模型参数转换。实测差异很大：

| 统一参数 | `hailuo-h3-quannengcankao` | `doubao-seedance-2-5-260628` |
| --- | --- | --- |
| 时长 | `duration`: 4~15 任意整数 | `duration`: auto\|4~30 |
| 分辨率 | `resolution`: 768P\|1080P\|2K\|4K | `resolution`: 480p\|720p\|1080p |
| 画质 | — | — |
| 宽高比 | `aspect_ratio`: 7 种（OPT） | `aspect_ratio`: adaptive\|16:9\|4:3\|1:1\|3:4\|9:16\|21:9 |
| 参考图 | `image_url`/`video_url`/`audio_url` 全 OPT | — |
| 错峰 | — | — |
| 联网 | — | `web_search`: false\|true |

**图片模型参数映射（实测）**

| 统一参数 | `tt-image-2` | `tt-image-2.5` |
| --- | --- | --- |
| 提示词 | `prompt` REQ | `prompt` REQ |
| 参考图 | `images` OPT (upload) | `images` OPT (upload) |
| 尺寸 | `size` REQ select（35 档，含 auto/1024×1024…3840×2160） | `resolution` REQ select（auto/1K/2K/4K）+ `size` OPT input |
| 画质 | `quality` OPT（auto/high/medium/low） | `quality` OPT（auto/low/medium/high/xhigh/max）+ `version` REQ（flare/sunburst） |
| 宽高比 | 并在 `size` 选项内 | `aspect_ratio` OPT（14 种） |
| 透明背景 | — | `background` OPT（opaque/transparent/auto） |

**新增模型参数映射（2026-09-14 实测）**

| 模型 | 时长 | 分辨率 | 宽高比 | 参考输入 | 特有参数 |
|---|---|---|---|---|---|
| `hailuo-h3` | 4~15s任意 | 768P\|1080P\|2K | 6种 | — | — |
| `wan3.0-video` | auto\|2~30s | 480P\|720P\|1080P | 6种（OPT） | — | `version`: standard\|prime；`audio`: 有声开关；`prompt_extend` |
| `hailuo-h3-quannengcankao` | 4~15s | 768P\|1080P\|2K\|4K | 7种（OPT） | `image_url`/`video_url`/`audio_url` 全OPT（可纯文生） | — |
| `seedance-2.0-guanfang` | auto\|4~15s | 480p\|720p\|1080p\|4K | 7种（OPT） | `images`/`image_url`/`video_url`/`audio_url` 全OPT | `version`: Mini/快速/标准；`mode`: 首尾帧/参考生 |
| `seedance-2.5-guanfang` | auto\|4~30s | 480p\|720p\|1080p | 7种（OPT） | `images`/`image_url`/`video_url`/`audio_url` 全OPT | `web_search` 联网搜索 |
| `omni-1.1` | 3~10s | 720P\|1080P\|4K | 16:9\|9:16 | `images`首帧（OPT） | `prompt`必填 |
| `omni-flash` | 4\|6\|8\|10s | — | 16:9\|9:16 | `images`（OPT） | `enhance_prompt`；`enable_upsample`超分 |
| `gk-video-3` | 6\|10s | 固定720P | 5种 | `images`首帧（OPT，不传即文生） | — |
| `gk-video-3.5` | 1~15s | 720p\|480p | 5种 | `images`首帧（REQ） | 自带音频输出 |

**映射表示例**

```ts
{
  model: 'hailuo-h3-quannengcankao',
  paramMapping: {
    'params.durationSec':  { target: 'duration',      type: 'select', allowed: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] },
    'params.resolution':   { target: 'resolution',    type: 'select', allowed: ['768P','1080P','2K','4K'] },
    'params.aspectRatio':  { target: 'aspect_ratio',  type: 'select', allowed: ['adaptive','16:9','9:16','1:1','4:3','3:4','21:9'] }
  },
  required: ['duration','resolution'],
  constraints: { maxInputImages: 5, videoNeedsUrl: true }
}
```

**重要约束**：
- **视频不支持 base64**，参考视频必须传公网 URL
- 图片/音频可传 `data:<mime>;base64,`（单文件 ≤10MB 解码后、单次 ≤30MB、请求体 ≤50MB）
- `required=true` 参数必须传（如 `hailuo-h3` 的 `duration`/`resolution` 全为 REQ），否则平台不填默认值会报错
- 无法识别的参数组合（如 gk-video-3 要 30 秒）应在**提交前**由 `validate()` 拦截，返回 `400 INVALID_PARAMS` 并给出该模型支持的取值

**验收标准**：新增一个模型（含参数映射 + 配置）应在 **2 小时内**完成，且不需要修改任何业务模块代码。

### 5.5 凭据管理

- 凭据加密存储（`AES-256-GCM`，密钥来自 KMS/环境变量），DB 只存密文
- **多 Key 池**：因分组 fallback 需多把 Key，需支持 Key 池与优先级切换
- 凭据绝不下发前端；日志脱敏（`sk-***ae56`）
- ⚠️ **当前 Key 已在对话中明文暴露，上线前必须重新生成**

---

## 6. 计费模型（核心）

### 6.0 定价原则

**首期定价 = 上游成本 × 1.3**（固定 30% 毛利）。

```
用户积分 = ceil(上游成本(算力≈RMB) × 1.3 × 100 ÷ 6.9)
```

上游的"算力"是**内部成本口径（RMB）**，用户看不见。用户看到的只有**积分**（Credits），积分直接对应 USD。

### 6.1 汇率与积分基准

| 项 | 值 |
| --- | --- |
| `USD_TO_CNY` | 6.9（固定，不跟随实时汇率） |
| `CREDITS_PER_USD` | 100 |
| `MARKUP` | 1.3（30% 毛利） |

1 积分 = $0.01 ≈ ¥0.069。

### 6.2 定价公式

```
credits = ceil(costUnits × MARKUP × CREDITS_PER_USD ÷ USD_TO_CNY)
        = ceil(costUnits × 1.3 × 100 ÷ 6.9)
        = ceil(costUnits × 18.84)
```

**costUnits 计算（按上游计费口径，取最优激活分组）**：

```
【按次】costUnits = base_price × ∏(选项 price_multiplier) + Σ(price_addition)
        例：gk-video-3 10s = 0.069×10 = 0.69

【按秒】costUnits = per_second_price × durationSec
        例：hailuo-h3 768P/10s = 0.0828×10 = 0.828

【按token】costUnits = (input_tokens × input_token_price
                     + output_tokens × output_token_price) ÷ 1_000_000
        视频类 output_tokens ≈ 时长 × 每秒等效token
        （480p≈9600、720p≈21600、1080p≈48600、4K≈194400；含参考视频×2.3）
```

> 每日同步（§6.9）按上述规则对每个 `(model, spec)` 组合重算，写入 `price_items`。`quote` / 提交只查表，不实时计算。

### 6.3 价目表

公式：`credits = ceil(costUnits × 1.3 × 100 ÷ 6.9)` = `ceil(costUnits × 18.84)`

> 成本单元（costUnits）来源：`GET /v1/skills/models/{name}/pricing?status=active`，按启用分组取 `min_price`（最优渠道）。每日同步两次（§6.9），自动重算积分。

**视频（按条）**——各模型原生时长档，不强制统一（`—` = 该模型不支持，提交前由 validate 拦截）

> 价格= `ceil(最优分组成本×18.84)`，每日同步自动重算。★ = 首期默认上架（`active=true`，运营可在配置中开关）。

| 模型 | 分辨率 | 各时长档积分 | 计费口径 | 首期 |
|---|---|---|---|---|
| ★ `hailuo-h3`（海螺H3） | 768P | 5s=8 / 10s=16 / 15s=24 | 按秒 | ON |
| ★ `hailuo-h3` | 1080P / 2K | 10s=32 / 42 | 按秒 | ON |
| ★ `hailuo-h3-quannengcankao`（全能参考） | 768P / 1080P / 2K / 4K | 10s=16 / 32 / 32 / 42 | 按秒 | ON |
| ★ `gk-video-3`（GK/原grok） | 固定720P | 6s=8 / 10s=13 | 按秒 | ON |
| ★ `omni-1.1` | 720P / 1080P / 4K | 10s=16 / 26 / 39（3s=5起） | 按次 | ON |
| ★ `omni-flash` | —（固定档） | 4s=7 / 6s=10 / 8s=13 / 10s=16 | 按次 | ON |
| `hailuo-h3-shouweizhen`（首尾帧） | 768P / 1080P / 2K / 4K | 10s=16 / 32 / 32 / 42 | 按秒 | OFF（已排除） |
| ★ `happyhorse-i2v`（首帧） | 720P / 1080P | 10s=136 / 242 | 按秒 | ON |
| `omni_flash-10s`（固定10s/720P） | — | 10s=14 | 按次 | OFF（已排除） |
| `omni_flash-10s-fl`（首尾帧固定） | — | 10s=14 | 按次 | OFF（已排除） |
| ★ `gk-video-3.5`（首帧必填） | 720p / 480p | 5s=13 / 10s=26 / 15s=39 | 按秒 | ON |
| ★ `seedance-2.0-guanfang`（Seedance 2.0） | 480p / 720p / 1080p | 10s=55 / 124 / 310（标准版，公式估算，首单复核） | 按token | ON |
| ★ `seedance-2.5-guanfang`（Seedance 2.5） | 480p / 720p / 1080p | 10s=84 / 189 / 425（公式估算，首单复核） | 按token | ON |
| `wan3.0-video`（万相3.0） | 480P / 720P / 1080P | 10s=78 / 156 / 312（prime×1.5） | 按秒 | OFF（贵2~10倍） |
| `happyhorse-t2v` | 720P / 1080P | 10s=136 / 242 | 按秒 | OFF（无成功率样本） |
| `wan2.7-shouweizhen`（首尾帧） | 720P / 1080P | 720P: 3s=24/6s=47/9s=71/12s=94/15s=117 | 按次 | OFF（无成功率样本） |
| `seedance-2.5-anmiao-shouweizhen` | 480p / 720p / 1080p | 720p/10s=130（MC-S） | 按秒 | OFF（无成功率样本） |
| `doubao-seedance-2-5-260628` | 480p / 720p / 1080p | 待POC（公式推算与平台注释冲突） | 按token | OFF（待POC） |
| `happyhorse-1.1-i2v`（首帧） | 720P / 1080P | 10s=130 / 177 | 按秒 | OFF（被happyhorse-i2v支配） |
| `minimax-h3` | 768P / 1080P / 2K / 4K | 10s=16 / 32 / 32 / 42 | 按秒 | OFF（被hailuo-h3-quannengcankao替代） |

**视频模型能力矩阵**

| 能力 | hailuo-h3 | wan3.0 | hailuo-h3-quannengcankao | seedance-2.0 | seedance-2.5 | happyhorse-t2v | omni-1.1 | omni-flash | gk-video-3 | gk-video-3.5 |
|---|---|---|---|---|---|---|---|---|---|---|
| 时长档 | 4~15s任意 | 2~30s/auto | 4~15s任意 | auto\|4~15s | auto\|4~30s | 3~15s | 3~10s | 4/6/8/10s | 6/10s | 1~15s |
| 分辨率 | 768P/1080P/2K | 480P/720P/1080P | 768P/1080P/2K/4K | 480p/720p/1080p/4K | 480p/720p/1080p | 720P/1080P | 720P/1080P/4K | 无 | 固定720P | 720p/480p |
| 画质/版本档 | — | standard/prime | — | Mini/快速/标准 | — | — | — | — | — | — |
| 参考图输入 | ❌ | ❌ | ✅多模态（图/视/音全OPT） | ✅多模态OPT | ✅多模态OPT | ❌ | ✅首帧 | ✅参考图 | ✅首帧可选 | ✅首帧必填 |
| 有声 | 待确认 | ✅开关 | ✅（tag） | ✅（tag） | ✅（tag） | 待确认 | ✅（tag） | ✅（tag） | 待确认 | ✅（tag） |
| 特殊 | 出片慢 | 提示词优化 | 参考全OPT·可纯文生 | 全形态·免人像认证 | 联网搜索·视频延长 | — | — | 超分开关 | 规格锁死 | — |
| 出片耗时 | ~6~11min | ~10min | ~11~13min | ~5min | ~4~7min | 未知 | ~2min | ~2min | ~1.3~3min | ~1.4min |
| 成功率 | 67~86% | 100% | 60~100% | 100% | 100% | 无样本⚠️ | 78% | 83% | 83~100% | 99% |

**图片（按张）**

| 分辨率 | `tt-image-2` | `tt-image-2.5` |
| --- | --- | --- |
| 1K (1024×1024) | **1** | **1** |
| 2K (2048×2048) | **1** | **2** |
| 4K (4096×4096) | **3** | **3** |
| 透明背景 | — | **2** |

> - `tt-image-2`：GPT Image 2，成本 0.0317~0.1656 算力（按分组），取最低激活分组
> - `tt-image-2.5`：GPT Image 2.5，成本 0.0414~0.276 算力，支持**透明背景**（`background=transparent`）
> - 宽高比不同时按面积折算（如 2048×3072 ≈ 2K 按 2K 计费）

**音频**

| 类型 | 时长 | `doubao-tts-2.0` | `gem-3.1-tts` | `speech-2.8`(克隆) | `music-2.5` | `suno-v4.5` |
| --- | --- | --- | --- | --- | --- | --- |
| TTS | ≤30s | **1** | **1** | **8** | — | — |
| TTS | ≤60s | **2** | **2** | **15** | — | — |
| TTS | ≤120s | **3** | **3** | **28** | — | — |
| 音乐 | ≤1min | — | — | — | **14** | **38** |
| 音乐 | ≤2min | — | — | — | **26** | **57** |

**附加费用**

| 项目 | 积分 | 说明 |
| --- | --- | --- |
| 去水印 | +5 | Free 用户导出加水印，Pro/Enterprise 免费 |
| 优先队列 | +10 | 普通队列免费，优先队列额外收费 |
| 错峰生成 | −30% | 非高峰时段提交自动优惠 |

### 6.4 积分账本

只追加（append-only）流水，余额 = 流水聚合。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | uuid | |
| `user_id` | uuid | |
| `delta` | int | 正=增加，负=扣减 |
| `type` | enum | `grant_signup` `grant_checkin` `purchase` `task_deduct` `task_refund` `refund` `admin_adjust` `promo` `expire` |
| `task_id` | uuid? | 关联任务（生成类必有） |
| `order_id` | uuid? | 关联订单（购买类必有） |
| `balance_after` | int | 快照，便于对账 |
| `idempotency_key` | string | **唯一索引**，防重复扣费 |
| `created_at` | timestamptz | |

### 6.4.1 注册赠送与每日签到

**新用户注册**：自动赠送 **100** 积分（`type=grant_signup`，`delta=100`，`idempotency_key=signup:{userId}`，**7 天有效**，过期自动清零促转化）。单用户获客成本敞口 ¥5.31。

**每日签到**（Free / Pro 同标准，可与订阅额度叠加）：
- 用户点击"签到"按钮，当日获得 **5** 积分
- 同一用户同一天只能签到一次（唯一索引 `user_id + date`）
- 签到积分**当日有效**，次日 00:00 清零（不累积）

```sql
daily_checkins          id, user_id, date, credits, created_at
                       UNIQUE(user_id, date)           -- 防重复签到

daily_balance_reset     id, user_id, date, reset_amount -- 次日凌晨重置时记录
```

**签到 API**：

```
POST /v1/checkin
→ { "ok": true, "credits": 5, "balance": 25 }

GET /v1/checkin/today
→ { "checked_in": true, "credits": 5 }

GET /v1/checkin/history?limit=30
→ { "records": [{ "date": "2026-09-14", "credits": 5 }, ...] }
```

奖励积分在签到时发放（`type=grant_checkin`，`delta=5`，Free / Pro 同标准，可与订阅额度叠加）。

### 6.5 提交扣减 + 失败返还状态机

```
  submit → deduct(用户积分，恒定=quotedCredits) → queued → running
      │
      ├─ succeeded → 终态（已扣，无二次操作）
      ├─ failed    → refund(全额返还) → 终态
      ├─ cancelled → refund(全额返还) → 终态
      └─ timeout   → refund + 标记 failed → 终态
```

**用户侧扣减金额 = 报价积分，恒定不变**。上游成本波动不影响用户账务。

**返还幂等**：仅当任务从非终态进入 failed / cancelled / timeout 时触发一次；以 `(task_id, type=task_refund)` 唯一约束兜底，重放不重复返还。

**上游计费陷阱**（仅影响平台余额，不影响用户）：

| 陷阱 | 对策 |
| --- | --- |
| 按秒模型按 10 秒预扣 | 提交前 `/v1/skills/balance` 预检平台余额 |
| 渠道 fallback 补差额 | 平台侧处理，用户侧照常 refund |
| `refunded=true` 失败 | 用户侧 refund；成本侧记 `platform_refunded=true` |

### 6.6 订阅计划

**⚠️ 额度设计铁律（2026-09-14 核算）**：1 积分成本 = 1/18.84 ≈ ¥0.053。用户花 C 积分，我方成本 = C/130 USD。
100% 使用率下保 30% 毛利 → 每 $1 收入最多给 **91 积分**；按 70% 使用率假设 → 最多给 **130 积分**（面值 1:1）。
原方案 Pro 月付 $9.99 给 2,450 积分（2000+450），全用完成本 $18.84，**必亏 $8.85/人/月**，已修正如下：

| 计划 | 月费 | 月度积分 | 并发 | 权益 |
| --- | --- | --- | --- | --- |
| **Free** | $0 | 每日签到 **5** 积分（当日有效） | 1 | 低成本模型、带水印 |
| **Pro** | **$9.99**/月 | **1,000** 积分/月 + 每日签到 **5** 积分（叠加） | 3 | 全部模型、去水印、优先队列、额外 **9 折** |
| **Enterprise** | 议价 | 定制 | 定制 | 团队协作、API |

Pro 年付 **$99**（**9,000** 积分/年，约 91 积分/美元；订阅额度部分 100% 使用率下毛利率 **30%**，叠加签到后全用毛利约 16%，按 70% 使用率约 35%）。

**新方案毛利测算**（70% 使用率假设）：

| 计划 | 收入 | 使用积分（70% 使用率，含 9 折面值） | 成本 | 毛利 |
| --- | --- | --- | --- | --- |
| Pro 月付 | $9.99 | 805 扣减（894 面值） | $6.88 | **31%** |
| Pro 年付 | $99 | 7,578 扣减（8,420 面值） | $64.8 | **35%** |
| Free 全勤 | $0 | 150 | $1.15/人/月 | 获客成本，需控制 Free 用户规模 |

**积分来源汇总**：

| 来源 | Free 用户 | Pro 用户 |
| --- | --- | --- |
| 注册赠送（一次性，7 天有效） | **100** | **100** |
| 每日签到（当日有效） | **5**/天 | **5**/天（与月度额度叠加） |
| 月度订阅额度 | — | **1,000**/月 |
| 积分包购买 | ✓ | ✓ |

### 6.7 积分包

| 包名 | 价格 | 积分 |
| --- | --- | --- |
| starter | $4.99 | 500 |
| basic | $9.99 | 1,000 |
| pro | $29.99 | 3,000 |
| max | $79.99 | 7,500 |

积分**不过期**，Free 用户可买。

### 6.8 折扣层

| 层 | 作用 | 示例 |
| --- | --- | --- |
| 订阅权益 | Pro 额外 9 折（向上取整） | 117 积分 → 106 积分 |
| 限时优惠 | 全站活动折扣 | 75 折 |
| 优惠券 | 用户级 | 新用户减 20 积分 |

**保护**：实付积分 ≥ 1（最低 1 积分）。

### 6.9 价格同步机制（每日 2 次）

**频率**：每日 02:00 和 14:00（UTC+8）各执行一次。

**同步内容**：
1. 遍历所有启用模型，调 `GET /v1/skills/models/{name}/pricing?status=active`
2. 取每个模型**最优激活分组**的 `min_price`（或 `base_price`，按次计费时）
3. 按 `min_price × 18.84` 重算积分，写入 `price_items.credits`
4. 检测变化：若某模型的 `min_price` 变化超过 20% → 告警
5. 新增/下线模型：自动发现并写入 `price_items`（新增默认 `active=true`，需人工确认后上线）

**同步后对外生效**：
- 新用户看到的积分立即反映最新价格
- 已创建任务按创建时快照价扣减，不受影响
- 同步日志写入 `price_sync_log`（model_id, old_credits, new_credits, triggered_at）

**异常处理**：
- 同步失败（网络/平台错误）→ 保留上一次价格，告警
- 某模型所有分组下线 → 标记 `active=false`，用户提交时返回 `409 MODEL_UNAVAILABLE`

### 6.10 内部成本与毛利监控

| 账本 | 单位 | 用途 |
| --- | --- | --- |
| `credit_ledger` | 积分 | 用户账务 |
| `task_costs` | 算力 | 成本核算、毛利分析 |

**毛利**：`(settledCredits × 0.069 − costRmb) ÷ (settledCredits × 0.069)`（按理论值 30%）。
**实际毛利**：按 `task_costs.cost` 实算，每日看板 + P0 告警（< 0%）。

### 6.11 报价接口语义

**核心要求：同一规格、不同模型，报价必须不同。** `quote` 按 `modelId + params` 实时计算（`price_items` 查表，不存在则按公式现算），不允许出现"换模型价格不变"的情况。

```jsonc
POST /v1/pricing/quote
→ { "capability": "text_to_video", "modelId": "gk-video-3",
    "params": { "durationSec": 10 } }
← {
  "sku": "video.10s",
  "model": "gk-video-3",
  "credits": 13,               // 0.69×18.84 上取整
  "breakdown": { "costUnits": 0.69, "markup": 1.3, "discounts": [] },
  "balance": { "credits": 500, "sufficient": true },
  "estimated": false
}

// 同规格换模型，价格必须不同：
→ { "modelId": "hailuo-h3", "params": { "resolution": "768P", "durationSec": 10 } }
← { "credits": 16, ... }

→ { "modelId": "hailuo-h3-quannengcankao", "params": { "resolution": "1080P", "durationSec": 10 } }
← { "credits": 32, ... }
```

### 6.12 定价配置模型（运营可调）

```sql
price_items          id, model_id, capability, spec(jsonb),
                     cost_units, markup, credits,  -- 唯一真源
                     active, updated_at

plans                id, code, name_i18n, list_price_usd,
                     monthly_credits, max_concurrency, features(jsonb)

promotions           id, scope, discount, starts_at, ends_at, active
```

**并发安全**：`deduct()` 必须在事务中 `SELECT ... FROM users WHERE id=$1 FOR UPDATE` 锁行，再校验余额并插入扣减流水。或者用条件更新 `UPDATE users SET credits = credits - $1 WHERE id=$2 AND credits >= $1` 判断 affected rows。

**幂等**：所有计费入口强制传 `Idempotency-Key`（由 `taskId + 阶段` 派生亦可）。重复请求直接返回首次结果。

---

## 7. 数据模型（概要）

```
users                  id, email, phone, password_hash, oauth[], locale, plan_id,
                       credits_balance, status, created_at, last_login_at

user_profiles          user_id, display_name, avatar_asset_id, timezone

plans                  id, code(free|pro|enterprise), name_i18n, monthly_credits,
                       max_concurrency, features(jsonb), price_cents, currency

subscriptions          id, user_id, plan_id, status(active|cancelled|past_due),
                       current_period_start/end, external_ref, cancel_at_period_end

channels               id, code, name, base_url, creds_encrypted, enabled,
                       rate_limit_rpm, timeout_ms, health_status, circuit_state

channel_api_keys       id, channel_id, key_ref(密文), strategy(价格优先|成功率优先|自定义),
                       priority, enabled, quota_limit, quota_used   -- 多 Key 池，分组 fallback 用

models                 id, code, display_name, channel_id, capabilities[],
                       param_mapping(jsonb), required_params(jsonb), constraints(jsonb),
                       enabled, quality_score, cost_per_call_cents, currency,
                       sync_at                 -- 与平台 /v1/skills/models 同步时间

model_pricing_snapshots id, model_id, group_name, is_active, billing_method,
                       base_price, min_price, input_token_price, output_token_price,
                       option_prices(jsonb), time_discounts(jsonb),
                       success_rate_24h, avg_response_seconds, captured_at

routing_policies       id, capability, strategy, candidates(jsonb),
                       fallback_enabled, circuit_breaker(jsonb), updated_at

price_items            id, model_id, capability,
                       resolution, duration_or_size,    -- 规格维度（如 720p, 5s 或 1K）
                       cost_units,                      -- 上游成本（算力），每日 2 次同步刷新
                       credits,                         -- 对外积分 = ceil(cost_units × 18.84)
                       active,                          -- 是否对用户展示
                       updated_at                       -- 最近一次同步时间

price_sync_log         id, model_id, old_cost_units, new_cost_units,
                       old_credits, new_credits, triggered_at, status

promotions             id, scope(global|capability|model), target_id, discount,
                       starts_at, ends_at, name_i18n(jsonb), active

plans                  id, code(free|pro|enterprise), name_i18n,
                       list_price_usd, monthly_credits, max_concurrency,
                       features(jsonb)

user_coupons           id, user_id, code, discount, used_at, expires_at

tasks                  id, user_id, capability, model_id, channel_id, api_key_id,
                       status, progress, params(jsonb), input_asset_ids[],
                       external_job_id,          -- LK888 task_id (bigint)
                       external_status(jsonb),   -- 平台原始 status/status_group/is_final
                       result_asset_ids[],       -- 转存后的本地资产 ID（终态后填充）
                       error(jsonb),
                       price_snapshot(jsonb),    -- 提交时快照：{capability, model, resolution,
                                                  --   duration, credits, quotedAt}
                       quoted_credits,           -- 报价积分（快照值，提交时已扣减）
                       deducted_credits,         -- 已扣减积分（= quoted）
                       settled_credits,          -- 结算积分（成功时=quoted；失败返还后=0）
                       idempotency_key,
                       priority, queued_at, started_at, finished_at, created_at

task_events            id, task_id, from_status, to_status, progress,
                       message, payload(jsonb), created_at

task_costs             id, task_id, channel_id, model_id, billing_method,
                       cost_units,              -- 平台实际扣费（算力）
                       channel_group,           -- 实际命中分组，如 TX-Y3
                       platform_refunded(bool), refunded_amount,
                       duration_seconds, currency, raw_usage(jsonb), created_at

assets                 id, user_id, kind(upload|output), mime_type,
                       storage_key, size_bytes, width, height,
                       duration_sec, checksum, meta(jsonb), created_at,
                       deleted_at

credit_ledger          id, user_id, delta, type, task_id, order_id,
                       balance_after, idempotency_key, note, created_at

daily_checkins          id, user_id, date, credits, created_at
                       UNIQUE(user_id, date)           -- 防重复签到

daily_balance_reset     id, user_id, date, reset_amount -- 次日凌晨重置时记录

grants                 id, user_id, type(daily|monthly|signup), amount,
                       last_granted_at, next_grant_at, expires_at
                       -- 订阅额度重置；signup 一次性，expires_at = 发放后 7 天

**余额计算规则**：可用余额 = Σ(未过期 delta)。`expires_at` 为空视为永不过期（购买积分不过期；月度额度按周期重置）。
每日 00:00 定时任务扫描过期 grant，写入 `daily_balance_reset` 并记一笔 `type=expire` 负向 ledger 流水（保证账本可审计）。

orders                 id, user_id, kind(subscription|credit_pack),
                       amount_cents, currency, status, external_ref, created_at

webhook_events         id, source(channel|payment), external_id UNIQUE,
                       payload(jsonb), processed_at, error

user_notifications     id, user_id, type(task_completed|task_failed|subscription_expiry|promo),
                       title_i18n(jsonb), body_i18n(jsonb),
                       read_at, created_at

user_preferences       id, user_id, locale, timezone, email_notifications(bool),
                       push_notifications(bool), updated_at

prompt_tabs            id, code, label_i18n(jsonb), sort, active

prompt_posts           id, tab_code, title, img_url, asset_id?,
                       views, likes, copies, sort, active, created_at

prompt_post_events     id, post_id, user_id?, event(view|copy|like|unlike),

moderation_keywords    id, term, category, lang, severity, active, updated_at
                       -- L1 敏感词库，运营可配

moderation_logs        id, prompt_hash, verdict(pass|block), layer(blocklist|llm),
                       latency_ms, task_id?, created_at
                       created_at, UNIQUE(post_id, user_id, event, date)
                       -- views/likes/copies 由事件聚合（定时物化或触发器累加）
```

**索引要点**：
- `tasks(user_id, status, created_at DESC)` — 创作记录列表（前端 Filter 全部/视频/图片/音频）
- `tasks(external_job_id)` — 回调定位
- `tasks(idempotency_key)` UNIQUE
- `credit_ledger(user_id, created_at DESC)`
- `credit_ledger(idempotency_key)` UNIQUE
- `daily_checkins(user_id, date)` UNIQUE — 防重复签到
- `assets(user_id, kind, created_at DESC)`

---

## 8. API 设计

统一前缀 `/v1`，JSON，`Authorization: Bearer <access_token>`。所有写接口支持 `Idempotency-Key` 头。

### 8.1 认证

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/v1/auth/register` | 邮箱/手机注册，发验证码 |
| POST | `/v1/auth/verify` | 校验验证码，返回 token 对 |
| POST | `/v1/auth/login` | 密码登录 |
| POST | `/v1/auth/oauth/:provider` | Google / Apple |
| POST | `/v1/auth/refresh` | 轮换 refresh token（旧 token 立即失效） |
| POST | `/v1/auth/logout` | 撤销 refresh |
| GET | `/v1/auth/me` | 当前用户 + 计划 + 积分余额 |
| PATCH | `/v1/users/me` | 更新用户资料（昵称、头像资产 ID、时区） |
| POST | `/v1/auth/change-password` | 修改密码（需旧密码验证） |
| POST | `/v1/account/delete` | 账号注销（需密码确认，异步删除数据） |

> 对应前端 `SiteHeader` 的 `login` 与 `startFree` 两个入口，以及侧栏的头像/昵称展示。

### 8.2 目录（Catalog）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/v1/catalog/capabilities` | 能力列表（前端工作台侧栏工具项） |
| GET | `/v1/catalog/models?capability=text_to_video` | 可用模型 + 参数约束 + 参考价（驱动"模型"选择器与首页 `models[]`） |
| GET | `/v1/catalog/models/:id` | 单个模型详情（含完整 params 定义、规格×价格矩阵） |
| GET | `/v1/catalog/templates` | 快速开始模板（前端 `app.quick[]`）。单项含 `id/title/sub/img/prompt/refImgUrl/capability/modelId?/params?`，点击后按提示词库深链模式预填（`?prompt=&img=`） |

**内部 ID vs 对客展示名（必须分离）**：上游模型 ID（如 `tt-image-2`）是渠道侧代号，**禁止直接展示给用户**。
`models.display_name` 为唯一对客真源，前端所有模型文案（选择器 chip、首页 `models[]`、composer 按钮、badge）必须取该字段。**未上架（`active=false`）的模型不得在任何对客位置展示**，包括静态文案和 catalog 接口返回。
当前映射：`tt-image-2` → **GPT Image 2**；`tt-image-2.5` → **GPT Image 2.5**（TT 仅为内部调用名）；`seedance-2.0-guanfang` → **Seedance 2.0**；`seedance-2.5-guanfang` → **Seedance 2.5**（guanfang 仅为内部版本后缀，不展示）；`hailuo-h3-quannengcankao` → **MiniMax H3**（对客沿用 MiniMax 品牌展示名，内部路由仍走 hailuo 全能参考模型）。
新增模型上架时必须同时登记 `display_name`，否则 catalog 接口不返回该模型。

### 8.3 资产

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/v1/assets/upload-url` | `{ mimeType, sizeBytes, kind }` → 预签名 PUT URL + `assetId`（前端直传，不经服务端） |
| POST | `/v1/assets` | 直传完成后登记确认，触发校验（类型/大小/病毒扫描异步） |
| POST | `/v1/assets/import-url` | `{ url, kind }` → 服务端拉取公网 URL → 转存对象存储 → 返回 `assetId`（用于提示词库深链 refImg、URL 参考图；SSRF 防护见下） |
| GET | `/v1/assets?kind=&cursor=&limit=` | 资产库（对应 App 工作台"资产"视图） |
| GET | `/v1/assets/:id` | 资产详情 + 浏览 URL（前端预览用，15min 有效） |
| DELETE | `/v1/assets/:id` | 软删除 |

**URL 类型（三权分立，禁止混用）**

| 类型 | 用途 | 生成方 | 有效期 | 可见范围 |
|---|---|---|---|---|
| 上传 URL | 前端直传 PUT | API（预签名 PUT） | 15min | 仅上传者 |
| 浏览 URL | 前端预览/下载 | API（预签名 GET，随 `GET /v1/assets/:id` 下发） | 15min | 仅资产 owner |
| 交付 URL | **上游供应商拉取输入文件** | **Worker 在每次 submit 前现签**（预签名 GET） | **4h** | 仅 LK888（不下发前端、不记日志明文） |

**为什么交付 URL 必须独立**：视频任务平均出片 2~14 分钟，加上排队与重试，15min 的浏览 URL 必然过期 → 供应商下载失败 → 任务失败但平台已预扣费。交付 URL 按"任务超时上限（30min）+ 缓冲"取 4h，每次 submit（含重试）重新签发，杜绝过期。

**上传限制**：
- 图片 ≤ 20MB（jpg/png/webp）
- 视频 ≤ 200MB（mp4/mov/webm）
- 音频 ≤ 50MB（mp3/wav/m4a）
- 直传 URL 有效期 15 分钟

**`import-url` 安全约束（SSRF 防护，必须实现）**：
- 禁止内网地址（10/8、172.16/12、192.168/16、127/8、169.254/8、IPv6 ::1/fc00::/7），含 DNS 重绑定防护（解析后复验 IP，TTL 内 pinning）
- 仅允许 http/https；跟随重定向 ≤ 3 跳，每跳复验
- Content-Type 与 `kind` 一致性校验 + 魔数校验；超限边下边断（图片 20MB / 视频 200MB / 音频 50MB）
- 超时 30s；失败返回 `422 UNFETCHABLE_URL`，不扣费、不建资产

### 8.4 生成任务（核心）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/v1/pricing/quote` | `{ capability, modelId?, params }` → 价格明细（含基础积分、各层折扣、实付积分）+ 余额是否足够（前端点击"创作"前展示） |
| GET | `/v1/pricing/skus` | 对外价目表（前端定价页、套餐对比），含每个模型×规格的积分 |
| GET | `/v1/pricing/skus/:capability` | 某能力下的价目表（如 `/v1/pricing/skus/text_to_video`） |
| GET | `/v1/pricing/promotions` | 当前生效的限时优惠 |
| POST | `/v1/tasks` | 提交生成任务 |
| GET | `/v1/tasks` | 历史列表，支持 `?capability=&status=&type=video|image|audio&cursor=&limit=`（创作记录 + Filter） |
| GET | `/v1/tasks/:id` | 任务详情（轮询降级方案） |
| GET | `/v1/tasks/:id/stream` | **SSE 进度流**（主方案） |
| POST | `/v1/tasks/:id/cancel` | 取消（仅 queued/running 有效；**上游不支持 cancel 时也本地置 cancelled 并全额返还**，避免用户被卡住） |
| POST | `/v1/tasks/:id/retry` | 失败任务重试（新 task + 重新扣减，需用户确认余额） |
| POST | `/v1/webhooks/channels/:channel` | ⚠️ **Phase 2 预留**（本期不注册路由、不传 `notify_url`，纯轮询；见表结构已备 `webhook_events`，启用时补 HMAC 签名校验） |

**POST /v1/tasks 请求体**

```jsonc
{
  "capability": "text_to_video",
  "modelId": "gk-video-3",      // 可选；不填由 Router 决策
  "prompt": "一只柴犬在东京街头骑自行车，电影感运镜",
  "negativePrompt": "模糊，畸变",
  "inputAssetIds": [],
  "params": {
    "resolution": "1080p",
    "aspectRatio": "16:9",
    "durationSec": 10,
    "count": 1
  },
  "idempotencyKey": "uuid-v4"
}
```

**响应 `201`**

```jsonc
{
  "task": {
    "id": "tsk_01HQ...",
    "status": "queued",
    "progress": 0,
    "capability": "text_to_video",
    "model": { "id": "gk-video-3", "displayName": "GK Video 3" },
    "quotedCredits": 13,
    "remainingCredits": 487,
    "createdAt": "2025-01-01T00:00:00Z",
    "estimatedSec": 90
  }
}
```

**任务状态机**

```
queued ──▶ running ──▶ succeeded ──▶ (终态)
   │          │
   │          ├──▶ failed      (终态，退还积分)
   │          └──▶ cancelled   (终态，退还积分)
   └──▶ cancelled              (终态)
   └──▶ timeout                (终态，退还积分)
```

**产物转存流程（任务终态后自动触发）**

任务 `succeeded` 后，Worker 必须：
1. 从 `result_url` 下载产物到我方对象存储（路径：`outputs/{userId}/{taskId}/{filename}`）
2. 生成资产记录 → `assets(kind=output, mime_type, size_bytes, width, height, duration_sec)`
3. 写入 `tasks.result_asset_ids[]`
4. 前端通过 `GET /v1/assets/:id` 访问，不再依赖上游临时链接

**为什么必须转存**：
- 上游 `result_url` 虽声称"稳定"，但不可控（供应商可能删、改、限流）
- 转存后可加水印（Free 用户）、设保留期、控访问权限
- 不因下载失败重提任务（平台已扣费），转存失败只告警不阻塞用户看到结果
- 时序说明（AI 生图右侧结果不显示修复，2026-09-22）：`succeeded` 先发布用于快速反馈，转存完成后补发一次带 `results` 的 `succeeded`；前端收到空 `results` 时需轮询 `GET /v1/tasks/:id` 直到非空，期间显示转存中而非空引导。

**SSE 事件格式**

```
event: progress
data: {"taskId":"tsk_...","status":"running","progress":42}

event: succeeded
data: {"taskId":"tsk_...","status":"succeeded","progress":100,
       "results":[{"assetId":"ast_...","url":"https://...","mimeType":"video/mp4",
                   "width":1920,"height":1080,"durationSec":10}],
       "settledCredits":18}

event: failed
data: {"taskId":"tsk_...","status":"failed","error":{"code":"PROVIDER_ERROR","message":"..."},
       "refundedCredits":18}
```

### 8.4.1 模型选择 + 参数联动 + 价格实时展示

前端 ToolComposer / AppHomePage 的 video/image/audio 视图必须支持：**选模型 → 参数随模型变化 → 价格实时刷新**。

**交互流程**

```
┌─────────────────────────────────────────────────┐
│  ① 加载阶段                                      │
│  GET /v1/catalog/models?capability=text_to_video  │
│  → 返回可用模型列表（含 name, displayName, params）  │
│                                                   │
│  ② 用户选择模型                                    │
│  点击模型 chip → GET /v1/catalog/models/:id        │
│  → 返回该模型的 params 定义：                        │
│    { resolution: ["720p","1080p"],                │
│      duration: ["5","10","15"],                   │
│      aspectRatio: ["16:9","9:16","1:1"] }         │
│                                                   │
│  ③ 参数 chip 动态渲染                               │
│  只显示该模型支持的参数选项                           │
│  默认选中第一个选项                                  │
│                                                   │
│  ④ 参数变化时实时报价                               │
│  用户切换模型/分辨率/时长/比例 →                     │
│  POST /v1/pricing/quote                           │
│  { capability, modelId, params }                   │
│  → { credits: 13 }（gk-video-3 10s；换 hailuo-h3 则变 16）│
│  → 按钮下方显示 "13 积分"                          │
│                                                   │
│  ⑤ 提交生成                                       │
│  POST /v1/tasks                                   │
│  { capability, modelId, params, prompt }           │
│  → 任务创建，积分扣减                                │
└─────────────────────────────────────────────────┘
```

**前端改造要点**

| 组件 | 现状 | 改造为 |
| --- | --- | --- |
| `ToolComposer` 参数 chip | 硬编码 `["720P","1080P"]` `["5秒","10秒"]` `["16:9","9:16","1:1"]` | 由 `GET /v1/catalog/models/:id` 返回的 `params.options` 动态渲染 |
| `ToolComposer` 无模型选择器 | — | 顶部加模型 chip 列表（从 `GET /v1/catalog/models` 加载） |
| `ToolComposer` 无价格显示 | — | 按钮上方显示 `×× 积分`（从 `POST /v1/pricing/quote` 实时获取） |
| `AppHomePage` video/image/audio | 无参数选择器 | 底部 composer 区域加模型 chip + 参数 chip + 价格显示 |

**参数 chip 示例**（用户选了 `gk-video-3` 后）

```
模型: [gk-video-3 ✓] [hailuo-h3] [hailuo-h3-quannengcankao]
分辨率: 固定 720P（无选项）
时长: [6s ✓] [10s]
比例: [16:9 ✓] …（5 种）
                                  预估: 8 积分
```

**参数 chip 示例**（用户切换到 `hailuo-h3-quannengcankao` 后，选项自动变化）

```
模型: [hailuo-h3-quannengcankao ✓] [hailuo-h3] [gk-video-3]
分辨率: [768P ✓] [1080P] [2K] [4K]   ← 全能参考支持 4K
时长: [4s ✓] [5s] … [15s]             ← 4~15s 任意整数
参考: [图] [视频] [音频] 均可选        ← 三参考全OPT，可纯文生
                                  预估: 16 积分   ← 价格不同！
```

**价格展示规则**
- 默认显示"预估 ×× 积分"（因为上游按时段折扣可能微调）
- 实际扣费以任务终态 `settled_credits` 为准
- 若用户余额不足，按钮置灰 + 提示"余额不足，需 ×× 积分"

### 8.5 计费与订阅

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/v1/plans` | 所有订阅计划列表（Free/Pro/Enterprise），含月费、月度积分、权益对比 |
| GET | `/v1/billing/balance` | 积分余额 + 即将到期额度 |
| GET | `/v1/billing/ledger?cursor=&limit=` | 积分流水 |
| GET | `/v1/billing/subscription` | 当前订阅（驱动 `AppHomePage` 侧栏 `planName` + 积分 + `upgrade` 按钮） |
| GET | `/v1/billing/credit-packs` | 积分包列表（starter/basic/pro/max） |
| POST | `/v1/billing/checkout` | ⚠️ Phase 2（本期不做）：创建订阅/点数包支付会话。本期 Pro 开通与积分包发放走运营手动（`admin_adjust`） |
| POST | `/v1/billing/portal` | ⚠️ Phase 2（本期不做）：客户自助门户 |
| POST | `/v1/webhooks/payments/:provider` | ⚠️ Phase 2（本期不做）：支付回调（幂等，按 event id 去重） |

### 8.6 通知

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/v1/notifications?cursor=&limit=` | 通知列表（任务完成/失败、订阅到期、活动推广） |
| POST | `/v1/notifications/:id/read` | 标记已读 |
| POST | `/v1/notifications/read-all` | 全部已读 |
| GET | `/v1/notifications/unread-count` | 未读数（驱动前端红点） |

**通知触发时机**：
- 任务 succeeded → 发送 `task_completed`（含结果资产链接）
- 任务 failed → 发送 `task_failed`（含错误原因和退款金额）
- 订阅到期前 3 天 → 发送 `subscription_expiry`
- 限时优惠上新 → 发送 `promo`（可选）

**通知存储**：`user_notifications` 表（异步写入，不阻塞主流程）。

### 8.7 签到

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/v1/checkin` | 当日签到，返回获得积分 + 当前余额 |
| GET | `/v1/checkin/today` | 查询今日签到状态 |
| GET | `/v1/checkin/history?limit=` | 签到记录（最近 N 天） |

### 8.8 提示词库

对应前端 `PromptLibrary`（首页分区 + tab 筛选 + 卡片 `views/likes` + hover 复制 + 点击深链 `/app?prompt=&img=`）。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/v1/prompt-library` | `{ tabs[], cards[] }`，按 locale 返回；`cards[]` 含 `id/title/img/cat/views/likes`，`views/likes` 取实时计数（非 locale 硬编码） |
| GET | `/v1/prompt-library?cat=game` | 按分类筛选（`all` 返回全部） |
| POST | `/v1/prompt-library/:id/view` | 浏览计数 +1（前端卡片曝光/点击时调用，幂等按 `user_id + date` 去重计 UV） |
| POST | `/v1/prompt-library/:id/copy` | 复制计数 +1，同时返回原文（前端复制按钮先调此接口再写剪贴板） |
| POST | `/v1/prompt-library/:id/like` | 点赞切换（返回 `liked` + 最新 `likes`；为后续前端点赞按钮预留，首期前端可不接） |

**深链闭环**：卡片点击 `/app?prompt={title}&img={imgUrl}` → AppHomePage 预填 prompt + refImg 预览 → 提交时若 `img` 非站内资产，先调 `POST /v1/assets/import-url` 转为 `assetId` 再进入任务链路（见 §4）。

### 8.9 统一错误码

| HTTP | code | 场景 |
| --- | --- | --- |
| 400 | `INVALID_PARAMS` | 参数不合法 |
| 401 | `UNAUTHORIZED` | 未登录 / token 失效 |
| 402 | `INSUFFICIENT_CREDITS` | 积分不足（响应含 `required` / `balance` / `topupUrl`） |
| 403 | `FORBIDDEN` | 计划不支持该能力 |
| 404 | `NOT_FOUND` | |
| 409 | `MODEL_UNAVAILABLE` | 指定模型不可用（响应含 `alternatives[]`） |
| 409 | `DUPLICATE_REQUEST` | 幂等键冲突 |
| 409 | `ALREADY_CHECKED_IN` | 今日已签到 |
| 409 | `TASK_FINAL` | 任务已终态，不可取消（cancel 仅 queued/running 有效） |
| 409 | `ACCOUNT_DELETION_PENDING` | 账号注销处理中 |
| 413 | `PAYLOAD_TOO_LARGE` | |
| 422 | `CONTENT_REJECTED` | 提示词未过前置审核（响应含 `details.layer` = blocklist/llm 与 `categories[]`，按 locale 本地化；不建任务、不扣费） |
| 422 | `PASSWORD_REQUIRED` | 修改密码需提供旧密码 |
| 422 | `UNFETCHABLE_URL` | import-url 拉取失败（SSRF 拦截 / 超时 / 类型不符；不建资产、不扣费） |
| 429 | `RATE_LIMITED` / `TOO_MANY_TASKS` | 限流 / 并发超限（含 `retryAfter`） |
| 503 | `NO_HEALTHY_PROVIDER` | 所有渠道不可用（含 `estimatedRecoverySec`；`details.reason` 可为 `platform_balance`） |

**统一响应结构**

```jsonc
{
  "ok": false,
  "error": { "code": "INSUFFICIENT_CREDITS", "message": "积分不足",
             "details": { "required": 18, "balance": 5, "topupUrl": "/pricing" } },
  "requestId": "req_..."
}
```

---

## 9. 非功能需求

| 类别 | 要求 |
| --- | --- |
| **可用性** | API 服务 99.9%（月度）；Worker 可短暂中断但不得丢任务（依赖 BullMQ 持久化 + 重试） |
| **任务可靠性** | 任务不丢失（DB 持久化 + 队列持久化）；失败自动重试 ≤3 次（指数退避，仅对 `retryable` 错误）；重试换渠道（若策略允许） |
| **一致性** | 积分账本强一致（PG 事务）；任务状态最终一致（Worker 异步更新） |
| **幂等** | 所有写接口 + 所有 webhook 处理必须幂等 |
| **性能** | `POST /v1/tasks` P95 < 3s（含前置审核 LLM 调用；命中审核缓存时 < 300ms）；`GET /v1/tasks` P95 < 200ms；SSE 首字节 < 500ms |
| **并发** | 单用户并发任务上限按计划（Free 1 / Pro 3）；全局按渠道 `rate_limit_rpm` 限流 |
| **超时** | 任务最长 30 分钟，超时标记 failed 并退还；供应商 HTTP 超时 30s（提交）/ 15s（轮询） |
| **安全** | 全站 HTTPS；JWT 密钥轮换；供应商凭据加密存储 + 日志脱敏；对象存储私有桶 + 三类 URL 分权（上传/浏览 15min、交付 4h）；交付 URL 不记日志明文；文件上传类型/大小/魔数校验 |
| **内容安全** | 提交前提示词过两层审核（L1 本地敏感词库 + L2 LLM 二审，§4.2）；`CONTENT_REJECTED` 不建任务不扣积分；源素材图片/视频审核为 Phase 2 |
| **限流** | 按 IP + user_id 双维度；匿名接口（注册/登录）严格限流 + 验证码 |
| **隐私合规** | 提供账号注销与数据删除；生成产物默认私有；保留期策略（Free 产物 30 天，Pro 90 天，可配置） |
| **可观测** | 每个供应商调用打点（耗时/成功率/成本/错误码）；账本日终对账任务；Prometheus 指标 + Grafana 看板；Sentry 告警 |
| **i18n** | 错误消息支持 11 语言（复用前端 `Locale` 枚举：`en/zh-TW/zh-CN/ja/ko/es/fr/de/it/pt/ru`），通过 `Accept-Language` 选择 |
| **国际化存储** | 所有用户生成内容 UTF-8；时间统一 UTC 存储，前端按 locale 渲染 |

---

## 10. 前端改造对接清单

后端就绪后，前端需做的替换（保持 UI 1:1 不变）：

| 前端位置 | 现状 | 改造为 |
| --- | --- | --- |
| `HeroComposer.tsx` `startMock()` | `setInterval` 假进度 | `POST /v1/tasks` → SSE `/v1/tasks/:id/stream` |
| `HeroComposer.tsx` 无模型选择 | 用户无法选模型 | 提交前弹出模型选择面板（或默认用 Router 自动选最优模型） |
| `ToolComposer.tsx` `generate()` | `setTimeout` 2200ms | 同上，成功后渲染真实 `results[0].url` |
| `AppHomePage.tsx` `create()` | 空跑进度 | 同上 |
| `AppHomePage.tsx` 侧栏积分 | 硬编码 `0` | `GET /v1/billing/balance` + 签到按钮 `POST /v1/checkin` |
| `AppHomePage.tsx` `planName` | 硬编码"免费方案" | `GET /v1/billing/subscription` |
| `AppHomePage.tsx` 创作记录 | 无数据 | `GET /v1/tasks?type=video` |
| `AppHomePage.tsx` 资产视图 | 4 个占位块 | `GET /v1/assets` |
| `ToolComposer` 参数 chip | 硬编码 720P/1080P、5秒/10秒、16:9 等 | 由 `GET /v1/catalog/models/:id` 返回的 params.options 动态渲染，模型切换时选项自动变化 |
| `ToolComposer` 模型选择器 | 无 | 顶部加模型 chip 列表（从 `GET /v1/catalog/models` 加载），切换后参数联动 |
| `ToolComposer` 价格显示 | 无 | 按钮上方显示"预估 ×× 积分"（从 `POST /v1/pricing/quote` 实时获取） |
| `AppHomePage` video/image/audio 视图 | 无参数选择器 | 底部 composer 区域加模型 chip + 参数 chip + 价格显示（同 ToolComposer 逻辑） |
| 首页 `models[]` | 硬编码 14 个模型名 | `GET /v1/catalog/models` |
| `AppHomePage` `app.quick[]` 模板 | 硬编码 7 个 | `GET /v1/catalog/templates`（响应含 prompt/refImgUrl，深链预填同提示词库） |
| 提示词库（首页分区） | tabs/cards/views/likes 硬编码在 locale | `GET /v1/prompt-library` + view/copy/like 上报（§8.8） |
| 参考图深链（`?img=`） | 仅前端预览，提交时丢失 | 提交前 `POST /v1/assets/import-url` 转 assetId（§8.3） |
| `SiteHeader` `login` / `startFree` | 无跳转 | 登录/注册流程 |
| 上传控件 | 仅取 `file.name` | `POST /v1/assets/upload-url` → 直传 S3 → `POST /v1/assets` |
| `ToolComposer` 提交按钮 | 直接 generate | 先 `POST /v1/pricing/quote` 展示将消耗点数（如"13 积分"；余额不足时按钮置灰并提示签到领取） |
| `PriceTier` 定价卡（`pricing/page.tsx`） | 硬编码 3 档价格 | `GET /v1/pricing/skus` + `GET /v1/plans` + `GET /v1/billing/credit-packs` |
| `SiteHeader` 侧栏 | 无用户信息 | `GET /v1/auth/me` → 头像/昵称 + `PATCH /v1/users/me` 编辑 |
| `AppHomePage` 通知 | 无 | `GET /v1/notifications/unread-count` 驱动红点 |

**建议**：新增 `src/lib/api/` 客户端封装 + TanStack Query 管理服务端状态，替换所有 `useState` mock。

---

## 11. 里程碑与交付计划

| 阶段 | 内容 | 产出 | 工期（估） |
| --- | --- | --- | --- |
| **M0 基础设施** | Fastify 骨架、PG/Prisma schema + 迁移、Redis/BullMQ、Docker compose、CI、日志/指标 | 可部署的空服务 + `docker-compose` 新增 `api`/`worker`/`db`/`redis` | 1 周 |
| **M1 认证 + 资产 + 用户** | 注册/登录/JWT/OAuth、资产直传、资产库 API、**用户资料 PATCH、密码修改、账号注销** | 前端可登录、上传文件、编辑资料 | 2 周 |
| **M2 任务核心** | Task 状态机、BullMQ Worker、LK888 适配器 + Mock Provider、SSE 进度、**产物转存流程**、**Prompt 前置审核**、轮询调度 | 能真实生成一条视频并回传到我方存储 | 2 周 |
| **M3 计费闭环** | 账本、提交扣减/失败返还、**quote / SKUs / plans / credit-packs API**、订阅与额度（运营手动发放，无支付）、并发控制 | 完整商业闭环跑通 | 1.5 周 |
| **M4 签到 + 通知 + 多模型** | **签到、通知机制**、18 模型参数映射已验证、按首期上架名单接入（★）、Router 策略、熔断降级、成本同步 | 多模型可运营 | 2 周 |
| **M5 前端联调** | 按 §10 替换全部 mock、修正模型名、错误态/空态/加载态、端到端测试 | 前端全量接真后端 | 1.5 周 |
| **M6 上线准备** | 内容安全、限流加固、对账任务、监控告警、压测、更换暴露的 API Key、文档 | 生产可用 | 1 周 |

**合计约 11 周**（1 名后端 + 1 名前端；M4/M5 可并行缩短至 ~9 周）。

> POC 已跑通（视频生成 + LLM），M2 的核心不确定性已消除，工期比 v0.1 预估更乐观。

### 11.1 优先级（MoSCoW）

| 优先级 | 内容 |
| --- | --- |
| **Must** | 认证 + 用户资料/密码/注销、资产直传 + **产物转存**、任务状态机 + Worker、LK888 适配器 + 2~3 个模型、积分扣减/失败返还、**quote / SKUs / plans**、SSE 进度、创作记录、错误处理、**Prompt 前置审核** |
| **Should** | 多模型 Router + 熔断降级、订阅与额度重置（运营手动发放）、成本同步与毛利告警、并发控制、图片/视频输入审核、**签到**、**通知机制**、**credit-packs API**、**提示词库后端**、**assets/import-url** |
| **Could** | 多 Key 分组 fallback、灰度分流、模板库 API、模型目录动态下发、使用量统计、语言偏好持久化 |
| **Won't（本期）** | 运营后台界面、CMS、团队/企业权限、Canvas/Editor 协同、社交分享、搜索、支付功能（checkout/portal/支付回调，Phase 2） |

---

## 12. 风险与对策

| 风险 | 影响 | 对策 |
| --- | --- | --- |
| **供应商 API 不稳定 / 频繁变更** | 生成失败率高 | Provider 接口隔离变更；熔断 + 自动换模型；契约测试；每日同步模型目录检测上下线 |
| **成本数据过期/同步失败导致毛利侵蚀** | 用户价基于过期成本，实际毛利低于 30% | `task_costs` 独立记录 + 每日 2 次同步；毛利看板告警（P0: 7 日毛利率 < 0%；P1: < 20%）；同步失败保留旧价并告警 |
| **积分超卖 / 重复扣费** | 资损 + 信任危机 | 提交即扣（行锁串行化）+ 失败即返（幂等）；DB 行锁；幂等键唯一索引；日终对账告警 |
| **按秒模型 10 秒预扣吃掉平台余额** | 用户够钱但平台提交失败 | 提交前用 `/v1/skills/balance` 预检平台余额；余额低于 10× 最高单次成本时告警 |
| **渠道 fallback 补差额失败** | 任务整单失败 | 用户侧全额 release；成本侧记 `platform_refunded=true`，成本计 0 |
| **同步间隔内上游成本骤涨** | 两次同步之间出现负毛利订单 | `min_price` 单日涨幅超 20% 自动下线模型 + 告警；已创建任务按快照价结算，不受影响 |
| **`result_url` 下载失败被误判为任务失败** | 重复扣费 | 下载重试 3 次；**绝不因下载失败重提任务**（平台已扣费） |
| **视频生成耗时长，用户等待流失** | 转化率低 | SSE 真实进度（实测 gk-video-3 约 79s，omni 系约 120s，可按模型历史耗时估算）；排队位置提示 |
| **提示词/素材违规** | 法律风险 | 提交前内容安全校验；`CONTENT_REJECTED` 不扣积分；审计日志 |
| **Worker 单点故障** | 任务卡死 | BullMQ 持久化 + 多 Worker；`stalled` 重入队；30 分钟超时兜底 |
| **整机单点故障**（同机部署） | 全站不可用 + 数据丢失风险 | PG 每日 dump + MinIO volume 备份到宿主机目录，保留 7 天 + 异地拷贝；按 `docker compose` 一键重建恢复 |
| **API Key 泄露（当前已明文暴露）** | 资损 | **M6 必须更换 Key**；Key 池支持快速切换；配额监控告警 |
| **平台账户余额耗尽** | 全站生成不可用 | 我方需监控平台余额（每日 `/v1/skills/balance`），低于阈值告警并自动降级到免费模型/停服提示 |

---

## 13. 验收标准（Acceptance Criteria）

1. **闭环可用**：新用户注册 → 获得 **20** 积分 → 签到获得 **5** 积分 → 提交 text-to-video 任务 → 提交时扣减积分 → 任务完成（无二次扣费）→ 成片可在创作记录中查看与下载。
2. **注册赠送**：注册后 `credit_ledger` 出现 `type=grant_signup, delta=100`，余额为 100。
3. **签到**：首次签到成功返回 `credits: 5`；同一天重复签到返回 `409 ALREADY_CHECKED_IN`；第二天签到获得新的 5 积分。
4. **失败退款**：人为让渠道返回失败，验证积分**全额返还**，账本出现成对的 `task_deduct` 与 `task_refund`，且重复触发终态不二次返还。
5. **不超卖**：并发 100 个请求、账户仅够 10 个任务，验证恰好 10 个成功、90 个返回 `402`，最终余额 ≥ 0。
6. **幂等**：同一 `Idempotency-Key` 重复提交 10 次，只创建 1 个任务、只扣 1 次积分。
7. **多模型路由**：配置 `gk-video-3` 权重 100、其他 0 → 全部走 `gk-video-3`；将其置为熔断 → 自动切备用模型；恢复 → 自动切回。
8. **新增模型成本**：新增一个 LK888 模型（含参数映射 + 配置）≤ **2 小时**，且不修改任何业务模块代码。
9. **进度可见**：SSE 在任务状态变化时 1 秒内推送；断线后前端重连可恢复当前状态。
10. **前端 mock 清零**：§10 清单中全部 mock 被真实 API 替换，`grep setInterval|setTimeout src/components/sites/vutu` 无生成相关残留。**且前端硬编码的 12 个模型名已替换为平台真实模型名**（已移除 Vidu Q3、Kling V3、Kling Omni）。
11. **价格跟随上游同步**：修改某模型的上游成本后触发一次同步任务，验证 `quote` 返回按新成本×1.3 重算的积分；同步前已创建的任务仍按 `price_snapshot` 快照价扣减，不受影响。
12. **折扣叠加正确**：Pro 用户（9 折）+ 限时 75 折 + 优惠券同时生效时，验证实付积分按序叠加计算正确，且不低于 1 积分下限。
13. **成本异常自动下线**：模拟某模型 `min_price` 单日涨幅超 20%，验证同步任务告警并自动下线该模型；`quote` / `tasks` 对该模型返回 `MODEL_UNAVAILABLE`（含 `alternatives`）。
14. **三口径成本核算正确**：分别用按次（`omni-flash`）、按秒（`hailuo-h3`）、按 token（`doubao-seedance-2-5-260628`）模型各跑一次，验证 `task_costs` 记录真实成本，且用户扣费等于按公式计算的积分值。
15. **可观测**：Grafana 看板可见每个模型的 QPS / 成功率 / P95 耗时 / **毛利率**；账本日终对账无差异；平台余额低于阈值有告警。
16. **产物转存**：任务成功后 `result_asset_ids[]` 非空，`assets` 表有对应记录，前端通过 `GET /v1/assets/:id` 可下载。
17. **通知**：任务完成后 `GET /v1/notifications/unread-count` 返回 1，`GET /v1/notifications` 含任务结果链接。
18. **账号注销**：`POST /v1/account/delete` 后用户数据删除，登录返回 401。
19. **模型差异化定价**：同一规格（如 10s）下，对 `gk-video-3` / `hailuo-h3` / `hailuo-h3-quannengcankao`（1080P）逐个调 `quote`，验证返回积分各不相同（13 / 16 / 32）且等于 `ceil(成本×18.84)`；前端切换模型 chip 时价格实时变化，不允许出现换模型价格不变的情况。
20. **提示词库闭环**：`GET /v1/prompt-library` 返回 tabs/cards 与实时 views/likes；调 copy 接口后 `copies` +1；点击卡片深链进 App，提交任务时 refImg 已转为站内 assetId（`input_asset_ids[]` 非空）。
21. **URL 资产导入安全**：对 `POST /v1/assets/import-url` 分别传入内网地址、超大文件、非法 Content-Type，验证全部被拒（4xx）且无资产残留、无扣费。
22. **参考图交付链路**：用站内资产作参考图提交图生视频任务，验证传给上游的是 4h 交付 URL（非 15min 浏览 URL）；模拟首次 submit 后等待 URL 过期再重试，验证重试前重新签发（两次 submit 的 URL 不同）且任务最终成功。
23. **Prompt 前置审核**：分别提交含 blocked 词的 prompt（含藏在 negativePrompt 里的）、涉政擦边 prompt、正常 prompt，验证前两者 422（`details.layer` 分别为 blocklist/llm，不建 task、无 ledger 流水），正常 prompt 通过；断开 LLM 二审模拟超时，验证放行 + 有告警日志。

---

## 14. 待确认事项

| # | 问题 | 影响 | 状态 |
| --- | --- | --- | --- |
| 1 | **首期接入渠道** | 决定 M2/M4 工作量 | ✅ **已定：灵客 AI / LK888**，已 POC |
| 2 | **首期上架名单拍板** | 锁死 9 个模型位（§6.3 ★），后续增减只改 `active` 配置 | ✅ 已定 |
| 2b | **seedance-2-5 价格 POC** | ✅ **不跑 POC**：guanfang 2.0/2.5 按公式价上架，靠每日同步自动校准 + 首单复核兜底；doubao 版保持 OFF |
| 3 | **1 算力是否等于 1 RMB？** | 影响成本换算与毛利计算准确度 | ❌ 待与平台核实 |
| 4 | **支付渠道** | ✅ **本期不做支付功能**：checkout/portal/支付回调移 Phase 2；Pro 开通与积分包发放走运营手动（`admin_adjust`） |
| 5 | **是否自研/微调模型**（6 个月内）？ | 若"是"，技术栈改 Python FastAPI | ❌ 待定（当前按"否"设计） |
| 6 | **是否要多 Key 分组 fallback**？ | 增加 M4 工作量约 3 天 | ❌ 待定（当前列为 Could） |
| 7 | **生成产物保留期**与存储预算？ | 存储成本与清理策略（Free 30 天，Pro 90 天已定，需确认预算） | ❌ 待确认 |
| 8 | **图片/视频输入审核**方案（文本 prompt 审核已定：自建词库 + LLM 二审） | M6 工作量 | ❌ 待定 |
| 9 | **部署环境**：云厂商 / 自建？地区（国内备案）？ | 部署方案与对象存储选型 | ✅ **已定：与前端同一台服务器**，Docker Compose 同栈（§3.6），对象存储默认同机 MinIO |
| 10 | **视频翻译能力** | ✅ **本期不做**（入口隐藏；Phase 2 再议） |
| 11 | **数字人（口播虚拟人）** | ✅ **本期不做**（avatar_talk 保持空 capability，catalog 自动过滤；形象与接口已验证，Phase 2 直接启用） |
| 12 | **通知渠道** | ✅ **只做站内信**（表与接口已设计；邮件等有真实需求再加） |
| 13 | **订阅使用率假设验证**（70%） | 额度按 70% 使用率设计；若实际 >85% 需紧急降额度，<50% 可加量促留存 | 上线后 30 天看数据 |

---

## 15. Phase 2 预留设计：Viral Remix（视频解析再造）

> 来源：前端 `guide/viral-studio` 文案定义的产品流程（4 步）。AppHomePage viral 视图目前是静态 mock，本节只定数据模型 + API 草图 + 计费，不进首期开发。

**流程**：贴 URL / 传视频 → **视频解析（固定 1 积分）** → 按场景拆分（>15s 自动分段）→ 每场景独立 prompt → 全域参考素材 → 逐场景生成 → Editor 组装。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/v1/remix/analyze` | `{ videoUrl }` / `{ assetId }` → 下载 → 按场景拆分 → LLM 视觉分析每场景 → 返回 `analysisId + scenes[{ index, startSec, endSec, prompt, thumbAssetId }]`；固定扣 **1 积分**（成功才扣，失败退还） |
| GET | `/v1/remix/:id` | 解析结果（含场景 prompts，可编辑后存回） |
| PATCH | `/v1/remix/:id/scenes/:idx` | 修改某场景 prompt / 绑定全域参考资产 |
| POST | `/v1/remix/:id/generate` | 对选定场景逐个创建生成任务（走正常任务链路，各自计费）；返回 `taskIds[]` |
| POST | `/v1/remix/:id/global-refs` | 设置全域参考资产（角色/产品/风格图），生成时自动注入各场景 |

```sql
remix_projects         id, user_id, source_asset_id, source_url,
                       status(analyzing|ready|generating|done|failed),
                       analysis_credits, created_at
remix_scenes           id, project_id, idx, start_sec, end_sec,
                       prompt, thumb_asset_id, task_id?, status
remix_global_refs      id, project_id, asset_id, kind(character|product|style)
```

**计费**：解析固定 1 积分（`ledger.type=remix_analysis`）；场景生成按模型正常计费。MoSCoW：Could。

---

## 附录 A：版本管控与变更记录

**版本规则**：`0.x` = 草稿（评审中，每次评审迭代 +0.1）；`1.0` = 首次评审通过基线；
基线后小改 +0.1（如 1.1）， breaking 级变更升主版本（如 2.0）。本文档当前为草稿。

| 版本 | 变更 |
| --- | --- |
| v0.1 | 单一公式 credits = cost × factor，与上游成本强绑定 |
| v0.2 | 引入 LK888 真实渠道，三口径计费（按次/按token/按秒），用户价需标注"预估" |
| v0.3 | 定价与上游成本解耦：独立产品价目表、三层折扣、USD 官方价 + 积分 |
| v0.4 | **定价简化为 cost×1.3**：① 公式 `credits = ceil(costUnits × 18.84)`；② 图片表增加 `tt-image-2`/`tt-image-2.5` 系列（成本低至 1 积分/张）；③ 每日 2 次自动同步上游价格并重算积分（`price_sync_log`）；④ 价目表按分辨率×时长×模型展开为矩阵 |
| **v0.5** | **18 视频模型全量实测入库**：grok→GK 改名确认、omni 系 4 模型、5 个图生模型定价实测；价目表改原生时长档 + 能力矩阵；params 开放键值；costUnits 三口径规则。**交付 URL 机制**：上传/浏览/交付三权分立（交付 4h，Worker 每次 submit 现签，重试重签；AWS S3 预签名 v4 为生产推荐）；**Prompt 前置审核**（L1 敏感词库 + L2 LLM 二审，违规直接 422，不建任务不扣费）；**图片模型收敛**（仅 tt-image-2 / tt-image-2.5，移除 seedream/banana/kling/mj/token 版）；**删除连续签到奖励**（签到只保留每日固定积分）；**订阅额度修正**（Pro 2000+15/天→1000/月含签到，Free 10/天→5/天，max 包 10000→7500；原方案必亏 $8.85/人/月）；**对客展示名分离**（tt-image-2/2.5 对客显示为 GPT Image 2/2.5，`models.display_name` 为唯一真源）；**计费改提交即扣失败即返**（取消预留-结算两段式；`task_deduct`/`task_refund` 替代 hold/capture/release，返还幂等）；**移除 viduq3**（路由/定价/示例/前端展示全删，POC 历史保留在能力文档）；**订阅三定**（年付 $99=9000 积分保 30% 毛利；Pro 月付 1000 与签到叠加；注册送 100 积分 7 天有效）；**minimax-h3 被 hailuo-h3-quannengcankao 替代**（同价，三参考全OPT可纯文生；minimax 数据保留为 OFF）；**Seedance 改用官方满血版**（seedance-2.0-guanfang / 2.5-guanfang，对外仅分 Seedance 2.0 / 2.5；2.0 按token约 55~310，2.5 约 84~425）；**移除 Kling 系全部模型**（kling-v3-video/kling-avatar-image2video 及路由/定价/示例/验收/前端展示；avatar_talk 暂无模型，数字人待选）；**部署环境落定**（与前端同一台服务器，Docker Compose 同栈，§3.6；对象存储默认同机 MinIO）；**去掉 hailuo-h3-shouweizhen / omni_flash-10s / omni_flash-10s-fl**（转 OFF 保留数据；上架 9 模型位）；**支付功能移 Phase 2**（checkout/portal/回调不做，Pro 开通走运营手动）；**seedance 不跑 POC**（guanfang 按公式价上架，靠同步+首单复核） |
| v0.5.1 | 生图结果显示修复：转存完成后补发 `succeeded` 事件，前端空结果轮询至多 30 秒并显示转存中态 |

---

## 附录 B：前端现有实体与后端映射

| 前端类型（`site-data.ts`） | 后端实体 | 备注 |
| --- | --- | --- |
| `AppQuick { t, s?, img }` | `templates`（响应扩展 `prompt/refImgUrl/capability/modelId?/params?`，支持深链预填） | 快速开始模板（点击预填 prompt + 参考图，逻辑同提示词库卡片） |
| `PromptCard { title, views, likes, img, cat }` | `prompt_posts` + `prompt_post_events`（§8.9） | 提示词库（tabs/cards/计数/复制追踪） |
| `PriceTier { name, price, period, features, cta, hot }` | `plans` | 三档：免费版 / 专业版 / 企业版 |
| `Testimonial { name, role, quote, avatar }` | 本期不做（静态 i18n） | |
| `Stat { value, label }` | 本期不做（静态） | 3000万+ 创作者 / 1亿次生成 / 238 国家 |
| `Faq { q, a }` | 本期不做（静态 i18n） | |
| `Locale`（11 种） | `users.locale` + 错误消息 i18n | `en/zh-TW/zh-CN/ja/ko/es/fr/de/it/pt/ru` |
| `AppSection.tools[]`（AI 视频/图像/音频/画布/编辑器） | `capabilities` | |
| `AppSection.studios[]`（爆款工作室/口播虚拟人/视频翻译） | `capabilities` | `viral_remix` / `avatar_talk` / `video_translate` |
| `AppSection.quick[]` | `templates` | |

## 附录 C：能力与前端视图映射

| 前端视图（`View` 枚举） | capability | 说明 |
| --- | --- | --- |
| `video` | `text_to_video` | 主工具 |
| `image` | `text_to_image` / `image_to_image` | |
| `audio` | `text_to_audio` / `tts` | |
| `canvas` | — | 创作画布，**本期不做**（无后端状态） |
| `editor` | — | 时间线编辑器，**本期不做** |
| `viral` | `viral_remix` | 爆款工作室 |
| `avatar` | `avatar_talk` | 口播虚拟人 |
| `translate` | `video_translate` | 视频翻译 |
| `assets` | — | 资产库（`GET /v1/assets`） |
| `explore` | — | 探索（本期静态） |
| `support` / `language` | — | 静态视图 |

## 附录 D：LK888 平台约束速查（开发必读）

| 约束 | 说明 |
| --- | --- |
| **渠道路由不可覆盖** | `channel_group` 字段与 `X-Channel-Group` 头均被忽略；分组 fallback 需多把 Key |
| **成功判定不一致** | `/v1/media/generate` 判 `code=200`；`/v1/skills/*` 判有无 `error` 对象 |
| **任务 ID 字段** | 读 `data.task_id`；`任务ids`/`对话组ID`/`成功数量` 即将下线 |
| **终态判定** | 必须看 `is_final=true`，不能只看 `status` 文本 |
| **视频输入** | 不支持 base64，必须公网 URL |
| **图片/音频输入** | 支持 `data:<mime>;base64,`，单文件 ≤10MB 解码后、单次 ≤30MB、请求体 ≤50MB |
| **必填参数** | `required=true` 参数必须传（如 `hailuo-h3` 全参数 REQ），平台不填默认值 |
| **结果下载** | `result_url` 稳定直链；失败只重试下载，**绝不重提任务** |
| **失败重试判断** | `refunded=true` 可原样重提（5-30s 间隔）；内容政策类改提示词；参数类重试无效 |
| **按 token 陷阱** | `base_price=0` 不代表免费，用 `output_token_price` 估算 |
| **按秒陷阱** | 无 duration 时按 10 秒整单预扣 |
| **缺失能力** | 无 ASR、无语音翻译、无 embedding |
| **价格时效** | 时段折扣会导致价格变化，报价缓存 TTL ≤ 5 分钟 |
| **余额预检** | 提交前调 `/v1/skills/balance`，平台余额耗尽会导致全站不可用 |

完整清单见 `docs/lk888-capabilities.md`。
