# 测试 HTTP Mock 规范（⚠️ 必读）

## 结论：本项目**统一用 undici `MockAgent`**，不要用 `nock`

### 为什么

本项目的上游调用全部走 **undici 的 `request()`**（见 `src/modules/providers/lingke.ts`、
`src/workers/transfer.ts`）。undici 用自研 llhttp 解析器 + 连接池，**不走 `node:http` 的
客户端路径**，而 `nock` 劫持的正是 `http.ClientRequest`。

因此：

- `nock(...).intercept(...)` 对 undici 请求**完全不生效**
- `nock.disableNetConnect()` 对 undici 请求**同样无效**

**实测证据**（2026-09，`D:\CODEX\WEB\server`）：

```ts
nock.disableNetConnect();
nock('https://api.lk888.ai').post('/api/v1/media/generate').reply(200, { code: 200, data: { task_id: 1 } });

const r = await request('https://api.lk888.ai/api/v1/media/generate', { method: 'POST', body: '{}' });
// → STATUS 401
// → {"error":{"code":"missing_api_key","message":"缺少 API key...","type":"authentication_error"}}
```

**请求真的打到了 `api.lk888.ai`。** 这是一次真实出网 —— 违反了「绝不发起对
`api.lk888.ai` 的真实网络请求」这条硬性要求。

### 正确做法

```ts
import { MockAgent, setGlobalDispatcher, getGlobalDispatcher, type Dispatcher } from 'undici';

let agent: MockAgent;
let original: Dispatcher;

beforeEach(() => {
  original = getGlobalDispatcher();      // 保存，避免污染同进程其他测试文件
  agent = new MockAgent();
  agent.disableNetConnect();             // 未注册的请求抛 MockNotMatchedError
  setGlobalDispatcher(agent);
});

afterEach(async () => {
  await agent.close();
  setGlobalDispatcher(original);         // 必须还原
});

// 注册路由
agent.get('https://api.lk888.ai')
  .intercept({ path: '/api/v1/media/generate', method: 'POST' })
  .reply(200, { code: 200, data: { task_id: 1 } });
```

要点：

1. **`agent.disableNetConnect()`** —— 未注册的请求抛 `MockNotMatchedError` 而不是出网。
2. **`afterEach` 必须还原 dispatcher** —— 否则会污染同进程的其他测试文件。
3. `reply((opts) => ...)` 的回调里 `opts.headers` 保留**原始大小写**
   （`Authorization` 而非 `authorization`），断言前请归一化。
4. 查询串要**写进 path**：`.intercept({ path: '/api/v1/skills/task-status?task_id=1' })`。

参考实现：`tests/contract/lingke.contract.test.ts`（含"未注册路径必须抛
`MockNotMatchedError`"的**网络隔离回归测试**）。

## 关于 `package.json` 里的 `nock`

`nock` 仍在 `devDependencies` 中，但**本项目不使用它**。保留与否由项目负责人统一决定。

**如果你要写拦截 undici 的测试，请不要引入 nock** —— 它会给你"已经隔离了网络"的
错觉，而实际请求正在出网。`src/workers/transfer.ts` 的下载测试尤其需要注意。

## 命令

| 命令 | 说明 |
|---|---|
| `npm run test:unit` | 单元测试（`src/**/*.test.ts`） |
| `npm run test:contract` | 契约测试（`tests/contract/*.contract.test.ts`，MockAgent 拦截） |
| `npm run test:int` | 集成测试（真 PG/Redis） |
| `npm run test:all` | 全部 |
