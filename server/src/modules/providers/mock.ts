/**
 * MockProvider —— **本期测试基线**（CONTRACT §5）。
 *
 * 为什么必须存在：
 * - CI / staging / 压测下 `MOCK_PROVIDER=true`，全部生成走本地 Mock，**零上游费用**，
 *   且绝不发起对 `api.lk888.ai` 的真实请求（PRD 附录 D / CONTRACT §5）。
 * - 提供可控延迟 + 失败注入，覆盖 E2E 的超时/上游错误/内容违规/余额不足四条失败路径。
 * - `remoteUrl` 指向本进程挂载的 `/mock-fixture/*`，让 transfer 队列走**真实下载 + 魔数校验**
 *   路径（CONTRACT §5：测试环境用本地生成的 fixture 文件）。
 *
 * 状态存储：进程内 Map（快路径）+ Redis（跨进程/重启可见，`mock:job:<id>`，TTL 1h）。
 * Worker 与 API 是两个进程，poll 可能落在不同进程上，所以 Redis 是必需的。
 */

import type { FastifyInstance } from 'fastify';
import type {
  Capability,
  ChannelCreds,
  GenerationProvider,
  GenerationRequest,
  MappedError,
  ModelDescriptor,
  PollOutput,
  PollResult,
  SubmitResult,
  ValidationResult,
} from '../../core/types.js';
import { CAPABILITIES } from '../../core/types.js';
import { getConfig } from '../../core/config.js';
import { redis } from '../../core/redis.js';
import { childLogger } from '../../core/logger.js';
import { validateRequest } from './validate.js';
import { loadModelsForChannel } from './registry.js';

const log = childLogger({ mod: 'mock-provider' });

// ---------------------------------------------------------------- 内嵌 fixture

/**
 * 极小但**合法**的媒体文件（魔数校验必过，见 `workers/transfer.ts#sniffMime`）。
 *
 * 为什么内嵌 base64 而不是读外部文件：
 * 1. 测试不依赖工作目录/容器卷挂载；
 * 2. transfer 队列会做魔数校验，随手的占位字节会被判为非法产物。
 *
 * - `video.mp4`：H.264 16×16 1 秒，**首 4 字节后紧跟 `ftyp` box**（1518 字节）
 * - `image.png`：1×1 PNG，含 `\x89PNG\r\n\x1a\n` 签名（69 字节）
 * - `audio.mp3`：MPEG-1 Layer III，含 `ID3` 头（4941 字节）
 */
const MICRO_MP4_BASE64 =
  'AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAM1bW9vdgAAAGxtdmhkAAAAAAAAAAAA' +
  'AAAAAAAD6AAAA+gAAQAAAQAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAA' +
  'AABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAl90cmFrAAAAXHRraGQAAAADAAAA' +
  'AAAAAAAAAAABAAAAAAAAA+gAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAA' +
  'AAAAAAAAAABAAAAAABAAAAAQAAAAAAAkZWR0cwAAABxlbHN0AAAAAAAAAAEAAAPoAAAAAAABAAAA' +
  'AAHXbWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAAAoAAAAKABVxAAAAAAALWhkbHIAAAAAAAAAAHZp' +
  'ZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAABgm1pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAA' +
  'ACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAAUJzdGJsAAAAtnN0c2QAAAAAAAAA' +
  'AQAAAKZhdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAABAAEABIAAAASAAAAAAAAAABFUxhdmM2' +
  'Mi4yOC4xMDEgbGlieDI2NAAAAAAAAAAAAAAAGP//AAAALGF2Y0MBQsAK/+EAFWdCwAraewEQAAAD' +
  'ABAAAAMAoPEiagEABGjOD8gAAAAQcGFzcAAAAAEAAAABAAAAFGJ0cnQAAAAAAAAUSAAAAAAAAAAY' +
  'c3R0cwAAAAAAAAABAAAABQAACAAAAAAUc3RzcwAAAAAAAAABAAAAAQAAABxzdHNjAAAAAAAAAAEA' +
  'AAABAAAABQAAAAEAAAAoc3RzegAAAAAAAAAAAAAABQAAAmUAAAAJAAAACQAAAAkAAAAJAAAAFHN0' +
  'Y28AAAAAAAAAAQAAA2UAAABidWR0YQAAAFptZXRhAAAAAAAAACFoZGxyAAAAAAAAAABtZGlyYXBw' +
  'bAAAAAAAAAAAAAAAAC1pbHN0AAAAJal0b28AAAAdZGF0YQAAAAEAAAAATGF2ZjYyLjEyLjEwMQAA' +
  'AAhmcmVlAAACkW1kYXQAAAJTBgX//0/cRem95tlIt5Ys2CDZI+7veDI2NCAtIGNvcmUgMTY1IHIz' +
  'MjIzIDA0ODBjYjAgLSBILjI2NC9NUEVHLTQgQVZDIGNvZGVjIC0gQ29weWxlZnQgMjAwMy0yMDI1' +
  'IC0gaHR0cDovL3d3dy52aWRlb2xhbi5vcmcveDI2NC5odG1sIC0gb3B0aW9uczogY2FiYWM9MCBy' +
  'ZWY9MSBkZWJsb2NrPTA6MDowIGFuYWx5c2U9MDowIG1lPWRpYSBzdWJtZT0wIHBzeT0xIHBzeV9y' +
  'ZD0xLjAwOjAuMDAgbWl4ZWRfcmVmPTAgbWVfcmFuZ2U9MTYgY2hyb21hX21lPTEgdHJlbGxpcz0w' +
  'IDh4OGRjdD0wIGNxbT0wIGRlYWR6b25lPTIxLDExIGZhc3RfcHNraXA9MSBjaHJvbWFfcXBfb2Zm' +
  'c2V0PTAgdGhyZWFkcz0xIGxvb2thaGVhZF90aHJlYWRzPTEgc2xpY2VkX3RocmVhZHM9MCBucj0w' +
  'IGRlY2ltYXRlPTEgaW50ZXJsYWNlZD0wIGJsdXJheV9jb21wYXQ9MCBjb25zdHJhaW5lZF9pbnRy' +
  'YT0wIGJmcmFtZXM9MCB3ZWlnaHRwPTAga2V5aW50PTI1MCBrZXlpbnRfbWluPTUgc2NlbmVjdXQ9' +
  'MCBpbnRyYV9yZWZyZXNoPTAgcmM9Y3JmIG1idHJlZT0wIGNyZj0yMy4wIHFjb21wPTAuNjAgcXBt' +
  'aW49MCBxcG1heD02OSBxcHN0ZXA9NCBpcF9yYXRpbz0xLjQwIGFxPTAAgAAAAApliIQ6JigACQLg' +
  'AAAABUGaID6UAAAABUGaQD6UAAAABUGaYBClAAAABUGagBCl';

const MICRO_MP3_BASE64 =
  'SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjYyLjEyLjEwMQAAAAAAAAAAAAAA/+NIwAAAAAAAAAAA' +
  'AEluZm8AAAAPAAAAEAAAEyAAHh4eHh4eLS0tLS0tPDw8PDw8S0tLS0tLWlpaWlpaWmlpaWlpaXh4' +
  'eHh4eIeHh4eHh5aWlpaWlpalpaWlpaW0tLS0tLTDw8PDw8PS0tLS0tLS4eHh4eHh8PDw8PDw////' +
  '////AAAAAExhdmM2Mi4yOAAAAAAAAAAAAAAAACQCgAAAAAAAABMgiAamdwAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/+NIxAA4ImpI' +
  'A1swAoGAgJgICYCAmAgJgICAgMs2XjRTQCFsAAAGAARgQEYAAFmC8CRCAcs+YGCmDhJhIOAgte9k' +
  'ueYYDCIBMlRTY305GfOnpzoZM31hM9F0FU109AAAGAABaBBxdEOW5W7bO2dtff+f0T0wAAAIQcmE' +
  'IZd6xhABk73vZMmACCERBhAgFkyd3ZMmTCCBAhBhAgQJkyZMmTJkyZAgQIECBAgQJkyZNOyZMmQI' +
  'EIiIMQJk07u7u0AQBAEAQB8HwfB8HAQBAEAQB8HwfB8HAQBAEAQB8HwfB8HAQBAEHPE//P//8EDm' +
  'lTAfQOgwPUEAMEzBjDAjgRF0XVaU6Wv15glAKCYMQEAmBkgwRg4IQw05aLdUwe//DC5w/+NIxDJH' +
  'gzIgAZ/gAPyMFsCeTU0CRox3cWOGQAIwNYCGNTlICjDEgNLzAmQVc0m5CLMLBBFTenPPoZs8BmTO' +
  'bgNztg2u7HCk7uvrRRr6X+98x8iTSCNNGJ0xKXDMpgMxm4woPzIxHlVHS1eVtf/9/9/5kYnmCxYY' +
  'zGRjMcGAg+YkEpiITgUJGGQwYXDG98y7r96//7r//9+FASYOB5g4HiEBGBwMYFAiIJgAAlmVVi5S' +
  'D3/z///5r//////+f/shRVWK8SpnGiLky24/1P2z/P/v477/////83/75+v/U1j8RpqaGpTGXZlU' +
  'adqUw65MSf7WKV1+OrcT/9c1l/Ln/3fdfz//u75gAIAMYBOA5GBQgRRgNIBQYCSBcGCzhQhh/+NI' +
  'xCcpI6IIAd8QAJWFiGGsjvRjE/FMZPwOIGKPhNhg5oO0YHyA0mAfgSJgXgDaYCkAumAWABDUsv/9' +
  '/r+6/+0lWT7vk2syGZLIr6KqudWrrtdVbwee7po/7nSVXpmvWiXRNCk3RH4VP/7bfv/3rZY5rJbw' +
  'ZlZXrYKObOhBF8II0wBesGBqTpQi9e91zl3Wdf+8/LHfP3u/ywYCA2YRiYYrESZMlEZ+oIauL6cl' +
  '1sYpsRInV0/RJsEQ16YjGEXGDoAa48C3EgDOYCaA2GAjAJZgFYB8rir94o1hquy9HGK4npy3F8XV' +
  'mGI544Tj9x5FZho6t1uJLGK1crsyxVGcZqjzuKDGHkdzs5VeNjkVjjHZCDbmMw/gMlkuW7q7DWcb' +
  '/+NIxJUwZGX8AO/Khfx79bpHuNnU5htls12EDD0WiziA8crvE2Ok6XW7o576utj0a4sJo4xx5soy' +
  'pUxBTUUzLjEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV7zfM8e372Pe/fv3f/m/y' +
  'pTAAKDBsXTCoggqK5kYAhqmcJ1ZIBjOY92esBxom8TjH5i0gSkYVCC5mDFAnBgZQHUYEiBUmAmAN' +
  'BgEoCqqW9lyJHEd3N1GPLnI7X6GTjvQb29D6gcRj7iUKoc0ibm6q8uaLkdzeJIyrzoSmr+/s8Ygo' +
  'JPJ8qb5t5xywPuKFoxw2b+gajK7qxndTdjZhbr+IPqequ5sT0NuIxMjZHVxdiEpzzUzlBhjxnczR' +
  'EVGq/+NIxL00PG34AO/QhCd1FxF3EjojM5eJRbHl483oRmocTEFNRTMuMTAwqqqqqqqqqqqqqqqq' +
  'qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq' +
  'qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq69Wltduq0+DgD' +
  'ASCKBhHAgBhgB+BhqFeBhNKIBg6UiYCWQsGE9eixgpo1EIgkcwDAEeMBbAmTAXwC8HAbBWAlkQCi' +
  'p/LXVst29bLXf82q6rRGOj9lssbem1iW8zOuXq31kspmprfc3SOyMMm1uBI1eur1dk/R16dX3KiF' +
  'TPamcrMr/+NIxIIlZGYIALfEhFZQTP5WWzbJd9Utt3smwK7K5sZaTEFNRTMuMTAwqqqqqqqqqqqq' +
  'qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqu4XfvVuXpvf5XLWeu8zwvfYMAg1' +
  'MIx4MWDFMszWNSUsN6GHPT6YMeWICT+UepM4xYZDMZ1B6jCygIUwUsB1MBHAxTAKQLQwDoB9MAlA' +
  'ZlAP5fznlPtpeXtzSfSrw/2PxD+tb4w11pdRJ8/TcZalz1VtSzlqxu3VW8vGSC8Rd3O/3eVPo7ca' +
  'L59zqXuJa6Em17P7Th/cec7v8DPzL3I3kb2cH7LNv7ST6+7OOdM/Cnv2Btfvh3TrGRnT1d13p9GZ' +
  'YT+eblLx/qad/+NIxMg29G30AO/ShPjWyr3dTytY8I+D24waTezdrq6+TEFNRTMuMTAwqqqqqqqq' +
  'qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq' +
  'qqqqqqqqqqqqqqqqqqqqqqqqqqru99zz5zDf813Wv/et/SmAAIGDoZmGgjGFIJmFQoGY6Dm3kuGI' +
  'pj9ZyHHQ2ajOMtmHoBJBg54KeYI8B+GBRAVBgQIDaYCYAeGATgF7Bcd6Mg49zIzbFOw1JelhLKju' +
  'MRqOdHqpkudB1HZc6WVqZTsaxZKv25FYUEXcbnvSdLsNdrBxaHI2wGVnTSyK6DHr+jlTW070dlUz' +
  'XezWchlVGS4oFsVL/+NIxKMtlGIAAO/KhWOVWIl6siS77pcfvUw2wirusWlqTEFNRTMuMTAwqqqq' +
  'qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq' +
  'qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqv1/f3/5' +
  'f/dfjr//XdWwwBjB4CTEcKjGgUTIQuTIlQjLygTBkyBgzTrtIMdjGbDBMgi0wE0EGMAbAeTASQAU' +
  'wGAABMBHAAAEAmtDz/ioxLt6Usm+3XMnvuRHrZ7sjUuuW72pgrLm6P/Os5HpkvRnWyLewNbLfiV0' +
  '9lV6WX9L9Or0qsZNrdAU/+NIxIYmdGYIAO/EhHo25wbunZkWXpZd/1222JZFtjIiTEFNRTMuMTAw' +
  'qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq' +
  'qu43O8w7foecxuav75+vv54CILzAEbDCYqTHUqDQczDao0zwVLDHBA3k+c9mHOCOCmTGBQI4wqgA' +
  '6MFXAtzAdQMswAgCqMAAAcTAAQFxkGGWKDLPix89zDlzRPSfMxkeOGUo2R8488Z3wo2aYgdxx3Qz' +
  'HrI7ispMjyZqhJ/FxNEDcWEnTVj5v6HLjho2llRabcix/FBYb11zFRNwMqxnU/IzTq+LxLcjNoY0' +
  'bNN1E45zTmjTcpBHie+xw0bj/+NIxLwz/GX4AO/Qhf6mKSLHT/jq7HzD8SUkljcfuewDTEFNRTMu' +
  'MTAwVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV' +
  'VVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVXSVqzCySrL1rsag' +
  'dGAQgDZgHgA8GAQQFAeDAawSMwSYJ8MMBIOzZlvFkzmkaXMKyCVDBUQUUwOADcMCMAgDAfQEswEw' +
  'AkMApAGV64f10ciWX3Z2N90ufdGeelyDNI9rKjU0zq6W2jbvoujVv1Vx1q5b1ZUSRWdWFUuZX4Yt' +
  '10TV2tT9KrreJ0RmRB7WW1ajVZU7/+NIxJIpbD4EAIfKaJQpxy9GRZF6T7rdbJl03E0jURVKTEFN' +
  'RTMuMTAwqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq' +
  'qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqv5rnd853X46/Pf/++at' +
  'mAYBGEQPmJ4mGPg3mWBrmaavGpFTmFukQRr33xkZqmNdGEqBIJga4IEYA4AtmAagAxgLwBOYCWAO' +
  'GAVACq/8+dVHOldqu7MXf7k2VkS1XcZoqJZBnZ0yrW1cruXVdW72ZFc41nJmvWZLvHFVhdLKvhqv' +
  'Xe9XdWZf0ZFt6tRtTJZLbuzjkR9x4SId/+NIxJgqzGYEAO/KhTkYt13RHbJtSuZZUkKdzFZ8VUfV' +
  'TEFNRTMuMTAwVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV' +
  'VVVVVVVVVVVVVVVV7373LusauH5XOZa7+vvXbg6F4oNQWKExFI4zhIA2YCM7/HExwoJAPonRWDgw' +
  'gfIxhcDnMK+A0jBewPkwKEDhMBKAsDADwHMGALzPrufpjzI2jvmiehaevqZsf7jaq0VZxwyo6HOm' +
  '5H9JNYyaIkdz5F0M7GTUiWuJ/obtAgvbVZM3jbMmR41BMw1RTqVsdxhTuYuxvdzdDd1u5+IRe+Jr' +
  'JHRjmGyYXFDeqizAwMm8fcWZYmEa6riiuzon/+NIxLozXG34AO/QhH7uLfvjHpObMX0aJJyRtGci' +
  'PFmKTEFNRTMuMTAwqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq' +
  'qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqr+b5+He3P/euY6//1z' +
  'CyvEwAcAqMCAAXDAIAHAwLMBHMD7CEzBfwXYwaIHLNfe/jzKfzMkx58RjMOfCzTBNQBUwAUC1MEp' +
  'A8TApwJcwGkALX7h3n773X81/dkRir9MV0WdUdFujaHLdhj11zsy28zMfVdX7dEccR66X3VVojKq' +
  'DVuMRuGo7poururon9nT2nHKrNQrJS1KuR1vSJhM/+NIxJ0sHGYEAV8oAaReMlu2zXbRL1821Hdm' +
  'RWdEIMg1kAEEEEEGeu5MGUgsdFkwV4EGMBvBgTBYwJcwWEFB/9dQ3dgIAIzABgCAwEYG2MHQA8jB' +
  'pgdwEhQ+zAzwjYyppf8MFTA5jAIAAIwTYHFNBpTwTCNAIsw4UJtMO7H1TMLg0AyVsMZ+f//8wDA8' +
  'IBtYg8A6KE2cYvGYqtsbuHQZaIkYsGuaLkv/O97lvqQC77Sk2sUS9HbMTy1MSx+MwhsMHCAMQBPM' +
  'kRVAoxmHIXZb3hllv+YT7J30nGmQ3PuvEJwxuEIlEwwyBsxZDcKB2YWgQYjBYAQuAwmmHIS87jze' +
  'v/mXNupE5+B5ROQJNy+H6k4YCBKJCMYXA8YDg4TB6YSg/+NIxP9ic8Ig8Z/oAMmBAKjwdmDgJGBY' +
  'HCQYGCoH/lvtT/3h3//UUrz8XmLEsu5y+pYllcwKAkMC8wOAowLAQICQwJAcwKAEHBGYCAIBgWBQ' +
  'OAEAQcCoGBv/3/73hl3DeGvx/VuX3LFJu3b1YsVc6e5esXSzgYCQGBAuuJAiBgPR4FgSAQEKVjwG' +
  'gIB14EQHAIAGZlAElk1kQJAGFDGHCAoE64MCmOLmYLhAZHUwgsxQsBCWSAUYZtEaVECiIjDGTNGd' +
  'NGVDI3mYanOxnovi0I0UE5UE1QcKljTqDOgAQdNYzASYKDTMHTOGzMEwMRZAYMYZEgDgLoF/iyxb' +
  'ZOqA0EpZETJTjdDUiGktYBvBHi4vDmJ0Qo6n5fR6Tqhp00TR/+NIxIg/+n44Adp4AVDETxpKGjEn' +
  'kOUU7ChrNuCrVarZoSue6hMSuZo0F6+3l6wvYuH1dYhPn0bNbW9Xr2Lq1a/EJ9G37W3mr2LX5rr2' +
  'hBTwrEFBcTQoKOCmwUFxFQgo4KeCgvQXIKGQjgUFbBcgoZCOigrYLwKGQjooK2C+FDIQ3EFeCkxB' +
  'TUUzLjEwMKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq' +
  'qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq' +
  'qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq';

const MICRO_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVQI12P4z8AAAAMBAQAY3Y2wAAAAAElFTkSuQmCC';

interface FixtureDef {
  name: string;
  mimeType: string;
  base64: string;
  /** 音频无宽高 */
  width?: number;
  height?: number;
  durationSec?: number;
  sizeBytes: number;
}

/** 三个内嵌产物；`name` 与 `{fixtureBaseUrl}/mock-fixture/{name}` 一一对应 */
export const MOCK_FIXTURES: Record<string, FixtureDef> = {
  'video.mp4': {
    name: 'video.mp4',
    mimeType: 'video/mp4',
    base64: MICRO_MP4_BASE64,
    width: 16,
    height: 16,
    durationSec: 1,
    sizeBytes: 1518,
  },
  'image.png': {
    name: 'image.png',
    mimeType: 'image/png',
    base64: MICRO_PNG_BASE64,
    width: 1,
    height: 1,
    sizeBytes: 69,
  },
  'audio.mp3': {
    name: 'audio.mp3',
    mimeType: 'audio/mpeg',
    base64: MICRO_MP3_BASE64,
    sizeBytes: 4941,
  },
};

/** 能力 → fixture 文件名（决定 poll 输出什么 mimeType 的产物） */
const CAPABILITY_FIXTURE: Record<Capability, string> = {
  text_to_video: 'video.mp4',
  image_to_video: 'video.mp4',
  video_translate: 'video.mp4',
  viral_remix: 'video.mp4',
  avatar_talk: 'video.mp4',
  text_to_image: 'image.png',
  image_to_image: 'image.png',
  text_to_audio: 'audio.mp3',
  tts: 'audio.mp3',
  text_to_music: 'audio.mp3',
};

// ---------------------------------------------------------------- 失败注入

/** 支持的失败模式（PRD §5.3 / CONTRACT §5） */
export const MOCK_FAIL_MODES = [
  'timeout',
  'upstream_error',
  'content_rejected',
  'insufficient_balance',
] as const;

export type MockFailMode = (typeof MOCK_FAIL_MODES)[number];

export function isMockFailMode(v: unknown): v is MockFailMode {
  return typeof v === 'string' && (MOCK_FAIL_MODES as readonly string[]).includes(v);
}

/**
 * 失败注入是否被允许。
 *
 * 安全要求：`MOCK_FAIL_INJECTION === true` **且**当前确实处于 Mock 模式
 * （`MOCK_PROVIDER=true`）时才生效，否则一律忽略。
 *
 * 为什么不额外要求 `NODE_ENV !== 'production'`：本项目**生产部署就是 MOCK_PROVIDER=true**
 * （见部署说明），若按 NODE_ENV 判定，服务器上跑的 E2E 会全部无法注入失败。
 * 真正的生产安全边界是 `MOCK_PROVIDER` 这个开关本身 —— 一旦切到真实上游
 * （MOCK_PROVIDER=false），MockProvider 根本不会被实例化，注入自然失效。
 * `MOCK_FAIL_INJECTION` 则是第二道开关，便于在需要时单独关掉注入能力。
 */
function failInjectionAllowed(): boolean {
  const cfg = getConfig();
  return cfg.MOCK_FAIL_INJECTION === true && cfg.MOCK_PROVIDER === true;
}

/** 失败模式 → 上报错误（code 与 PRD §8.9 错误码表对齐） */
function failModeToError(mode: MockFailMode): { code: string; message: string; retryable: boolean } {
  switch (mode) {
    case 'timeout':
      // 永不终态：由 Worker 的超时扫描兜底 → timeout + 全额返还
      return { code: 'PROVIDER_ERROR', message: 'mock timeout (never final)', retryable: true };
    case 'upstream_error':
      return { code: 'PROVIDER_ERROR', message: 'mock upstream_error (refunded by platform)', retryable: true };
    case 'content_rejected':
      return { code: 'CONTENT_REJECTED', message: 'mock content policy rejection', retryable: false };
    case 'insufficient_balance':
      // 触发平台余额告警路径（P0）：不可重试
      return { code: 'PLATFORM_BALANCE', message: 'mock insufficient platform balance', retryable: false };
  }
}

// ---------------------------------------------------------------- job 状态

/**
 * Mock job 状态。
 * 存 Redis（跨进程：API 提交、Worker 轮询可能不在同一进程） + 进程内 Map（快路径）。
 */
export interface MockJobState {
  externalJobId: string;
  taskId: string;
  capability: Capability;
  submittedAt: number;
  latencyMs: number;
  failMode: MockFailMode | null;
  cancelled: boolean;
}

const REDIS_MOCK_JOB_TTL_SEC = 3600; // 1h

function mockJobKey(externalJobId: string): string {
  return `mock:job:${externalJobId}`;
}

/** 进程内快路径缓存（Redis 不可用时仍能工作，保证单进程 CI 稳定） */
const localJobs = new Map<string, MockJobState>();

export function resetMockJobs(): void {
  localJobs.clear();
}

async function saveJob(state: MockJobState): Promise<void> {
  localJobs.set(state.externalJobId, state);
  try {
    await redis().set(mockJobKey(state.externalJobId), JSON.stringify(state), 'EX', REDIS_MOCK_JOB_TTL_SEC);
  } catch (e) {
    // Redis 不可用不应让 Mock 生成失败 —— 单进程测试完全依赖本地 Map
    log.warn({ err: e, jobId: state.externalJobId }, 'mock job persist to redis failed (local map only)');
  }
}

async function loadJob(externalJobId: string): Promise<MockJobState | null> {
  const local = localJobs.get(externalJobId);
  if (local) return local;

  try {
    const raw = await redis().get(mockJobKey(externalJobId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as MockJobState;
    localJobs.set(externalJobId, parsed);
    return parsed;
  } catch (e) {
    log.warn({ err: e, jobId: externalJobId }, 'mock job load from redis failed');
    return null;
  }
}

// ---------------------------------------------------------------- MockProvider

export interface MockProviderOptions {
  latencyMs?: number;
  failInjection?: boolean;
  /** 产出 fixture 的本地 HTTP 基址，供 transfer 队列真实下载 */
  fixtureBaseUrl?: string;
}

/**
 * fixture 基址默认取 `MOCK_FIXTURE_BASE_URL`，未配置时回落 `http://localhost:8080`。
 *
 * ⚠️ 容器化部署必须显式配置：`localhost` 在 worker 容器里指向**容器自己**，
 * 而 `/mock-fixture/*` 路由挂在 api 容器上 —— 结果就是 ECONNREFUSED，
 * 所有产物转存静默失败（`result_asset_ids` 为空）。
 * 服务器部署填 `http://api:8080`（compose 内部 DNS）即可。
 */
function fixtureBaseUrl(opts: MockProviderOptions): string {
  const raw =
    opts.fixtureBaseUrl ?? process.env['MOCK_FIXTURE_BASE_URL'] ?? 'http://localhost:8080';
  return raw.replace(/\/+$/, '');
}

/** Mock 渠道代号（seed 中也会建同名 channel，且不需要真实凭据） */
export const MOCK_CHANNEL_CODE = 'mock';

export class MockProvider implements GenerationProvider {
  readonly channelCode = MOCK_CHANNEL_CODE;
  readonly supportedCapabilities: Capability[] = [...CAPABILITIES];

  private readonly opts: MockProviderOptions;

  constructor(opts: MockProviderOptions = {}) {
    this.opts = opts;
  }

  private latency(): number {
    return this.opts.latencyMs ?? getConfig().MOCK_LATENCY_MS;
  }

  private baseUrl(): string {
    return fixtureBaseUrl(this.opts);
  }

  /**
   * 从请求里解析失败注入模式。
   *
   * ⚠️ 通道说明：`submit()` 的签名只拿到 `GenerationRequest`，**没有 HTTP 头**。
   * 因此路由层必须把 `X-Mock-Fail` 头写进 `params.__mockFail`（D 模块已如此实现，
   * 见 `tasks/service.ts` 的 `mockFail` 字段）；这里只读 `params.__mockFail`。
   */
  private resolveFailMode(req: GenerationRequest): MockFailMode | null {
    if (this.opts.failInjection === false) return null;
    if (!failInjectionAllowed()) return null;

    const raw = req.params['__mockFail'];
    if (raw === undefined || raw === null) return null;
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (isMockFailMode(value)) return value;

    log.warn({ value: String(value) }, 'mock fail injection: unknown mode ignored');
    return null;
  }

  async listModels(): Promise<ModelDescriptor[]> {
    // seed 未建 mock 渠道 → 返回 []（不抛错，避免 catalog 启动失败）
    try {
      return await loadModelsForChannel(MOCK_CHANNEL_CODE);
    } catch {
      return [];
    }
  }

  validate(req: GenerationRequest, model: ModelDescriptor): ValidationResult {
    return validateRequest(req, model);
  }

  async submit(
    req: GenerationRequest,
    model: ModelDescriptor,
    _creds: ChannelCreds,
  ): Promise<SubmitResult> {
    const externalJobId = `mock_${req.taskId}`;
    const failMode = this.resolveFailMode(req);
    const latencyMs = this.latency();

    const state: MockJobState = {
      externalJobId,
      taskId: req.taskId,
      capability: req.capability,
      submittedAt: Date.now(),
      latencyMs,
      failMode,
      cancelled: false,
    };
    await saveJob(state);

    log.info(
      { externalJobId, model: model.code, capability: req.capability, failMode, latencyMs },
      'mock submit',
    );

    return { externalJobId, estimatedSec: Math.ceil(latencyMs / 1000), raw: { mock: true, failMode } };
  }

  async poll(
    externalJobId: string,
    model: ModelDescriptor,
    _creds: ChannelCreds,
  ): Promise<PollResult> {
    const job = await loadJob(externalJobId);

    // 未知 job（Redis 过期/进程重启）：按"仍在跑"处理，交给 Worker 超时扫描兜底，
    // 不能直接判失败 —— 那会误伤正常任务。
    if (!job) {
      log.warn({ externalJobId }, 'mock poll: job state not found, reporting running');
      return { state: 'running', progress: 5, isFinal: false, raw: { mock: true, missing: true } };
    }

    if (job.cancelled) {
      return { state: 'cancelled', isFinal: true, raw: { mock: true, cancelled: true } };
    }

    const elapsed = Date.now() - job.submittedAt;
    const done = elapsed >= job.latencyMs;

    // ---- 未到时间：按时间线性推进 5%~95% ----
    if (!done) {
      const ratio = job.latencyMs <= 0 ? 1 : Math.min(1, elapsed / job.latencyMs);
      const progress = Math.round(5 + ratio * 90); // 5 → 95
      return {
        state: 'running',
        progress: Math.min(95, Math.max(5, progress)),
        isFinal: false,
        raw: { mock: true, elapsed, latencyMs: job.latencyMs },
      };
    }

    // ---- 到时间 + 失败注入 ----
    if (job.failMode) {
      // `timeout`：**永不终态**，poll 一直 running，由 Worker 侧 TASK_TIMEOUT_MIN 兜底
      if (job.failMode === 'timeout') {
        return {
          state: 'running',
          progress: 95,
          isFinal: false,
          raw: { mock: true, injected: 'timeout' },
        };
      }

      const error = failModeToError(job.failMode);
      return {
        state: 'failed',
        isFinal: true,
        // 上游超时/内部错误类失败余额已退 → refunded=true 表示可原样重提
        refunded: job.failMode === 'upstream_error',
        error,
        raw: { mock: true, injected: job.failMode },
      };
    }

    // ---- 到时间 + 成功 ----
    const fixtureName = CAPABILITY_FIXTURE[job.capability] ?? 'video.mp4';
    const fixture = MOCK_FIXTURES[fixtureName];
    if (!fixture) {
      // 理论不可达：CAPABILITY_FIXTURE 全部指向存在的 fixture
      return {
        state: 'failed',
        isFinal: true,
        error: { code: 'PROVIDER_ERROR', message: `mock fixture ${fixtureName} not found`, retryable: false },
      };
    }

    const output: PollOutput = {
      mimeType: fixture.mimeType,
      remoteUrl: `${this.baseUrl()}/mock-fixture/${fixture.name}`,
      meta: {
        // PollOutput.meta 的 width/height 是必填；音频无画面，按 0 上报
        // （transfer 阶段写 assets.width/height，0 表示"不适用"）
        width: fixture.width ?? 0,
        height: fixture.height ?? 0,
        ...(fixture.durationSec !== undefined ? { durationSec: fixture.durationSec } : {}),
        sizeBytes: fixture.sizeBytes,
      },
    };

    log.info({ externalJobId, model: model.code, mimeType: fixture.mimeType }, 'mock poll succeeded');

    return {
      state: 'succeeded',
      progress: 100,
      isFinal: true,
      outputs: [output],
      costUnits: this.costUnitsFor(job.capability),
      refunded: false,
      channelGroup: 'MOCK-G1',
      raw: { mock: true, fixture: fixture.name },
    };
  }

  /** 随机但合理的成本（算力口径）；确定性下限避免出现 0 成本把毛利算歪 */
  private costUnitsFor(capability: Capability): number {
    const range: Record<string, [number, number]> = {
      text_to_video: [0.2, 3.5],
      image_to_video: [0.2, 3.5],
      video_translate: [0.2, 3.5],
      viral_remix: [0.2, 3.5],
      avatar_talk: [0.2, 3.5],
      text_to_image: [0.05, 0.5],
      image_to_image: [0.05, 0.5],
      text_to_audio: [0.02, 0.2],
      tts: [0.02, 0.2],
      text_to_music: [0.3, 1.5],
    };
    const [min, max] = range[capability] ?? [0.1, 1];
    const v = min + Math.random() * (max - min);
    return Math.round(v * 10000) / 10000;
  }

  async cancel(externalJobId: string, _model: ModelDescriptor, _creds: ChannelCreds): Promise<void> {
    const job = await loadJob(externalJobId);
    if (!job) return;
    job.cancelled = true;
    await saveJob(job);
  }

  mapError(error: unknown): MappedError {
    log.warn({ err: error }, 'mock provider error');
    return { code: 'PROVIDER_ERROR', retryable: true, userMessage: 'mock failure' };
  }
}

// ---------------------------------------------------------------- fixture 路由

/**
 * 由 `main.ts` 挂载：`GET /mock-fixture/:name` 返回内置的极小合法媒体文件。
 *
 * 为什么需要：MockProvider 的 `outputs[].remoteUrl` 指向这里，transfer 队列会走
 * **真实 HTTP 下载 + 魔数校验 + 上传对象存储**的完整路径，而不是被 mock 掉。
 * 这样 E2E 能覆盖转存链路，且全程不碰外网。
 */
export function mockFixtureRoutes(app: FastifyInstance): void {
  app.get<{ Params: { name: string } }>('/mock-fixture/:name', async (req, reply) => {
    // 防目录穿越：只接受白名单文件名
    const name = req.params.name.replace(/[^a-zA-Z0-9._-]/g, '');
    const fixture = MOCK_FIXTURES[name];
    if (!fixture) {
      return reply.status(404).send({ ok: false, error: { code: 'NOT_FOUND', message: 'fixture not found' } });
    }

    const buf = Buffer.from(fixture.base64, 'base64');
    return reply
      .header('Content-Type', fixture.mimeType)
      .header('Content-Length', String(buf.length))
      .header('Cache-Control', 'public, max-age=3600')
      .send(buf);
  });
}

/** 供测试断言 fixture 合法性（魔数校验会用到） */
export function mockFixtureBuffer(name: string): Buffer | null {
  const fixture = MOCK_FIXTURES[name];
  return fixture ? Buffer.from(fixture.base64, 'base64') : null;
}
