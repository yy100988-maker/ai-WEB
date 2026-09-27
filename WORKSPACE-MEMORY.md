# WORKSPACE-MEMORY.md — D:\CODEX\WEB

> 2026-09-23 取代已卸载的 `@npv12/opencode-memory-md` 插件记忆（`project/y2ksk.md` / `daily/*` / `USER.md` 只存在于该插件服务端存储，本地无残留）。此文件为工作区记忆唯一来源，变更时增量更新。

## 1. 项目概览

Vutu AI 生图/视频工作台，目标闭环：注册 → 签到/赠送 → 提交 → 扣费 → poll/SSE → 资产入库。

| 目录 | 说明 |
|---|---|
| `server/` | Fastify 5 + TS 独立后端（`vutu-server@0.1.1`，Node>=22） |
| `vutu-web/` | React 18 + Vite 6 SPA，无路由（`vutu-web@0.1.1`） |
| `ai-cloner/` | Next.js 16 克隆模板，被复用为前端 1:1 来源 |
| `docs/` | PRD / 详细设计 / LK888 能力 |
| `vutu-workbench/` | 仅 2 张设计参考图（未跟踪） |
| 根目录 `_* .py` / `eval-*` / `inspect-*` | 约 100 个一次性运维探针与 DOM QA 脚本，非正式代码（未跟踪） |

## 2. 后端（`server/`）

- 栈：Fastify 5（TS strict，`noUncheckedIndexedAccess`，ESM `.js` 后缀导入）+ Prisma 6 + PG16 + Redis 7 + BullMQ 5 + MinIO S3 + `node-cron` + `zod` + `pino`，JWT + `bcryptjs`。双进程：`dist/main.js`（API :8080）+ `dist/worker.js`。
- 模块：`auth`（register→verify→set-password 三步，登录锁定，Google JWKS RS256，Resend 邮件）/ `billing`（ledger + quote + `pg_advisory_xact_lock` 并发）/ `providers`（Lingke LK888 真实现 + Mock + registry）/ `router`（加权 pick + breaker）/ `tasks`（submit/cancel/retry/list/SSE）/ `assets`（upload-url/import-url，SSRF 防护）/ `catalog` / `checkin` / `notifications` / `prompts` / `moderation`（L1 词库 + L2 LLM，fail-open）/ `admin` / `time`。
- `src/core/` 为冻结契约层（见 `CONTRACT.md`）：`{ok:true,data,requestId}` 信封，cursor 分页，依赖 DAG `tasks→billing/router/providers`。
- **账本不变式**：余额 = `SUM(credit_ledger.delta)` 全量求和，绝不用 `expires_at` 过滤（过期由 `type=expire` 负向流水表达）。
- **三类 URL 分离**：上传 15min / 浏览 15min / 交付 4h；Worker 每次 submit（含重试）前重签交付 URL。
- **终态判定**：上游 `is_final===true` 且 `code===200`。
- DB：Prisma ~35 models（User/OAuth/Refresh，Plan/Subscription/Order，Channel/Key/Model/PriceItem/SyncLog/Snapshot/Routing/Promotion，Asset/Task+Event+Cost，CreditLedger/Checkin/Reset/Grant，Notification/Prompt*/AdminAudit，Remix* Phase2 stub）。
- Worker：BullMQ `generation → poll(15s) → transfer → notify` + `settle`（成功结算/失败全额返还）。
- Cron（Asia/Shanghai + Redis leader 锁，api+worker 双跑）：价格同步 02:00/14:00，额度重置 00:05，对账 03:00，超时扫描 */5m（running>30m→timeout+退款），平台余额每小时，产物清理 04:00（Free 30d / Pro 90d）。
- 计费：`credits = ceil(costUnits × 1.3 × 100 / 6.9) = ceil(cost×18.84)`，三口径 per_call/per_token/per_sec；signup 送 100（7d 过期）+ 每日 checkin 5。
- 供给：单通道 LK888 `https://api.lk888.ai/api`，多 Key fallback，`MOCK_PROVIDER=true` 时零上游费用。
- 测试金字塔：`src/**/*.test.ts` 单元 + `tests/contract`（nock）+ `tests/integration`（并发/幂等/退款/SSE）+ `tests/e2e` + `tests/link`，`vitest*.config.ts` 四分。
- 部署：`docker-compose.yml` 全 127.0.0.1（api:8080 + worker + pg + redis + minio），nginx 443 → `/api/`；`.env.example` 关键项 `MOCK_PROVIDER / USD_TO_CNY / MARKUP / CREDITS_PER_USD / LK_API_KEYS / JWT_SECRET / ADMIN_TOKEN`。

## 3. 前端（`vutu-web/`）

- React 18 + Vite 6 + TS 5.7，无 router/store/CSS 框架；`main.tsx` → `App` + `tokens.css` + `app.css`；vanilla CSS，tokens `--v-*`（canvas `#F6F7F9` + teal `#14B8A6`），三栏 grid `272px 1fr 304px`。
- 单视图四区：`TopBar`（56px，tab 仅本地 `activeTab` 过滤，素材库/画廊/设置均为 toast stub）+ `ModelRail`（272px 模型目录）+ `ResultFeed`（任务流）+ `Inspector`（304px 参数面板）+ 底部悬浮 `Composer`。
- `lib/api.ts`：envelope `{ok,data,requestId}`，`BASE=VITE_API_BASE`，`ApiError` 带后端 code；`lib/demo.ts` 后端不可达时降级演示数据（`offlineMode`）。
- 提交：乐观 `temp_*` 占位 + `idempotencyKey`；SSE `streamTask()` + 401/空结果时回落 `waitForTaskResults()` 轮询 15×2s。
- 配置：dev `127.0.0.1:5178`，`/v1 → 127.0.0.1:3000`；prod `VITE_BASE=/studio/`，`VITE_API_BASE=/api`。

### 已知缺陷（2026-09-22 发现，2026-09-23 已修 ✅ / 剩余 ⬜）

- ✅ 参考图链路/余额硬编码/me()路由/登录/模板/粘贴：2026-09-23 已修（见变更日志）。
- ⬜ 素材库 / 画廊 / 设置仍为 toast stub；ResultFeed 只取首图；目录加载 N+1。

## 4. 视觉能力参考（2026-09-22 分析）

`Anionex/agent-vision-toolkit`（1097 stars）：`glance` 问答/OCR、`ground` 像素框定位、`detect` 元素清单、`trace` 图转 SVG、`crop` 区域裁剪 + `vision-skills` playbook（长截图 OCR、UI 还原、图形矢量化、结构图转码、GUI 操作），核心思想 intent-aware（`focus-hint`）。

映射到 vutu 的路线：修上传链路 → 粘贴+模板+多结果 → 裁剪/框选重绘（`ground`/`crop`）→ OCR/问答/矢量化（`glance`/`trace`）→ UI 还原型。`vision-skills` 已为本地可用 skill。

## 5. 环境备忘

- OpenCode 全局插件：`opencode-chrome-devtools@1.0.4` + `opencode-metasearch2@0.1.2`；`@npv12/opencode-memory-md` 已卸载（记忆迁至本文件）；`opencode.jsonc` 中 `opencode-mem` 为未安装的死引用；`opencode-mem.jsonc` 为残留配置。
- 调试 Chrome 须独立 `--user-data-dir`；Node fetch 走 `127.0.0.1:9222` 需 `NO_PROXY` 含 localhost；`opencode.jsonc` 可被外部修改，编辑前重读。
- `~/.agents/skills/` 为跨工具共享目录，其 `delegate-*` 技能属 DSH Desktop，不适用于 OpenCode。
- git：`main`，单 commit `a06d1ff`（转存补发事件修生图不显示），大量脚本与 `vutu-workbench/` 未跟踪。

## 6. 变更日志

- 2026-09-24(9)：**删除"资产"页面/视图**（用户要求）。AppHomePage 11 处：去侧栏入口（三数组同步删资产位，图标按位对齐）、删 `view==="assets"` 分支（否则 TS2367 无交集比较报错）、View 联合体/VALID/`?tool=` 别名去 assets（深链落空到默认视图）、**未读数机制整套移除**（state + 60s 轮询 effect + 进资产标已读，notificationsApi 仅此一用）+ **删除 AssetsGrid.tsx 死文件**（本地/远端各删，远端零引用已验证）。site-data `a.assets` 字典键保留（必填接口键，纯数据）。lint 0 err（warning 9→8）+typecheck → 同步1文件 → BUILD_EXIT=0 → pm2 pid 3417773；线上 SSR `資產` 0 命中、`我的作品`正常。
- 2026-09-24(8)：**任务列表窗体固定 5 行高 + 内部滚动条**（用户确认需求）。`max-h-[72vh]` → `max-h-[min(72vh,600px)]`：卡片约 98px + 间距 12px，5 行≈538px，600px 上限在大屏正好卡出 5 行 + 滚动条；小屏仍回落 72vh。lint 0 err+typecheck → 同步1文件 → BUILD_EXIT=0 → pm2 pid 3403631。
- 2026-09-24(7)：**任务列表去掉"展开全部"按钮，换成内部上下滚动条**（用户要求）。TaskListPane 改回渲染全量 `renderItems`（批量组头保留），容器沿用 `max-h-[72vh] + overflow-y-auto`，约 5 行高、超出内部滚动；删除 `expanded` 态、截断预算、底部按钮及三语 `showAll/collapse` 文案。**踩坑**：JSX 注释 `{/* */}` 不能放在 `) : (` 括号内与 `<div>` 并列（括号内只允许单个表达式，会报 `')' expected`），已把注释挪进 grid div 内部首行；lint 0 err + typecheck 通过。部署：`_deploy.py frontend` 显示 uploaded=0（中断前的同步实际已完成）→ 远端 `BUILD_EXIT=0` → pm2 pid 3397350；线上 `/zh-TW/app` 200 且无展开按钮残留。服务端中断后未重复已完成的 lint/typecheck，直接从部署继续。
- 2026-09-24(6)：**生图任务列表默认只看 5 行**（用户要求）。TaskListPane：`CARD_BUDGET=5*2`（lg 双列=10 卡；窄屏单列=10 卡）+ `expanded` 态 + 列表底部"展开全部（还有 N 条）/收起"按钮（超预算才出现；统计口径不变仍按全量）。截断不断组：组头必带其后至少 1 行、末尾悬空组头丢弃；适用 video/image/audio 三个视图。lint 0 err+typecheck → 同步1文件 → BUILD_EXIT=0 → pm2 pid 3372362。
- 2026-09-24(5)：**删除"快速开始"模板栏**（用户要求）。删 AppHomePage 整栏 JSX（quickTitle 标题 + 网格 + onSelect 回填）+ import + **删除 AppQuickTemplates.tsx 死文件**（全仓零引用已验证）。site-data 11 语种 quick/quickTitle 字典键保留（必填接口键，纯数据零风险，不 churn）。lint 0 err+typecheck → `_deploy.py frontend` 1 文件 → 远端顺手 `rm` 死文件（同步脚本不处理删除；远端仅剩一个 `.bak` 备份，不参与编译）→ BUILD_EXIT=0 → pm2 pid 3314495。线上 SSR 验证：`快速開始` 0 命中、`靈感`保留。**教训**：删文件必须远端同步删（deploy 脚本只做上传/更新），否则本地远端树分叉。
- 2026-09-24(4)：**修复新任务"已完成但紫色占位、无预览无下载"**。取证：任务 `tsk_8St5aXRPwT46` succeeded、`result_asset_ids` 非空、资产行健康（1.8MB png 未删除）——生成与转存都没问题，纯前端展示 bug，双因叠加：①**detailCache 永不失效**：running 时首见行缓存 `results:[]`，15s 轮询永远命中，succeeded 后结果出不来（状态走列表实时更新所以"已完成"正常，唯独缓存字段 frozen）；②**resultAssetIds 存内部 UUID**，回落分支喂给只认 publicId 的 `GET /v1/assets/:id` 必 404（`{...}` 列是 UUID，`ast_...` 才是 publicId——此前 fallback 历史上从未成功，老任务缩略图全靠 detail results 的 publicId）。修复（TaskListPane 3 处，lint 0 err+typecheck → 同步1文件 → BUILD_EXIT=0 → pm2 pid 3265464）：终态+缓存空结果则重取 detail 刷新缓存（运行中行仍命中缓存，不增加轮询）；缩略图与 lightbox 去掉 UUID fallback，只认 results 的 publicId。新 bundle 加载后卡片自动恢复（转存已完成，首轮 hydrate 即有 results）。**教训**：缓存 hydrate 必须定义失效规则（状态翻转 ≠ 缓存翻转）；UUID/publicId 双 ID 体系下，跨层传 id 前先确认接收端认哪一种。
- 2026-09-24(3)：**"还是有同类问题"经远端日志取证 = 用户浏览器跑的是旧 bundle，非修复无效**。证据链：①`docker logs vutu-api` 有 `import-url blocked {url:/sites/.../row-05.jpg, reason:URL 格式非法}`（assets/service.ts:313 的 warn，**新代码里 `/` 开头路径永不到 import-url**——直传分支）；②该条日志时间 17:21:55Z，晚于新构建 BUILD_ID(16:43Z)+pm2 重启(16:44Z, pid 2604729) **37 分钟**；③服务器源码含修复（grep 命中）、190 文件 hash 全一致。结论：用户标签页在部署前打开，SPA 内导航不重载 document → 旧 chunk 一直在跑。解法=硬刷新（Ctrl+Shift+R / 关标签重开）后重试。**教训/模式**：报"修了还是一样"时先做服务端日志取证（本例 url+reason 直接定案），不要急着改代码；Next 静态页 + SPA 部署后旧 bundle 滞留是预期行为，后续可考虑加构建版本自检（待办，未做）。
- 2026-09-24(2)：**修复「商品图设计」快捷模板点 Create 报"无法拉取该 URL"**。根因链：模板卡点击即 `setPrompt + setRefImg`，而 refImg 是**站内相对路径** `/sites/vutu/showcase/show-1.png`（site-data 各语种快启卡 `img` 字段——卡片封面被当参考图是 F2 既有设计）→ Create 时非 `ast_` → 相对路径直接 POST 后端 `import-url` → 后端只 fetch 绝对外链 → 抛 `UNFETCHABLE_URL`（errors.ts:227 中文文案即报错红字）→ setRefErr + **中止创建**（任务列表空）。缩略图预览正常（浏览器渲染本地静态文件不经后端）。**修复**（AppHomePage 单点，lint+typecheck 绿，串行部署 _deploy frontend → BUILD_EXIT=0 → pm2 pid 2604729）：refImg 三态分流——`ast_` 直用；**`/` 开头站内相对路径 → 前端同源 fetch→blob→`assetsApi.uploadFile` 直传**（复用 ToolComposer 已验证链路，零出网零 SSRF 面，选它而非"拼 origin 绝对化再 importUrl"是为避免服务器出网绕回自己公网域名）；其余 http 外链维持 importUrl。顺带覆盖同族雷：R1 提示词库深链图片现为 `/api/v1/prompt-library/:id/image` 相对路径，老逻辑同样会 UNFETCHABLE_URL。**遗留边缘**：该深链图 302 到 minio 预签名，同源 fetch 跟随跨域重定向可能受 minio CORS 限制（失败会落 ui.refImportFail 不崩溃）——若用户报"从首页深链图导入失败"再查 minio CORS 配置。**教训**：给后端的 URL 参数永远不能是站内相对路径（后端没有浏览器的 origin 上下文）。
- 2026-09-24(1)：**修复线上"该记录没有存储提示词"（用户截图：20 行全中，params 芯片/缩略图却正常）**。三层根因：①直接原因=TaskListPane hydrate 合并 `{...item, ...extra}` 中 `extra.prompt = d.prompt` 为 undefined 时**会把列表行自带的真实 prompt 覆盖掉**（JS 展开空值也覆盖）；②深层=`taskService.get()`（GET /v1/tasks/:id 序列化器）**漏了 prompt 字段**（有 params/results 唯独无 prompt——params/缩略图因此正常）；③上一轮 TaskListPane 头注释"service.serializeDetail 含 prompt"是**错误假设**（该函数不存在，grep 零命中）。**R1 列表其实已带 prompt 但被①冲掉**。修复（双端 typecheck+781 tests+lint 绿，串行部署）：后端 `get()` += `prompt/batchId`（治本）+ POST /v1/tasks 响应 task += `prompt/batchId`（vutu-web studio submit 用真实任务替换乐观占位时同样丢 prompt，一并治）；前端 hydrate 改 `d.prompt ?? item.prompt`、`d.params ?? item.params`（防御，detail 缺字段绝不冲掉列表值）+ **`base` 标注 `PaneRow[]`**（TaskListItem 冻结类型无 prompt/params/batchId，运行时已有 → 不标注则 `item.prompt` TS2339）+ 头注释纠错。部署：`_deploy.py backend` 2 文件 → deploy.sh（DEPLOY_EXIT=0，6 migrations 幂等 No pending，seed ok，api healthy）→ `_deploy.py frontend` 1 文件 → BUILD_EXIT=0 → pm2 deevid pid 2570322；线上终验 ALL-PROBES-OK。**教训**：合并语义 `{...base, ...override}` 里 override 的**缺字段必须回落**再合并；给"冻结类型未声明"的运行时字段取值前先标注扩展接口；注释里的"存在某函数"断言要 grep 验证。
- 2026-09-23(7)：**前端两端全量落地 + 三段串行部署上线 + 线上终验全绿**（A+B+C 前端层完成）。
  ①**端点纠正（重要）**：LK888 实测 LLM 端点是 **`/v1/chat/completions`（OpenAI 格式，POC-2 model=tt-5.4-mini）**，moderation 注释里的 `/v1/skills/chat` 系误记（skills 实测清单不含它）——chat.ts 常量 + moderation 注释 + CONTRACT R1 + 方案文档(3处) + .env.example 五处同步改；`LK_CHAT_MODEL=deepseek-v4-flash-vision-exp`（列表唯一显式 vision，兼反推），`.env.example` 给了推荐值。buildChatBody/extractChatText 本就是 OpenAI 形状无需动。
  ②vutu-web（typecheck+build 绿，6 文件改+1 新）：api.ts +5 方法（optimizePrompt/reversePrompt/redeemKey/promptLibrary/publishPost）+createTask.batchId；Composer 工具行「AI 优化/反推」钮+chargeFailed(401→登录框，失败不清原文)+onCharged prop；ResultFeed 成功卡「反推/发布」钮；App +handleReverse/handlePublish/tabsCacheRef/runBatch（**波次并发=maxConcurrency，逐项独立成败，b_uuid batchId**）；TopBar「批量」钮；ModelRail 余额下方兑换码输入框；**新 BatchPanel.tsx**（模板×N×沿用当前参数，复用 auth-mask/auth-card 弹层零新 CSS）。
  ③ai-cloner（lint 0 err+typecheck+next build 89 页绿，6 文件改+1 新）：resources SubmitTaskBatchId+promptsApi 4 方法；**TaskListPane** batchId 组头卡（`div.contents` 不可行 → renderItems 拍平方案：组头作为 grid 直接子项 col-span-2 + 进度条）+第6/7图标（Wand2 反推→复用 onEdit 回填、Share2 发布→lazy library() 取首个非 all tab）+PaneRow.batchId 本地补齐；AppHomePage 底部操作行优化钮+侧栏兑换框+handlers；ToolComposer 字数行下优化钮；HeroComposer 按钮行优化钮；**新 feature-ui.ts**（3 语 pick 回落，沿用 WORKBENCH_UI/works? 模式，不动 11 语必填接口）。
  ④**部署（严格串行，全程无并行命令）**：`_deploy.py backend` 22 文件 → 远端 deploy.sh（.env 幂等补 LK_CHAT_MODEL → build→migrate→seed→up，**3 个 migration 落库 finished 无回滚**，api healthy uptime 起算）→ `vutu-web/deploy/deploy.py` release-20260923-231930 原子切换（回滚点=152008，nginx -t 过）→ `_deploy.py frontend` 6 文件 → 远端 `npm run build` **BUILD_EXIT=0** → `pm2 restart deevid`（pid 2528477 online）。
  ⑤**线上终验全绿**：health 200(mockProvider:false)、studio 200+新 bundle hash `index-CfZdHzQa`、公网 optimize/redeem/publish 401（nginx /api→新路由+守卫 ✓）、admin prompt-posts 401 admin守卫 ✓、prompt_library 200 **cards>0**（status='published' 过滤未误杀种子，迁移 DEFAULT 回填生效）、`/` `/text-to-video` `/en/app` SSR 均含 AI-enhance 按钮标记。
  ⑥**踩坑**：ResultFeed 是双组件（外层 Feed / 内层 Card），props 必须两层都穿（TS6133+TS2304 报错定位）；python 打印远端输出遇 GBK emoji 崩 → `sys.stdout.reconfigure(encoding='utf-8', errors='replace')`（deploy 脚本同款），崩在 print 不代表远端失败（read 已完成、退出码已回收——先核查再补跑）。
  **剩余**：integration 测试（**本地无 docker**：`docker` 命令不存在 → 方案A=装 Docker Desktop 起 test compose；方案B=服务器开一次性 vutu_test 库跑，**绝不拿生产库当测试库**）；LK chat 报文 undici MockAgent 固化（test:contract，待真实点击一次优化确认报文后再固化）；WorksGallery 反推/发布入口（作品资产无 prompt 字段，发布 title 语义要先设计）；admin 审核 UI（Phase D，现 curl+admin token 可用）；F6 邀请奖励等 Phase D。
- 2026-09-23(6)：**xiaoye 改造 R1 后端全量落地（A+B+C 后端层完成）**，typecheck/eslint 0 错、**781 tests 全过**、`tsc build` 出包。决议 D1 账本扣积分 / D2 范围 A+B+C / D3 广场默认自动过 已写入 `docs/xiaoye-adoption-design.md` v1.1 与 `server/CONTRACT.md` §修订记录 R1（全加法）。①契约：`LEDGER_TYPES` += `service_deduct`（**core/types 与 prisma `enum LedgerType` 两处必须同步**——只改一处会 typecheck 报"not assignable"）、`ledger.spend()`（P2002 重放 + advisory 锁 + `balance>=amount` 守卫，`balance(userId)` 复用既有导出做预检）②新共享件 `providers/chat.ts`：`chatOnce`（`/v1/skills/chat`、undici、5xx/超时重试1次、MOCK 返回 `[MOCK-CHAT]` 样例零上游、`LK_CHAT_MODEL` fail-fast）+ `chatEnv`（8 个新 env **模块内解析**，不动 core/config）+ `allowWindow` 单实例内存分钟/日窗（多副本需换 Redis 已注释）③新服务：`prompts/llm.ts`（F1 optimize/F2 reverse，charge-after：限频→预检402先于上游→chatOnce失败不扣→spend；图片≤10MB base64否则 presignDelivery 4h）、`billing/redeem.ts`（只存 sha256、条件更新防双花、Crockford 32 字母表 VUTU-4-4-4、明文仅生成返回一次）④11 条新路由全挂进既有 RouteModule（main.ts 零改动）：prompts optimize/reverse/publish/DELETE/image、billing redeem + admin redeem-keys×2、admin prompt-posts list/approve/reject（approve 仅 pending、reject 放行 published=事后下架、全写 AdminAuditLog 不含明文）⑤F5：Task+batchId 列/索引、create 可选 batchId（`^b_` 严格校验）、**serializeTaskListRow 补 prompt/params/batchId**（根治 TaskListPane 逐行 hydrate 40 请求）⑥F4：PromptPost+status/created_by/reject_reason、`listLibrary` 恒滤 `status='published'`、**cardImage 返回相对绝对路径 `/api/v1/prompt-library/<id>/image`**（站点 nginx 反代 /api → origin 自动对齐零配置；config 里**没有** PUBLIC_BASE，勿信 garbled 读文件输出）、image 路由现签 view URL 302、rejected/撤回即 404⑦3 个 migration（`20260923180000~02`）⑧测试+27（chat 13/redeem 9/llm 5）。**踩坑**：zod `.transform` 后不能接 `.regex`（放前面 + `i` flag）；`req.headers.accept-language` 必须方括号（否则被解析成减法）；`generateCode` 断言要排除 VUTU 字面前缀。**剩余**：前端两端（vutu-web Composer✨/参考图反推/ResultFeed 操作/BatchPanel+api client；ai-cloner ToolComposer/HeroComposer/AppHomePage 优化钮、TaskListPane batchId 分组+发布图标、WorksGallery、resources client）、后端部署（`_deploy.py backend` + docker rebuild + migrate deploy **单次串行**）、integration（兑换码双花/发布状态机/批量并发/LK chat 报文 MockAgent 固化）、integration（兑换码双花）。
- 2026-09-23(5)：产出 `docs/xiaoye-adoption-design.md`（xiaoye-ai 功能吸收改造设计方案 DRAFT v1）：F1 提示词优化 / F2 反推提示词 / F3 兑换码 / F4 灵感广场发布审核 / F5 批量生成 / F6 邀请奖励(Phase D)。核心取证结论：①`LEDGER_TYPES` 冻结但**含 promo** → 兑换码/邀请入账零契约变更；F1/F2 计费推荐免费+限流（扣分需修订冻结类型）②`PromptPost` 表已存在，F4 只加 status/createdBy 两列 ③moderation L2 标注的替换点 `LK888 /v1/skills/chat` = chat client 同一端点（F1/F2/L2 三处受益，MOCK_PROVIDER 返回样例零费用）④F5 **不建批量原子接口**——客户端扇出+batchId 保持"一任务一扣一退"不变式，顺带修 `serializeTaskListRow` 缺 prompt/params 的现网问题（TaskListPane 40 请求根治）⑤广场 img 禁存 15min 预签名（生图不显示同族问题）→ 稳定图片路由 `GET /v1/prompt-library/:id/image`。待拍板4项见方案 §15。
- 2026-09-23(4)：工作台右栏按 nova-image-studio 参考图重构为**任务列表**（`TaskListPane.tsx` 新建，替代 ResultPane 单大图预览并删除 374 行死代码）：头部「标题 + 共/完成/处理中/排队 + 筛选tab(同时/文生/图生) + 清空记录」、双列 72px 方缩略图卡（提示词标题 + 模型/比例/×N + 编辑/下载/复制/重试/移除5图标）、点图进 85vh lightbox、生成中细进度条、未登录显示 needLogin 空态。⚠️ 后端列表序列化（`serializeTaskListRow`）**不含 prompt/params**（仅 detail 下发）→ 前端按行 hydrate detail+viewUrl，两级 ref 缓存 + 15s 轮询只为新行付费；可选后端优化=列表补 prompt/params。typecheck/lint 0 错、build 过；已部署（同步 2 文件 → 远端 build EXIT=0 → pm2 restart pid 2426087）并线上复验：EN `Video tasks`+needLogin+Clear、ja 回落 `Generation tasks`、zh-TW `影片任務/清空記錄/同時顯示` 全命中，旧 ResultPane 简体串消失。⚠️ 教训（二次踩坑）：本轮再次把同一命令并行发 8 份（远端构建 7 次互撞 .next 锁）、同文件并行 edit 互相覆盖甚至反向回滚已改内容——**部署与同文件编辑必须逐条单发**，最后两步已改为单次调用才拿到稳定结果。
- 2026-09-23(2)：按 `docs/UI-DIFF-deevid-vs-vutu.md` 修完 ai-cloner 侧 P0 全部 + P1 十余项：新建 EN 根页（/pricing /text-to-video /image-to-video）+ 法务 6 页（terms/privacy/content-policy/contact/blog/affiliate，原创占位正文）+ robots.txt/sitemap.xml；`next.config redirects` 全量深链归一（/en/*、/{locale}/* 工具与法务深链、/app、/model、/blog/:slug、29 个 deevid 工具 slug → ?tool= 视图）；页脚 11 语种 47 处占位链接改真实目标 + App/社交条目去伪链；H1 缺空格动态补；模板 8→24 张、评价改 4 卡网格；定价页加年/月切换(29% off) + 9 问 FAQ + 评价区；t2v/i2v 加 ToolSidebar + 末尾 CtaBanner（i2v 另补 FAQ、移除错用的 t2v StepsHow）；/app/video 按 vutu-locale cookie 取语种(缺省 EN) + AppStudioMock 三语、9 语种 81 处 /app/video 深链改指本语言 app；`WORKBENCH_UI` 三语文案表替换 AppHomePage 30+ 处写死中文；zh-TW 拆出繁体 ZHTW 字典（guide/grow）+ 头部 mega 26 条转繁。`typecheck`+`lint` 0 错误、`build` 通过。剩余 P2 见报告 §9。
- 2026-09-23(3)：部署上线（13.250.182.43 / ai.vutu.cc）。ai-cloner：`_deploy.py frontend` 35 文件 → 远端 `npm run build` BUILD_EXIT=0 → `pm2 restart deevid`（pid 2071062 online）；vutu-web：`vutu-web/deploy/deploy.py` → release-20260923-152008 原子切换（previous=release-20260921-231724 可回滚）、nginx -t 通过。线上验证全绿：11 个 P0 新页=200，/en/pricing /app /video-to-video /en /ai-avatar /zh-TW/terms /blog/*=308，首页 H1 空格、页脚法务链接、模板 23 卡 SSR 命中，/studio/ + 新 bundle hash + api health（mockProvider:false）=200。⚠️ 教训：本轮多次把同一条部署/验证命令并行发了 8 份——SFTP 并发竞争曾致 size-mismatch；部署类脚本必须单次串行执行。
- 2026-09-23：前端 P0/P1 修完（会话 + 真实上传 + 真实余额 + 模板 + 粘贴），`typecheck` 与 `vite build` 通过；待联调（需后端 + 登录）。
- 2026-09-23：建文件，承接 memory-md 记忆；确认该插件及 `~/.opencode-mem` 均无本地残留；记录 vision-toolkit 分析与前端 P0 缺陷。
