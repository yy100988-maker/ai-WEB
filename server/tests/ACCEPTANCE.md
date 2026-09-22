# PRD §13 验收标准 —— 测试映射表

> 对应 `docs/backend-prd.md` §13（23 条）与 `docs/backend-detailed-design.md` §7.7 发布门禁检查表。
>
> 运行方式见 `README.md`。**全部测试使用 `MOCK_PROVIDER=true`，不调用真实生图生视频上游 API。**

## 状态说明

| 标记 | 含义 |
|---|---|
| ✅ 自动 | 有可执行自动化测试，纳入 CI 门禁 |
| ⚠️ 部分 | 有测试覆盖但需人工复核（如看板、告警） |
| 🔧 人工 | 依赖生产环境/监控看板，无法在 CI 内自动验证 |

---

## 逐条映射

| # | 验收项 | 测试位置 | 状态 |
|---|---|---|---|
| 1 | **闭环可用**：注册→20/100 积分→签到→提交→扣减→完成→记录可见 | `tests/e2e/core-flow.e2e.test.ts` → `E2E-1` | ✅ 自动 |
| 2 | **注册赠送**：`grant_signup, delta=100`，余额 100 | `E2E-1`（断言 ledger 行 + balance） | ✅ 自动 |
| 3 | **签到**：首次 5 积分；重复 409 `ALREADY_CHECKED_IN`；次日可再签 | `E2E-1` + `tests/integration/billing.int.test.ts` → 签到并发双击 | ✅ 自动 |
| 4 | **失败退款**：全额返还，成对 `task_deduct`/`task_refund`，不二次返还 | `E2E-3` + `billing.int.test.ts` → 退款幂等 | ✅ 自动 |
| 5 | **不超卖**：并发抢额度，成功数 ≤ 余额允许，余额 ≥ 0 | `billing.int.test.ts` → 并发抢额度 | ✅ 自动 |
| 6 | **幂等**：同 `Idempotency-Key` 重放 10 次 → 1 task + 1 次扣费 | `billing.int.test.ts` → 幂等重放 | ✅ 自动 |
| 7 | **多模型路由**：权重 100 全走该模型；熔断自动切换；恢复切回 | `tests/integration/acceptance.int.test.ts` → §13 #7 + `src/modules/router/*.test.ts` | ✅ 自动 |
| 8 | **新增模型成本 ≤2h**：只改配置不改业务代码 | 结构性保证（`models` 表 + `param_mapping` jsonb 驱动）；`src/modules/providers/validate.test.ts` | ⚠️ 部分 |
| 9 | **进度可见**：SSE 状态变化 1s 内推送；断线重连恢复 | `acceptance.int.test.ts` → §13 #9（SSE 端点 + 事件流） | ✅ 自动 |
| 10 | **前端 mock 清零** + 硬编码模型名替换 | `acceptance.int.test.ts` → §13 #10（`displayName` 无渠道代号泄露）+ CI grep 检查 | ⚠️ 部分（前端改造属 M5） |
| 11 | **价格跟随上游同步**；已创建任务按快照价 | `acceptance.int.test.ts` → §13 #11（快照价不变） | ✅ 自动 |
| 12 | **折扣叠加正确**：Pro 9 折 + 75 折 + 券，≥1 积分下限 | `acceptance.int.test.ts` → §13 #12 + `src/modules/billing/engine.test.ts` | ✅ 自动 |
| 13 | **成本异常自动下线**：涨幅 >20% 告警 + `active=false` + `MODEL_UNAVAILABLE` | `acceptance.int.test.ts` → §13 #13 + `src/modules/billing/price-sync.ts#detectCostAnomaly` | ✅ 自动 |
| 14 | **三口径成本核算**：按次/按秒/按 token | `acceptance.int.test.ts` → §13 #14 + `src/core/pricing-math.ts` 单测 | ✅ 自动 |
| 15 | **可观测**：QPS/成功率/P95/毛利率看板；对账无差异；余额告警 | `src/modules/billing/jobs.ts#reconcileLedger` + `platform-balance.ts`；看板需部署 Grafana | 🔧 人工 |
| 16 | **产物转存**：`result_asset_ids[]` 非空、assets 有记录、可下载 | `acceptance.int.test.ts` → §13 #16 | ✅ 自动 |
| 17 | **通知**：`unread-count` 增加，列表含结果链接 | `acceptance.int.test.ts` → §13 #17 | ✅ 自动 |
| 18 | **账号注销**：数据删除，登录 401 | `acceptance.int.test.ts` → §13 #18 | ✅ 自动 |
| 19 | **模型差异化定价**：同规格换模型价格必须不同（13/16/32） | `acceptance.int.test.ts` → §13 #19（**精确断言 13/16/32**） | ✅ 自动 |
| 20 | **提示词库闭环**：tabs/cards + 实时计数 + copy +1 + 深链 refImg 转 assetId | `acceptance.int.test.ts` → §13 #20 + `E2E-4` | ✅ 自动 |
| 21 | **URL 资产导入安全**：内网/超大/非法类型全拒，无残留无扣费 | `acceptance.int.test.ts` → §13 #21b + `src/modules/assets/ssrf.test.ts` | ✅ 自动 |
| 22 | **参考图交付链路**：传上游的是 4h 交付 URL；重试前重签 | `src/workers/*` 设计保证；URL 有效期单测 | ⚠️ 部分 |
| 23 | **Prompt 前置审核**：blocklist/llm 层分别 422，不建 task 无流水；超时 fail-open | `E2E-5` + `src/modules/moderation/index.test.ts` | ✅ 自动 |

---

## 验收标准中的数字核对

需求文档 §13 第 1 条写"获得 **20** 积分"，但 §6.4.1 与 §13 第 2 条均为 **100** 积分
（§6.4.1：`类型=grant_signup，delta=100，7 天有效`）。**以 100 为准**（两处对一处），
本实现的 seed 与测试断言均为 100。

## 前后端联调（LINK 套件，公网部署链路）

> 运行：`LINK_TOKEN=<link-setup.ts 产出> npm run test:link`
> （`vitest.link.config.ts`，文件串行）。上游保持 Mock。

| 套件 | 内容 | 状态（2026-09-15 实测） |
|---|---|---|
| LINK-1 前端可达 | `GET /`、`/zh-CN` 200；`/api/health` 经 nginx 200 且 `mockProvider=true` | ✅ 3/3 |
| LINK-2 前端字段契约 | capabilities / models（含展示名无内部代号）/ models/:id（params+pricing）/ plans（pro=1000）/ skus / prompt-library（cards 非空、单个 all）/ quote（gk-video-3/10s=13） | ✅ 7/7 |
| LINK-3 用户旅程 | me → balance(500) → checkin(5) → submit → **SSE 首帧经 nginx 实时到达** → 真 worker 出片 succeeded（~17s）→ 创作记录 → 通知数 ≥1 | ✅ 2/2 |

说明：
- 前端已从纯 mock 改为真实 API 调用（M5 完成：AuthProvider + useTaskRunner + catalog 驱动的模型/参数/价格联动 + 创作记录/资产/提示词库/通知红点/上传直传）。LINK-1 仍只验证"页面能打开"，浏览器内的点击出片尚未自动化（后续可上 Playwright）。
- 联调用户由 `deploy/link-setup.ts` 在容器内直建（线上验证码通道不适用万能码），跑完由 `deploy/link-cleanup.ts` 按 `link-` 前缀删除（外键 Cascade）。
- 联调中发现并修复的真实问题：测试 `truncateAll` 清掉线上 `prompt_posts`（已加入保留表）、seed 多存 `all` 页签致接口返回两个 all（已删 seed 项 + 线上行）。

---

## 认证体系改造（2026-09-16 上线并公网实测）

> 需求：无 SMTP 环境下用邮件验证码；注册改为"验证码 + 两次设密码"；支持密码登录与找回；支持 Google 授权登录。

### 能力矩阵

| 能力 | 实现 | 线上状态 |
|---|---|---|
| 邮件发码（Resend HTTP API） | `modules/auth/mailer.ts`；`MAIL_FROM=Vutu <noreply@ai.vutu.cc>`（自有域名 DKIM/SPF 已验证） | ✅ 实测投递成功（Resend message id 已记录） |
| 验证码 purpose 隔离 | `verification.ts` 记录带 `purpose`（register/recovery），串用返回 `wrong_purpose` 且**不消耗尝试次数** | ✅ 单测覆盖 |
| 注册三段式 | `register` → `verify`（不存在返回一次性 `verifiedToken`，已存在返回 `exists:true`）→ `set-password`（建号 + 100 积分） | ✅ 公网跑通 |
| 密码策略 ≥6 位含字母数字 | `passwords.ts#validatePasswordPolicy`；`WEAK_PASSWORD` 的 `details.reason` 精确到 `too_short`/`no_letter`/`no_digit` | ✅ 公网返回 `{reason:"no_digit"}` |
| 密码登录 | `login`（5 次失败锁 15min） | ✅ 公网 200；错误密码 401 |
| 找回密码 | `recovery/request`（防枚举）→ `recovery/confirm`（→verifiedToken）→ `recovery/reset`（**撤销该账号全部 refresh token**） | ✅ 三步端点已上线 |
| Google 登录 | `google.ts` **RS256 JWKS 真实验签**（kid 轮换强制刷新、iss/aud/exp、email_verified） | ✅ 用户在浏览器实测通过 |
| 前端四流弹窗 | `AuthDialog.tsx`：登录 / 注册设密 / 找回 / Google 按钮（按 `oauth-providers` 自动显隐） | ✅ 两种登录方式均用户实测通过 |

### 这轮修掉的真实缺陷

1. **Google 登录原本不验签**（只 base64 解 payload）——任何人可伪造 `{sub,email}` 登录任意邮箱账号。已换 JWKS 验签。
2. **验证码可跨流程串用**——注册码能拿去改密码。已加 `purpose` 隔离。
3. **MailError 不是 AppError → 冒泡成 500**——Resend 拒绝投递时前端只看到"服务器错误"。已加 `dispatchCode()` 翻译：上游 4xx → `503 EMAIL_NOT_CONFIGURED`，5xx/超时 → `503 SERVICE_UNAVAILABLE`；并有单测锁住"MailError 必须携带状态码"。

### 遗留（需运营/后续处理）

| 项 | 说明 |
|---|---|
| Resend Key 权限 | 当前 Key 是 **Sending access**，只能发信、不能通过 API 管理域名（建域名/查记录需在 Resend 控制台手动做） |
| 收信 MX | Resend 后台 MX 显示"待处理"——那是**收信**功能，我们只发信故不影响；建议关掉"启用接收"避免误报 |
| Apple 登录 | 仍为占位实现（`decodeIdTokenPayload` 不解签），未上架，前端不展示入口 |

---

## 无法在此环境自动化验证的项

| 项 | 原因 | 建议 |
|---|---|---|
| #8 新增模型 ≤2h | 人力工时指标 | 以 `models` 表驱动结构 + `CONTRACT.md` 模型接入指南作为证明 |
| #10 前端 mock 清零 | 属 M5 前端改造范围（本次交付后端） | 前端联调阶段用 PRD §10 清单逐项核对 |
| #15 Grafana 看板 | 需部署 Prometheus/Grafana 并积累真实流量 | M6 上线准备阶段 |
| #22 交付 URL 有效期实测 | 需真实上游拉取行为（本期为 Mock） | 切换真实上游后的首单复核 |
| 真实上游生成 | **本期明确不测真实生图生视频 API** | 上线前用最小成本模型跑一次真实首单 |
