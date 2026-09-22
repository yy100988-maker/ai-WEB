# Vutu 后端服务

Fastify 5 + TypeScript 5（strict）+ PostgreSQL 16 + Redis 7 / BullMQ + MinIO（S3）+ Prisma 6。

对应需求：`../docs/backend-prd.md` v0.5 ｜ 详细设计：`../docs/backend-detailed-design.md` v0.4。
模块契约（开发必读）：[`CONTRACT.md`](./CONTRACT.md)。

---

## 快速开始（本地）

```bash
# 1. 起依赖（PG 5433 / Redis 6380 / MinIO 9000）
docker compose -f docker-compose.test.yml up -d

# 2. 装依赖
npm install

# 3. 配置环境变量
cp .env.example .env
# 把 DATABASE_URL 改为 postgresql://vutu:vutu@127.0.0.1:5433/vutu?schema=public
# 把 REDIS_URL 改为 redis://127.0.0.1:6380
# MOCK_PROVIDER=true（本地联调不花钱）

# 4. 建表 + 灌数据
npx prisma migrate deploy
npx prisma generate
npm run seed

# 5. 起服务（两个进程）
npm run dev          # API  :8080
npm run dev:worker   # Worker
```

健康检查：`curl http://localhost:8080/v1/health`

---

## 部署（与前端同机的独立 Docker Compose 栈）

拓扑：

```
浏览器 ──HTTPS──▶ nginx(443, 宿主机)
                    ├── /api/*  ──▶ 127.0.0.1:8080  (vutu-api 容器)
                    └── /*      ──▶ 127.0.0.1:3000  (ai-cloner 前端)
                 api / worker / postgres / redis / minio
                 全部只绑定 127.0.0.1，不对公网暴露
```

服务器上：

```bash
cd /opt/vutu-backend
cp .env.example .env && chmod 600 .env   # 填 PG_PASSWORD / S3_SECRET_KEY / JWT_SECRET / ADMIN_TOKEN
./deploy/deploy.sh                        # 构建 → 起基础设施 → 迁移 → seed → 起 api/worker
sudo ./deploy/setup-nginx.sh              # 装 nginx /api 反代并 reload
```

验证：

```bash
curl https://ai.vutu.cc/api/health
curl https://ai.vutu.cc/api/v1/catalog/models
```

---

## 架构要点

### 提交链路（`POST /v1/tasks`）

```
鉴权 → 参数校验 → Prompt 前置审核(L1词库+L2 LLM二审，违规 422 不扣费)
     → Router.pick → quote(读 price_items) → 原子扣减(402 余额不足)
     → 落库 task(queued) → BullMQ 入队 → 201
```

**提交即扣、失败即返**：提交时原子扣减报价积分，成功无二次操作，失败/取消/超时全额返还。
并发提交靠 `pg_advisory_xact_lock` 串行化同一用户，杜绝超卖。

### 账本不变式（最重要）

> **余额 = `SUM(credit_ledger.delta)` 全量求和，绝不用 `expires_at` 过滤。**

过期语义由每日 00:00 任务写 `type=expire` 负向流水表达。反例见详细设计 §2.5：
signup 送 100（7 天过期）、当天花 30；若按行过滤过期批次，7 天后余额会算成 **−30**（凭空扣负）。
用 `SUM(delta)` + `expire` 流水则为 `100 − 30 − 70 = 0`，正确且可审计。

### 三类 URL 三权分立（严禁混用）

| 类型 | 用途 | 有效期 | 可见范围 |
|---|---|---|---|
| 上传 URL | 前端直传 PUT | 15min | 仅上传者 |
| 浏览 URL | 前端预览/下载 | 15min | 仅资产 owner |
| **交付 URL** | **上游供应商拉取输入** | **4h** | 仅渠道，不下发前端、不记日志明文 |

交付 URL 必须独立：视频出片 2~14 分钟 + 排队重试，15min 的浏览 URL 必然过期 →
供应商下载失败 → 任务失败但平台已扣费。**Worker 每次 submit（含重试）前重新签发。**

### Worker 终态判定

必须看上游的 **`is_final === true`**，不能只看 `status` 文本（LK888 平台约束，见 PRD 附录 D）。
`POST /media/generate` 判 **`code === 200`**（不是 HTTP 状态）。

---

## 自动化测试

按测试金字塔（详细设计 §7）：

| 层 | 命令 | 覆盖 |
|---|---|---|
| 单元 | `npm test` | 定价公式/参数映射/账本数学/路由权重/审核/时区 |
| 集成 | `npm run test:int` | 真 PG/Redis：并发不超卖、幂等、退款、转存、验收映射 |
| 契约 | `npx vitest run tests/contract` | LK888 报文解析（nock mock，**不真连上游**） |
| E2E | `npx vitest run tests/e2e` | 注册→签到→报价→提交→转存→通知全闭环 |

集成/E2E 需要 PG/Redis：

```bash
docker compose -f docker-compose.test.yml up -d
$env:TEST_DATABASE_URL="postgresql://vutu:vutu@127.0.0.1:5433/vutu?schema=public"
$env:TEST_REDIS_URL="redis://127.0.0.1:6380"
npm run test:int
```

> 依赖不可达时集成/E2E 会**自动跳过**而非报红，便于无 Docker 环境跑单测。

### 不花钱保证

`MOCK_PROVIDER=true` 时 `getProvider()` 一律返回 `MockProvider`，
**绝不发起对 `api.lk888.ai` 的真实请求**。压测与 CI 强制此开关（详细设计 §7.6）。
`LingkeProvider` 完整实现但仅在上游开关关闭时被选中。

---

## 环境变量

见 [`.env.example`](./.env.example)。关键项：

| 变量 | 说明 |
|---|---|
| `MOCK_PROVIDER` | `true` = 全部走 Mock，零上游费用 |
| `USD_TO_CNY` / `MARKUP` / `CREDITS_PER_USD` | 定价三常数，改此即改全站价（默认 6.9 / 1.3 / 100） |
| `LK_API_KEYS` | JSON 数组或逗号分隔的多 Key 池；⚠️ 上线前必须轮换 |
| `JWT_SECRET` / `ADMIN_TOKEN` | 分开管理，≥32 字节随机 |

**积分公式**：`credits = ceil(costUnits × MARKUP × CREDITS_PER_USD ÷ USD_TO_CNY) = ceil(costUnits × 18.84)`

---

## 定时任务（node-cron + Redis leader 锁）

| 任务 | 频率 | 逻辑 |
|---|---|---|
| 价格同步 | 02:00 / 14:00 | 拉上游 pricing → 三口径重算 → `price_items`；涨超 20% 自动下线 + 告警 |
| 额度重置 | 00:05 | 签到额度清零（写 `expire` 流水）+ signup 7 天过期扫描 + Pro 月度重置 |
| 账本对账 | 03:00 | 逐用户 `SUM(delta)` 对比 `balance_after`，差异 P0 告警 |
| 超时扫描 | 每 5min | `running` 超 30min → `timeout` → 全额返还（兜底轮询漏网） |
| 平台余额监控 | 每小时 | 余额低于阈值 → P0 告警 + 新提交 503 |
| 产物清理 | 04:00 | 超保留期（Free 30 天 / Pro 90 天）软删 + S3 删除 |

---

## 目录结构

```
src/
  core/            冻结契约层（types/errors/config/db/redis/storage/ids/crypto/pricing-math/http）
  modules/
    auth/          注册/登录/JWT 轮换/OAuth/用户资料/密码/注销
    billing/       账本/定价引擎/并发控制/订阅/定时任务逻辑
    providers/     GenerationProvider 实现（Lingke + Mock）+ 注册表 + 参数校验
    router/        Router.pick 加权路由 + 熔断器
    tasks/         任务服务/状态机/队列/SSE 事件
    assets/        直传/import-url(SSRF 防护)/资产库
    catalog/       能力/模型/模板目录下发
    checkin/       签到（时区规则）
    notifications/ 站内信
    prompts/       提示词库
    moderation/    L1 词库 + L2 二审
    admin/         最小运营接口
  workers/         BullMQ 消费者 + 结算 + 产物转存
  cron/            定时任务调度
  main.ts          API 入口
  worker.ts        Worker 入口
prisma/            schema + migrations + seed
tests/             helpers / integration / e2e / contract
deploy/            deploy.sh / setup-nginx.sh / nginx 配置
```
