# M5 前端接入 —— 子代理契约（冻结）

> 需求：`docs/backend-prd.md` §10（PRD 在 `D:\CODEX\WEB\docs`，子代理自己读 §10）。
> 后端已上线：`https://ai.vutu.cc/api/v1`（nginx 转发，同域，无 CORS 问题）。

## 已写好的共享层（直接用，禁止另起炉灶）

| 文件 | 导出 | 说明 |
|---|---|---|
| `src/lib/api/types.ts` | 全部 DTO 类型 | 与后端响应 1:1 |
| `src/lib/api/client.ts` | `api<T>()`、`ApiError`、`tokenStore`、`streamTask()` | fetch 封装；401 自动 refresh 重试；无 body 不发 content-type |
| `src/lib/api/resources.ts` | `authApi`、`catalogApi`、`billingApi`、`tasksApi`、`assetsApi`、`checkinApi`、`notificationsApi`、`promptsApi` | 资源函数，组件只调这些 |
| `src/lib/api/auth-context.tsx` | `AuthProvider`、`useAuth()` | user/plan/credits/checkin/login/logout |
| `src/lib/api/use-task-runner.ts` | `useTaskRunner()` | 提交→SSE→终态，Hero/Tool/App 三处共用 |

`useAuth()` 返回：`{ loading, user, plan, credits, expiringSoon, checkedInToday, error, refresh, startRegister, verifyCode, login, logout, checkin }`。
`useTaskRunner()` 返回：`{ running, status, progress, taskId, results, quotedCredits, error, run, reset, stop }`，
`run({ capability, modelId?, prompt, negativePrompt?, inputAssetIds?, params?, idempotencyKey? })`。

## 铁律

1. **UI 1:1 不变**：只改数据来源与交互逻辑，不改布局/类名/文案（文案仍走 `site-data` 字典）。
2. **TS strict、无 `any`**，命名导出，2 空格缩进，无行内 style（沿用 Tailwind；已有 inline style 不动）。
3. **AuthProvider 接入**：在自己负责的顶层 vutu 组件内用 inner 包一层，
   ```tsx
   export function AppHomePage(props: Props) {
     return (<AuthProvider><AppHomePageInner {...props} /></AuthProvider>);
   }
   ```
   不要改 11 个 locale 的 page.tsx。
4. **未登录降级**：`user === null` 时组件保持原 mock 外观（按钮可点 → 弹登录）；绝不白屏、绝不死循环请求。
5. **错误处理**：按 `ApiError.code` 分支：`INSUFFICIENT_CREDITS` 提示充值/签到、`CONTENT_REJECTED` 显示 message、`MODEL_UNAVAILABLE` 用 details.alternatives、`RATE_LIMITED/TOO_MANY_TASKS` 提示稍后、`UNAUTHORIZED` 弹登录。不要 `alert()`，用行内小字/已有样式。
6. **SSE**：一律经 `useTaskRunner`（它内部先 SSE、断线回落轮询），不要自己写 EventSource。
7. **不要动**：`src/lib/api/*`（冻结）、`site-data.ts`（只读）、后端代码。
8. 完工标准：`npx tsc --noEmit` 0 error（在 `ai-cloner/` 下跑）。

## 各代理文件所有权（互不重叠）

- F1 认证：`SiteHeader.tsx`（login/startFree→登录弹窗；用户区头像/昵称；宝石数=credits）+ 新建 `src/components/sites/vutu/AuthDialog.tsx`（邮箱+验证码/密码登录共用弹窗，各处复用）。
- F2 生成：`HeroComposer.tsx`、`ToolComposer.tsx`、`AppHomePage.tsx` 的 video/image/audio composer 区（含模型 chip、参数 chip、价格显示、结果渲染）。ToolComposer 的硬编码 `qualities/ratios/durations` 改为 catalog 驱动；AppHomePage 的 `40` 积分改为 quote 实时价。
- F3 计费展示：`AppHomePage.tsx` 侧栏（planName/积分/签到/upgrade）、`ToolPages.tsx` 的 `PricingPage`（PriceTier 接 plans/skus/credit-packs）、通知红点（unread-count）。
- F4 内容：创作记录（Filter 接 tasks 列表）、资产视图（assets 列表/删除）、`HomeSections.tsx` 提示词库（tabs/cards/views/likes/copy 上报）、`app.quick[]` 模板（templates 接口 + 深链预填已有逻辑保留）、上传控件（upload-url 直传 + confirm + import-url 深链 refImg）、`ToolPages.tsx` 非定价部分不动。

capability 映射：video→`text_to_video`、image→`text_to_image`（有 refImg 时 `image_to_image`）、audio→`text_to_audio`。
params 映射：resolution 取所选 chip（如 "1080P"）、durationSec 取秒数（chip 标签需解析，如从 catalog durations 选）、aspectRatio 取比例。
