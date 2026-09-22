# 灵客 AI（墨然AI / LK888）API 能力文档

- 抓取时间：2026-09-14
- 平台：`墨然AI`（Skill 中称"灵客 AI"），version `2026-09-08`
- 官网：https://lingkeai.ai
- 基础地址：`https://api.lk888.ai/api`
- 认证：`Authorization: Bearer {API Key}`
- **本次实测通过**：`/v1/skills`、`/v1/skills/guide`、`/v1/skills/models`、`/v1/skills/models/{name}`、`/v1/skills/models/{name}/pricing`、`/v1/skills/balance`、`/v1/skills/voices`、`/v1/skills/avatars`（不传 type）、`/v1/media/generate`、`/v1/skills/task-status`、`/v1/chat/completions`
- ~~异常：`GET /v1/skills/avatars?type=xxx`（三种 type 均 400）~~ → 误报：`type` 指形象类型（real/virtual，可选），不传即返回全部。已验证通过，名下有 1 个 ready 虚拟形象。

> 说明：本文件服务于 vutu 后端项目。未覆盖 `C:\Users\y2ksk\.cc-switch\skills\ecom-details-image\API_CAPABILITIES.md`，那是 ecom skill 自己的缓存（含 COS 上传链路），保持原样。

---

## 0. API Key 存放位置

| 来源 | 位置 |
| --- | --- |
| 用户提供（当前生效） | `sk-18d6...ae56` |
| 本地已存在 | `C:\Users\y2ksk\.cc-switch\skills\ecom-details-image\.env` → `API_KEY` |

> ⚠️ 该 Key 已在对话中明文出现，建议尽快在官网重新生成并替换。

---

## 1. 关键结论（对接前必读）

1. **LK888 是聚合网关，不是单一模型厂商**：一个模型背后有多个"渠道分组"（如 `TX-Y3`、`火山官方`、`KJ直连`），价格/成功率/耗时各不相同。
2. **渠道路由由 API Key 策略决定，请求参数无法覆盖**：请求体 `channel_group` 与请求头 `X-Channel-Group` **均被忽略**。若要在同一模型内做分组 fallback，必须**为每条链路各建一把 API Key**、各配不同策略，客户端按顺序切换重试。
3. **业务代码不得写死模型名**，必须按能力别名映射（模型名随上游上下线变化）。
4. **三种计费方式共存**：`按次` / `按token` / `按秒`，计价逻辑完全不同，见 §5。
5. **异步两段式**：`POST /v1/media/generate` 返回 `task_id`，轮询 `GET /v1/skills/task-status` 直到 `is_final=true`。
6. **视频不支持 base64，必须传公网 URL**；图片/音频支持 `data:<mime>;base64,`（单文件解码后 ≤10MB、单次合计 ≤30MB、请求体总 ≤50MB）。
7. **`result_url` 是稳定直链不会过期**；下载失败只重试下载，切勿重提任务（会重复扣费）。
8. **按秒计费模型提交瞬间按 10 秒整单预扣**（无 duration 参数时），成功后多退少补。

---

## 2. 接口全清单

### 模型查询
| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/v1/skills/models` | 模型列表，`?type=chat\|image\|video\|audio`（**不存在 tts/music 取值**，TTS/语音克隆/音乐统一归入 audio） |
| GET | `/v1/skills/models/{model_name}` | 模型详情，含 `params` 参数定义 |
| GET | `/v1/skills/models/{model_name}/pricing` | 全渠道分组价格；`?status=active` 仅取启用分组；含斜杠模型名用 `/v1/skills/models/-/pricing?model=xxx` |

### 调用说明
| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/v1/skills/guide` | 调用模式、渠道策略、计费说明、错误码、不支持端点 |

### 任务管理
| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/v1/skills/task-status?task_id=` | **主推**任务状态查询 |
| GET | `/v1/media/status?task_id=` | 早期版本，建议用上面的替代 |

### 账户
| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/v1/skills/balance` | 余额与额度 |
| GET | `/v1/skills/usage` | 用量明细（`scope/days/start_time/end_time/model/detail/limit/offset`） |

### 反馈
| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/v1/skills/feedback` | `{type, question, endpoint, context, ai_tool}`，type=`文档疑问`\|`接口报错`\|`功能建议` |
| GET | `/v1/skills/feedback?id=` | 查询处理结果 |

### 语言模型调用（LLM，本项目备用能力也走这里）
| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/v1/chat/completions` | OpenAI 格式（TT/GK/DS/Qwen/GLM/Kimi/MiniMax 等） |
| POST | `/v1/responses` | OpenAI Responses（无状态透传，`previous_response_id` 不保证有效） |
| POST | `/v1/messages` | Anthropic 格式（OP/SN/HK/FB 系列） |
| POST | `/v1beta/models/{model}:{action}` | Gemini 格式（GEM 系列） |
| GET | `/v1/models` | OpenAI 兼容模型列表 |

### 媒体生成
| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/v1/media/models?type=` | 媒体模型及参数定义（建议用 `/v1/skills/models` 替代） |
| POST | `/v1/media/generate` | **提交生成任务**（image/video/audio/TTS/音乐） |
| GET | `/v1/skills/voices?model=` | 音色列表（**实测 total=368**） |
| POST | `/v1/skills/voices/clone` | 音色克隆 |

### 人像形象（数字人）
| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/v1/skills/avatars` | `{type: real\|virtual, image_url, name}`，真人需扫码活体认证（120 秒有效，不可绕过） |
| GET | `/v1/skills/avatars/{avatar_id}` | 轮询至 `status=ready` |
| POST | `/v1/skills/avatars/{avatar_id}/verification` | 活体认证 |
| DELETE | `/v1/skills/avatars/{avatar_id}` | 删除 |
| GET | `/v1/skills/avatars` | 形象列表（`type` 为形象类型 real/virtual，**可选**，不传返回全部；勿传 video/image/audio） |

### 增值聊天
`POST /v1/agent/chat`、`GET /v1/agent/conversations`、`GET /v1/agent/conversations/history`、`POST /v1/agent/conversations/delete`、`POST /v1/agent/memories/clear`

---

## 3. 调用模式

### 3.1 异步媒体模式（image / video / audio）
```
POST /v1/media/generate      → { code:200, data:{ task_id, task_ids[] } }
GET  /v1/skills/task-status?task_id={id}   → 轮询直到 is_final=true
```

**提交请求体**
```jsonc
{
  "model": "viduq3",
  "prompt": "a golden retriever running on the beach at sunset",
  "params": {
    "model_variant": "turbo",
    "resolution": "540p",
    "duration": "4",
    "aspect_ratio": "16:9",
    "off_peak": "true"
  },
  "notify_url": "https://your-domain.com/webhook"   // 可选回调
}
```
- `type=select` 参数必须从 `options` 中取值
- `type=upload` 参数传公网 URL；图片/音频也可 `data:<mime>;base64,...`
- `required=false` 且不需要的参数直接省略（平台不再填默认值）
- 新接入**一律读 `data.task_id`**；`任务ids`/`对话组ID`/`成功数量` 为兼容老 SDK，计划下线

**任务状态响应字段（实测）**
```jsonc
{
  "task_id": 135983791,
  "model": "viduq3",
  "status": "已完成",            // 已提交/处理中/已完成/生成失败
  "status_group": "已完成",      // 等待中/进行中/已完成/失败
  "state": "success",            // success / failed
  "progress": "100",
  "is_final": true,              // true 必须停止轮询
  "result_url": "https://tos.lingkeai.vip/uploads/....mp4",
  "result_urls": ["..."],
  "result_type": "video",
  "cost": 0.2753,                // 实际扣费算力
  "channel_group": "TX-Y3",      // 实际命中分组
  "created_at": "2026-09-14T00:24:43+08:00",
  "completed_at": "2026-09-14T00:25:44+08:00",
  "duration_seconds": 61,
  "refunded": false,
  "refunded_amount": 0,
  "error": null
}
```

### 3.2 LLM 调用（实测通过）
```jsonc
POST /v1/chat/completions
{ "model": "tt-5.4-mini", "messages": [{"role":"user","content":"..."}], "max_tokens": 120 }
```
- Gemini 协议 base_url 填到 `/v1beta`
- 结构化输出为**原样透传上游**，平台不校验 schema，客户端需容错重试

---

## 4. 渠道策略（Channel Strategy）

在 **API Key 管理页面**设置，调用时自动路由：

| 策略 | 说明 |
| --- | --- |
| 综合最优 | 价格+成功率+速度+拥堵四维智能分流（推荐） |
| 价格优先 | 最低价可用渠道（**当前 Key 的策略**） |
| 速度优先 | 最快响应 |
| 成功率优先 | 最高成功率 |
| 自定义 | 仅在预勾选分组内按设定顺序 fallback；未配置则直接 403 |

⚠️ **不支持按单次请求切换分组** → 分组级 fallback 需多把 Key。

`is_active` 随上游可用性实时变化；扣费匹配**任务创建瞬间**命中的分组，事后查询可能看到该分组已 `is_active=false`，属正常。

---

## 5. 计费说明

### 5.1 三种计费方式
| 方式 | 公式 |
| --- | --- |
| 按次 | `最终价格 = 基础价格 × 所有选项系数乘积 + 所有选项加成总和` |
| 按token | `(输入token × 输入价 + 输出token × 输出价) ÷ 1000000` |
| 按秒 | `时长秒数 × 每秒价格` |

### 5.2 计价要点
- **按 token 时 `base_price` 恒为 0 不代表免费**，按 `output_token_price` 计算。视频类 token 由时长/分辨率折算：480p≈9600、720p≈21600、1080p≈48600、4K≈194400 每秒（含参考视频约 ×2.3）。5 秒 720p 约 2.6~7.6 算力。
- **不要拿 `base_price` 当成交价**，以 `min_price` 或 `option_prices.final_price` 为准。
- **按秒模型提交瞬间按 10 秒整单预扣**（无 duration 时，数字人/对口型一律按 10 秒），成功后多退少补；fallback 到更贵分组会补差额，余额不足则整单退款。建议余额 ≥ 10 × 所有候选分组中最高 `final_price`。
- 部分模型有「输入参考图按张计费」维度，不在 `option_prices` 内，见模型详情 upload 参数描述。
- 部分按秒分组有**按时段折扣**（`time_discounts`），价格随查询时段变化。

### 5.3 实测价格样例（2026-09-14）
| 模型 | 分组 | 计费 | 价格 | 备注 |
| --- | --- | --- | --- | --- |
| `viduq3` | TX-Y3 | 按次 | 0.2753（实扣） | 540p/4s/turbo/错峰，**POC 实测** |
| `kling-v3-video` | TX-Y3 | 按次 | 3.1036 | 10秒 ×2、15秒 ×3、pro ×1.3333，147s |
| `kling-v3-video` | TX-Y5 | 按次 | 3.726 | 无近期样本 |
| `doubao-seedance-2-5-260628` | 火山官方 | 按token | output 96.6 | 720p 系数 ×1 |
| `doubao-seedance-2-5-260628` | XH | 按token | output 87.81 | |
| `doubao-seedream-5-0-260128` | 官方直连/KJ直连 | 按次 | 0.3036 | 成功率 100%，38.94s |
| `doubao-tts-2.0` | 火山引擎官方直连 | 按token | input 414 | |
| `music-2.5` | MiniMax 官方直连 | 按次 | 1.38 | 137.25s |

---

## 6. 可用模型清单（2026-09-14 实测）

### Video（74 个）
`gk-video-3.5` `minimax-h3` `seedance-2.0-guanfang` `seedance-2.5-guanfang` `omni_flash-10s` `seedance-2.0-guanfang-anmiao` `doubao-seedance-1-5-pro-251215` `seedance-2.5-guanfang-anmiao` `omni-1.1` `kling-v3-omni-cankao` `omni-flash` `minimax-h3-max` `gk-video-3` `wan3.0` `video-enhance` `happyhorse-r2v` `viduq3-turbo-cankaosheng` `viduq3` `omni_flash-10s-fl` `kling-avatar-image2video` `kling-v3-omni-videoref` `kling-v3-video` `happyhorse-t2v` `viduq3-turbo` `happyhorse-1.1-t2v` `wan2.6-cankaosheng` `happyhorse-1.1-i2v` `kling-motion-control-v3` `kling-v3-omni-shouweizhen` `happyhorse-video-edit` `vidu-mv` `wan2.7-cankaosheng` `happyhorse-1.1-r2v` `pixverse-v6-shouweizhen` `wan2.2-animate-mix` `pixverse-c1-cankaosheng` `kling-motion-control` `wan2.6-shouzheng` `pixverse-c1-shouweizhen` `viduq3-drama` `vo3.1` `viduq2-cankaosheng` `pixverse-v5.6-r2v` `wan2.7-shouweizhen` `viduq3-cankaosheng` `pixverse-v5.6-shouweizhen` `happyhorse-i2v` `vidu-jieshuoman` `wan2.7-xuxie` `kwvideo-v2-ref` `hailuo-h3-cankaosheng` `doubao-seedance-2-5-cankaosheng` `hailuo-h3-shouweizhen` `hailuo-h3-quannengcankao` `wan3.0-video-quannengcankao` `seedance-2.5-anmiao-quannengcankao` `kwvideo-v2-quannengcankao` `hailuo-h3` `seedance-2.5-anmiao` `kwvideo-v2` `seedance-2.0-anmiao-cankaosheng` `wan3.0-video` `seedance-2.0-anmiao-quannengcankao` `wan3.0-video-cankaosheng` `seedance-2.0-anmiao` `doubao-seedance-2-5-260628` `doubao-seedance-2-5-quannengcankao` `hailuo-h3-max-shouweizhen` `seedance-2.5-anmiao-shouweizhen` `hailuo-h3-max` `doubao-seedance-2-5-shouweizhen` `wan3.0-video-shouweizhen` `seedance-2.5-anmiao-wensheng` `hailuo-h3-zaishengcheng`

**能力分组速查**
- 文生视频：`viduq3` `kling-v3-video` `doubao-seedance-2-5-260628` `hailuo-h3` `wan3.0-video` `minimax-h3` `happyhorse-t2v`
- 图生视频/首尾帧：`viduq3`(images) `kling-v3-video`(images) `wan2.7-shouweizhen` `hailuo-h3-shouweizhen` `seedance-2.5-anmiao-shouweizhen`
- 参考生视频：`wan2.7-cankaosheng` `viduq3-cankaosheng` `hailuo-h3-cankaosheng` `happyhorse-1.1-r2v` `pixverse-v5.6-r2v`
- 全能参考（图+视+音）：`hailuo-h3-quannengcankao` `wan3.0-video-quannengcankao` `kwvideo-v2-quannengcankao`
- 数字人：`kling-avatar-image2video`
- 视频编辑/续写：`happyhorse-video-edit` `wan2.7-xuxie` `kling-v3-omni-videoref`
- 音乐 MV：`vidu-mv`
- 动作控制：`kling-motion-control-v3` `kling-motion-control`
- 视频换人：`wan2.2-animate-mix`
- 超分增强：`video-enhance`
- 解说漫剧：`vidu-jieshuoman`

### Image（19 个）
`tt-image-2` `tt-image-2-token` `tt-image-2.5` `tt-image-2.5-token` `banana-pro` `banana-2` `doubao-seedream-5-0-pro-260628` `gk-image-2.0` `banana-pro-token` `banana-2-token` `vidu-image-2` `mj_imagine` `doubao-seedream-5-0-260128` `wan2.7-image` `doubao-seedream-4-5-251128` `kling-v3-omni` `qwen-image` `kling-v3` `wan2.6-image`

### Audio（7 个）
`speech-2.8`（语音克隆）`suno-v4.5`（音乐）`gem-3.1-tts`（TTS）`music-2.5+`（音乐）`doubao-tts-2.0`（TTS）`music-2.5`（音乐）`gem-2.5-tts`（TTS）

### Chat / LLM（68 个）
**OpenAI 格式**：`tt-5.6-luna` `tt-5.6-sol` `tt-5.6-terra` `tt-5.5` `tt-6-astra` `tt-5.4` `tt-5.4-mini` `tt-5.4-nano` `tt-5.2`(Codex) `tt-4o` `deepseek-v4.1-flash` `deepseek-v4-pro` `deepseek-v4-pro-0813` `deepseek-v4-flash` `deepseek-v4-flash-0731` `deepseek-v4-flash-vision-exp` `deepseek-v3.2` `kimi-k3` `kimi-k2.6` `kimi/kimi-k2.7-code` `kimi/kimi-k2.7-code-highspeed` `qwen3.8-flash` `qwen3.8-max` `qwen3.8-max-0902` `qwen3.8-flash-next` `qwen3.7-max` `qwen3.7-plus` `qwen3.6-plus` `qwen3.6-flash` `qwen3.5-plus` `qwen3.5-flash` `glm-5.3` `glm-5.3-flash` `glm-5.2` `gk-4.6` `gk-4.5` `gk-4.3` `gk-4-20` `gk-build-0.1` `doubao-seed-2-1-pro-260628` `doubao-seed-2-1-turbo-260628` `doubao-seed-2-0-pro-260215` `doubao-seed-1-8-251228` `doubao-seed-evolving` `doubao-seed-character-260628`(虚拟陪伴) `MiniMax-M3` `MiniMax-M2.7` `mimo-v2.5-pro` `stepfun/step-3.7-flash`

**Anthropic 格式**：`fb-5` `fb-5-1` `op-5` `op-4-8` `op-4-7` `op-4-6` `op-4-5` `sn-5` `sn-4-6` `hk-4.5`

**Gemini 格式**：`gem-3.8-flash` `gem-3.7-flash` `gem-3.6-flash` `gem-3.5-flash` `gem-3.5-flash-lite` `gem-3.1-pro` `gem-3.1-flash` `gem-3-pro` `gem-3-flash`

---

## 7. 模型参数定义（实测样例）

### `viduq3`（Vidu Q3，video）
| 参数 | 类型 | 必填 | 标签 | 选项 |
| --- | --- | --- | --- | --- |
| `images` | upload | 否 | 首尾帧 | — |
| `model_variant` | radio | **是** | 画质 | `turbo` \| `pro` |
| `resolution` | radio | **是** | 分辨率 | `540p` \| `720p` \| `1080p` |
| `duration` | select | **是** | 时长 | `4` \| `8` \| `12` \| `16` |
| `aspect_ratio` | radio | **是** | 宽高比 | `16:9` \| `9:16` \| `4:3` \| `3:4` \| `1:1` |
| `off_peak` | switch | **是** | 错峰模式 | `false` \| `true` |

### `kling-v3-video`（可灵 V3，video）
| 参数 | 类型 | 必填 | 标签 | 选项 |
| --- | --- | --- | --- | --- |
| `duration` | select | **是** | 视频时长 | `5` \| `10` \| `15` |
| `images` | upload | 否 | 首尾帧 | — |
| `prompt` | textarea | 否 | 提示词 | — |
| `mode` | select | **是** | 生成模式 | `std` \| `pro` |
| `aspect_ratio` | select | 否 | 画面比例 | `16:9` \| `9:16` \| `1:1` |

### `doubao-seedance-2-5-260628`（SD 2.5 文生，video）
| 参数 | 类型 | 必填 | 标签 | 选项 |
| --- | --- | --- | --- | --- |
| `duration` | select | **是** | 视频时长 | `auto` \| `4`~`30` |
| `aspect_ratio` | select | 否 | 宽高比 | `adaptive`\|`16:9`\|`4:3`\|`1:1`\|`3:4`\|`9:16`\|`21:9` |
| `resolution` | select | **是** | 分辨率 | `480p` \| `720p` \| `1080p` |
| `web_search` | select | 否 | 联网搜索 | `false` \| `true` |

### `seedance-2.0-guanfang`（SD 2.0 满血版，video，对外 **Seedance 2.0**）
| 参数 | 类型 | 必填 | 标签 | 选项 |
| --- | --- | --- | --- | --- |
| `mode` | segment | 否 | 生成模式 | `shouweizhen` \| `cankaosheng` |
| `_quan_neng_mode` | select | 否 | 参考方式 | `quan_neng` \| `edit` \| `extend` |
| `version` | select | **是** | 速度版本 | `Mini` \| `快速` \| `标准` |
| `duration` | select | **是** | 视频时长 | `auto` \| `4`~`15` |
| `aspect_ratio` | select | 否 | 宽高比 | `adaptive`\|`16:9`\|`4:3`\|`1:1`\|`3:4`\|`9:16`\|`21:9` |
| `resolution` | select | **是** | 视频分辨率 | `480p` \| `720p` \| `1080p` \| `4K` |
| `images`/`image_url`/`video_url`/`audio_url` | upload | 否 | 首尾帧/参考图/参考视频/参考音频 | — |

- 计费：按 token（官方特惠 output 30.36/1M，成功率 100%，~318s）。10s 估算：480p≈55 / 720p≈124 / 1080p≈310 积分（标准版）

### `seedance-2.5-guanfang`（SD 2.5 满血版，video，对外 **Seedance 2.5**）
| 参数 | 类型 | 必填 | 标签 | 选项 |
| --- | --- | --- | --- | --- |
| `mode` | segment | 否 | 生成模式 | `shouweizhen` \| `cankaosheng` |
| `_quan_neng_mode` | select | 否 | 参考方式 | `quan_neng` \| `edit` \| `extend` |
| `duration` | select | **是** | 视频时长 | `auto` \| `4`~`30` |
| `aspect_ratio` | select | 否 | 宽高比 | `adaptive`\|`16:9`\|`4:3`\|`1:1`\|`3:4`\|`9:16`\|`21:9` |
| `resolution` | select | **是** | 视频分辨率 | `480p` \| `720p` \| `1080p` |
| `images`/`image_url`/`video_url`/`audio_url` | upload | 否 | 首尾帧/参考图/参考视频/参考音频 | — |
| `web_search` | select | 否 | 联网搜索 | `false` \| `true` |

- 计费：按 token（官方特惠 output 46.368/1M，成功率 100%，~402s）。10s 估算：480p≈84 / 720p≈189 / 1080p≈425 积分

---

## 8. 错误码

`/v1/skills/*` 统一结构：`{ "error": { "type": "...", "message": "..." } }`
`/v1/media/generate` 例外：`{ code, msg, data }`，**判断 `code=200` 为成功**。

| type | HTTP | 含义 | AI 处理 |
| --- | --- | --- | --- |
| `invalid_request_error` | 400 | 参数错误 | 修正后重试 |
| `authentication_error` | 401/403 | Key 无效；或从未充值（`code=recharge_required`） | 检查 Key / 先充值 |
| `insufficient_balance` | 402 | 余额或额度不足 | 充值或取消 |
| `not_found` | 404 | 模型/任务不存在 | 检查拼写 |
| `rate_limit_exceeded` | 429 | 频率限制 | 退避重试 |
| `upstream_error` | 5xx | 上游临时故障 | 5-30 秒后重试（余额已退） |
| `server_error` | 500 | 平台内部错误 | 稍后重试；反复出现请反馈 |

**任务失败重试判断**：`refunded=true` 的失败（上游超时/内部错误）余额已退回，可用原参数安全重提（间隔 5-30 秒）；内容政策类被拒应调整提示词；参数不合法类重试无效。

---

## 9. 平台不提供的能力

| 缺失端点 | 替代方案 |
| --- | --- |
| `/v1/images/variations` | `POST /v1/media/generate` + 提示词描述变化方向 |
| `/v1/videos` | `POST /v1/media/generate`（model 传视频模型名） |
| `/v1/audio/speech` | `POST /v1/media/generate`（model 传 TTS 模型名） |
| `/v1/audio/transcriptions`（ASR） | **暂不提供** |
| `/v1/audio/translations`（语音翻译） | **暂不提供** |
| `/v1/embeddings` | **暂不提供** |

> ⚠️ 无 ASR、无语音翻译、无 embedding —— 影响"视频翻译"能力实现路径（需绕道：LLM 转写 + TTS）。

**参考图说明**：无"主底稿/参考图"分离字段，所有参考图统一放 upload 类参数数组。避免主体漂移：第 1 张放主体 + prompt 显式指代 + 减少参考图数量。

---

## 10. 本次实测记录

### POC 1：视频生成（成功）
```
POST /v1/media/generate
{ "model":"viduq3", "prompt":"a golden retriever running on the beach at sunset, cinematic",
  "params":{"model_variant":"turbo","resolution":"540p","duration":"4","aspect_ratio":"16:9","off_peak":"true"} }
→ { "code":200, "data":{ "task_id":135983791 } }

轮询终态：status=已完成, state=success, progress=100
  cost=0.2753 算力, channel_group=TX-Y3, duration_seconds=61
  result_url=https://tos.lingkeai.vip/uploads/2026.09/14/20260914002544_18d4ee1943e16b8442d5.mp4
```

### POC 2：LLM 调用（成功）
```
POST /v1/chat/completions  model=tt-5.4-mini
→ 正常返回，usage.total_tokens=42
```

### 余额变化
- POC 前 `60.59` → POC 后 `60.31`（消耗 0.28，与 `cost=0.2753` 吻合）

### 发现的异常（已解决）
- ~~`GET /v1/skills/avatars?type=video|image|audio` 均返回 **400**~~ → **我方误用**：`type` 是形象类型（real/virtual），不是媒体类型。`GET /v1/skills/avatars`（不传参）已验证通过，返回 1 个 ready 虚拟形象（阳阳老师）。

---

## 11. 已提交反馈

| feedback_id | 类型 | 内容 | 状态 |
| --- | --- | --- | --- |
| **2056** | 接口报错 | `GET /v1/skills/avatars` 参数误用 | ✅ 已处理（平台确认实现无 bug，0 行改动） |
