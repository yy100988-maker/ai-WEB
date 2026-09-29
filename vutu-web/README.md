# Vutu 生图工作台（vutu-web）

按 `vutu-imagegen-workbench-v2.png` 效果图实现的生图工作台前端，对接本仓库 `server/`（vutu-server）。

## 快速开始

```bash
npm install
npm run dev      # http://127.0.0.1:5178
npm run build    # 产物输出到 dist/
npm run typecheck
```

开发服务器把 `/v1` 代理到 `http://127.0.0.1:3000`（vutu-server 默认端口）。
改目标地址：在 `.env.local` 写 `VUTU_API_TARGET=http://127.0.0.1:其他端口`。

> **后端未启动时会自动降级**：目录与任务流回退到 `src/lib/demo.ts` 的内置演示数据，
> 页面左上角出现「离线预览」标记，UI 依然可完整预览与交互。

## 版面（对齐 V2 效果图）

```
┌──────────────────── TopBar 56px ────────────────────┐
│ logo + 全部/聊天/图片/视频 + 余额 + 素材库/画廊/设置  │
├──────────┬──────────────────────────┬───────────────┤
│ ModelRail│       ResultFeed          │   Inspector   │
│  272px   │  （底部悬浮 Composer）     │    304px      │
└──────────┴──────────────────────────┴───────────────┘
```

| 区域 | 组件 | 内容 |
|---|---|---|
| 顶部 | `TopBar.tsx` | 品牌标识、4 个主导航 tab、余额、3 个圆形入口 |
| 左栏 | `ModelRail.tsx` | 搜索、模型卡片（图标色块 / NEW 角标 / 百分比 / 激活态）、余额 |
| 中栏 | `ResultFeed.tsx` | 结果卡片：左图右信息（提示词、状态、参数 chip、操作按钮、时间戳） |
| 底部 | `Composer.tsx` | 参考图缩略图组 + 虚线上传位、多行提示词、比例/质量胶囊、发送键 |
| 右栏 | `Inspector.tsx` | 画面比例（2×2 chip）、输出质量、生成张数、随机种子、预估消耗 |

## 设计令牌

全部集中在 `src/styles/tokens.css`，严格对齐 V2 效果图：

- 画布底 `#F6F7F9`、纯白卡片、12px 圆角、1px 细边 `#E9EBEF`
- 唯一强调色 teal `#14B8A6`（+ hover/active/tint 三档）
- 8px 间距栅格，无渐变、无毛玻璃，阴影仅用于浮层
- 响应式：≤1360px 收窄栏宽，≤1120px 隐藏右栏

## 后端契约对接

`src/lib/api.ts` 严格实现 `server/CONTRACT.md` §2 响应契约：

- 成功 `{ ok: true, data, requestId }` → 返回 `data`
- 失败 `{ ok:false, error:{ code, message } }` → 抛 `ApiError`（带 `code`）
- 网络异常 → `ApiError('NETWORK_ERROR')` 并置 `offlineMode`

已接入的端点：

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/v1/catalog/models` | 左栏模型列表 |
| GET | `/v1/catalog/models/:id` | 右栏参数与报价 |
| GET | `/v1/catalog/templates` | 提示词模板（当前用内置常量兜底） |
| POST | `/v1/tasks` | 提交生成（带 `Idempotency-Key`） |
| GET | `/v1/tasks` | 创作记录 |
| GET | `/v1/tasks/:id/stream` | **SSE 实时进度**（`EventSource`） |
| POST | `/v1/tasks/:id/cancel` | 取消任务 |
| POST | `/v1/tasks/:id/retry` | 重试任务 |
| GET | `/v1/assets` `DELETE /v1/assets/:id` | 素材库 |

### 交互行为

- **提交**：乐观插入占位卡片 → 调 `POST /v1/tasks` → 用真实任务替换；失败则移除并 toast 报错
- **进度**：对未终态任务自动建 SSE 订阅，收到终态事件即关闭连接；卸载时统一清理
- **重新编辑 / 再次生成**：把该任务的提示词、模型、参数回填到输入区与右栏
- **报价联动**：切换比例/质量/张数时按 `pricing` 行匹配并实时更新「预估消耗」
- **参考图**：支持点击、拖拽、多选，上限 10 张；有参考图时 capability 自动切 `image_to_image`
- **快捷键**：`Ctrl/⌘ + Enter` 提交

## 目录结构

```
src/
├── main.tsx              入口
├── App.tsx               状态中枢（目录 / 任务流 / 参数 / 提交）
├── components/
│   ├── TopBar.tsx        顶部全局栏
│   ├── ModelRail.tsx     左栏模型选择
│   ├── ResultFeed.tsx    中间结果流
│   ├── Inspector.tsx     右侧参数面板
│   ├── Composer.tsx      底部输入区
│   └── icons.tsx         线性图标集（无第三方依赖）
├── lib/
│   ├── api.ts            后端客户端 + 类型 + SSE
│   └── demo.ts           离线演示数据
└── styles/
    ├── tokens.css        设计令牌
    └── app.css           版面样式
```

## 生产部署

**线上地址：<https://ai.vutu.cc/studio/>**

拓扑（与现有站点同域共存，互不影响）：

```
浏览器 → nginx:443 (ai.vutu.cc)
           ├── /studio/*  → alias /opt/vutu-studio/current/   （本工作台，静态）
           ├── /api/*     → 127.0.0.1:8080  (vutu-api 容器)  → rewrite 剥掉 /api
           └── /*         → 127.0.0.1:3000  （另一个 Next.js 站，未改动）
```

### 部署命令

```bash
npm run build                     # 产出 dist/（读 .env.production）
python deploy/deploy.py           # 上传 + 配 nginx + 验证
python deploy/deploy.py upload    # 仅上传前端
python deploy/deploy.py nginx     # 仅改 nginx
python deploy/deploy.py verify    # 仅验证
python deploy/deploy.py rollback  # 回滚到上一版前端
```

部署脚本特性：

- **原子切换**：每次上传到 `release-<时间戳>`，再改 `current` 软链；上一版保留为 `previous`
- **只保留最近 3 个** release，自动清理旧的
- **改 nginx 前先备份**到 `/tmp/ai.vutu.cc.conf.bak-<时间戳>`
- **`nginx -t` 不通过就自动回滚**配置且不 reload
- 幂等：`location /studio/` 已存在时跳过插入

服务器：`13.229.183.21`（密钥 `D:\文档\亚马逊\126.pem`），目录 `/opt/vutu-studio`。

### 环境变量

| 文件 | 变量 | 值 | 说明 |
|---|---|---|---|
| `.env.production` | `VITE_BASE` | `/studio/` | 资源前缀，必须与 nginx location 一致 |
| `.env.production` | `VITE_API_BASE` | `/api` | 后端基地址，同域反代无跨域 |
| `.env.local`（开发可选） | `VUTU_API_TARGET` | `http://127.0.0.1:3000` | vite dev 代理目标 |

## 实际后端契约（已按线上校准）

对接过程中发现前端初版假设与线上不符，已修正：

| 项 | 线上真实形状 | 处理 |
|---|---|---|
| `GET /catalog/models` | **不返回** `capability`，只有 `resolutions/durations/aspectRatios/features` | 逐个调详情接口，按 `capabilityKind === 'image'` 过滤 |
| `durations` 能否区分图片/视频 | **不能**（`GK Video 3.5` 的 durations 为空） | 弃用该启发式，改用详情接口的 `capabilityKind` |
| `pricing[].spec` | **对象**如 `{resolution:"1K"}`，非字符串 | `matchPrice()` 按键值子集匹配，取最贵命中行 |
| `GET /catalog/models/:id` 的 `params` | **对象映射**（键=参数名），非数组 | `toParamOptions()` 归一化成数组 |
| 线上实际图片模型 | 仅 `GPT Image 2.5`、`GPT Image 2`（其余 9 个为视频） | 左栏只显示这 2 个 |

## 已知事项

- **未登录**：`/v1/tasks` 返回 401（符合预期）。`setAccessToken()` 已预留，
  接入 auth 流程后即可拿到创作记录。
- **需登录才能生成**：提交任务同样需要 access token。
- **服务端 Bug（非前端问题）**：`GET /v1/catalog/models/:id` 传非 UUID 字符串
  （如 `demo-tt-image-2`）时，Prisma 查询 UUID 列报 `P2023` → 返回 **500**；
  合法但不存在的 UUID 则正确返回 404。建议在该路由加 UUID 格式校验后走 404 分支。
- 主题仅浅色；深色主题需扩展 `tokens.css`。
