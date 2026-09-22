/**
 * Vutu 生图工作台 —— 应用外壳
 * ------------------------------------------------------------------
 * 四区布局（对齐 V2 效果图）：
 *   ┌─────────────────── TopBar ───────────────────┐
 *   ├────────┬────────────────────────┬────────────┤
 *   │ 左栏    │      中间结果流          │  右参数面板 │
 *   │ 模型选择 │  （悬浮 composer 在底部）│            │
 *   └────────┴────────────────────────┴────────────┘
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  api,
  ApiError,
  matchPrice,
  newIdempotencyKey,
  offlineMode,
  streamTask,
  toParamOptions,
  type Capability,
  type CatalogModel,
  type ParamOption,
  type ResolvedModelDetail,
  type TaskStatus,
  type TaskSummary,
} from './lib/api';
import { DEMO_MODELS, DEMO_MODEL_DETAIL, DEMO_TASKS } from './lib/demo';
import { TopBar } from './components/TopBar';
import { ModelRail } from './components/ModelRail';
import { ResultFeed } from './components/ResultFeed';
import { Inspector } from './components/Inspector';
import { Composer } from './components/Composer';
import './styles/app.css';

/** 生成参数（面板与 composer 共享） */
export interface GenParams {
  aspectRatio: string;
  resolution: string;
  count: number;
  seed: string;
}

const DEFAULT_PARAMS: GenParams = {
  aspectRatio: '1:1',
  resolution: '2K',
  count: 1,
  seed: '',
};

export default function App() {
  // ---------------- 目录数据 ----------------
  const [models, setModels] = useState<CatalogModel[]>([]);
  const [detail, setDetail] = useState<ResolvedModelDetail | null>(null);
  const [selectedId, setSelectedId] = useState<string>('');
  const [catalogLoading, setCatalogLoading] = useState(true);

  // ---------------- 任务流 ----------------
  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  const [activeTab, setActiveTab] = useState('image');
  const [query, setQuery] = useState('');

  // ---------------- 输入与参数 ----------------
  const [prompt, setPrompt] = useState('');
  const [params, setParams] = useState<GenParams>(DEFAULT_PARAMS);
  const [references, setReferences] = useState<Array<{ id: string; name: string; url: string }>>([]);
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  /** 每个任务的 SSE 取消函数 */
  const streamsRef = useRef(new Map<string, () => void>());

  /** 目录加载时已取到的模型详情缓存，避免切换模型重复请求 */
  const detailsByIdRef = useRef(new Map<string, ResolvedModelDetail>());

  const notify = useCallback((kind: 'ok' | 'err', text: string) => {
    setToast({ kind, text });
    window.setTimeout(() => setToast(null), 3600);
  }, []);

  // ---------------- 首次加载目录 ----------------
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const list = await api.models();
        if (cancelled) return;

        // 列表接口没有 capability，必须逐个查详情才能可靠区分图片/视频
        // （durations 不可靠：GK Video 3.5 的 durations 就是空的）
        const details = await Promise.allSettled(list.map((m) => api.model(m.id)));

        const imageModels: CatalogModel[] = [];
        const detailById = new Map<string, ResolvedModelDetail>();

        details.forEach((r, i) => {
          const m = list[i];
          if (!m || r.status !== 'fulfilled') return;
          const d = r.value;
          if (d.capabilityKind !== 'image') return;

          const opts = toParamOptions(d.params);
          const resolved: ResolvedModelDetail = {
            ...d,
            params: opts.length ? opts : deriveParams(m),
          };
          detailById.set(m.id, resolved);
          imageModels.push({ ...m, capabilities: d.capabilities });
        });

        if (cancelled) return;
        detailsByIdRef.current = detailById;
        setModels(imageModels.length > 0 ? imageModels : DEMO_MODELS);
        setSelectedId(imageModels[0]?.id ?? DEMO_MODELS[0]!.id);
      } catch {
        // 后端不可达 → 降级演示数据，保证工作台可用
        if (cancelled) return;
        setModels(DEMO_MODELS);
        setSelectedId(DEMO_MODELS[0]?.id ?? DEMO_MODELS[0]!.id);
      } finally {
        if (!cancelled) setCatalogLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // ---------------- 选中模型 → 切详情 ----------------
  useEffect(() => {
    if (!selectedId) return;

    // 目录加载时已缓存，直接用
    const cached = detailsByIdRef.current.get(selectedId);
    if (cached) {
      setDetail(cached);
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const d = await api.model(selectedId);
        if (cancelled) return;
        const opts = toParamOptions(d.params);
        setDetail({
          ...d,
          params: opts.length ? opts : deriveParams(models.find((x) => x.id === selectedId)),
        });
      } catch {
        // 详情不可用（演示 id 或后端边界 bug）→ 用列表项字段构造参数
        if (cancelled) return;
        const m = models.find((x) => x.id === selectedId);
        setDetail({
          ...DEMO_MODEL_DETAIL,
          id: selectedId,
          displayName: m?.displayName ?? DEMO_MODEL_DETAIL.displayName,
          params: deriveParams(m),
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedId, models]);

  // ---------------- 创作记录 ----------------
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const page = await api.tasks({ type: 'image', limit: 20 });
        if (!cancelled) setTasks(page.items);
      } catch {
        if (!cancelled) setTasks(DEMO_TASKS);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // ---------------- SSE 订阅：跟踪进行中任务 ----------------
  useEffect(() => {
    const terminal: TaskStatus[] = ['succeeded', 'failed', 'cancelled', 'timeout'];

    for (const t of tasks) {
      if (terminal.includes(t.status) || streamsRef.current.has(t.id)) continue;
      // 临时占位任务（temp_）等待真实任务替换，不建 SSE
      if (t.id.startsWith('temp_')) continue;

      const stop = streamTask(t.id, (event, data) => {
        if (event === 'error') {
          // SSE 连不上（含 EventSource 无鉴权头导致的 401）→ 回落一次详情查询，转存未完成则继续轮询
          void (async () => {
            try {
              const detail = await api.task(t.id);
              if (detail.status === 'succeeded' && (!detail.results || detail.results.length === 0)) {
                const waited = await waitForTaskResults(t.id);
                setTasks((prev) => prev.map((x) => (x.id === t.id ? { ...x, ...waited } : x)));
              } else {
                setTasks((prev) => prev.map((x) => (x.id === t.id ? { ...x, ...detail } : x)));
              }
              if (terminal.includes(detail.status)) {
                streamsRef.current.get(t.id)?.();
                streamsRef.current.delete(t.id);
              }
            } catch {
              /* 保持占位，等待下次 tasks 变化重试 */
            }
          })();
          return;
        }
        const payload = (data ?? {}) as Partial<TaskSummary> & { progress?: number };

        // succeeded 但无结果（转存未完成）→ 拉详情等待转存，最多 30 秒，期间保持 running 避免闪空
        if (payload.status === 'succeeded' && (!payload.results || payload.results.length === 0)) {
          setTasks((prev) =>
            prev.map((x) =>
              x.id === t.id ? { ...x, status: 'running' as TaskStatus, progress: 99 } : x,
            ),
          );
          void (async () => {
            const waited = await waitForTaskResults(t.id);
            setTasks((prev) => prev.map((x) => (x.id === t.id ? { ...x, ...waited } : x)));
            streamsRef.current.get(t.id)?.();
            streamsRef.current.delete(t.id);
          })();
          return;
        }

        setTasks((prev) =>
          prev.map((x) =>
            x.id === t.id
              ? {
                  ...x,
                  ...payload,
                  status: (payload.status ?? x.status) as TaskStatus,
                  progress: payload.progress ?? x.progress,
                }
              : x,
          ),
        );

        if (terminal.includes(payload.status as TaskStatus)) {
          streamsRef.current.get(t.id)?.();
          streamsRef.current.delete(t.id);
        }
      });

      streamsRef.current.set(t.id, stop);
    }
  }, [tasks]);

  // 卸载时清理所有 SSE
  useEffect(() => {
    const map = streamsRef.current;
    return () => {
      for (const stop of map.values()) stop();
      map.clear();
    };
  }, []);

  // ---------------- 提交生成 ----------------
  const submit = useCallback(async () => {
    const text = prompt.trim();
    if (!text) {
      notify('err', '请先输入提示词');
      return;
    }
    if (!selectedId) {
      notify('err', '请先选择模型');
      return;
    }

    const capability: Capability = references.length > 0 ? 'image_to_image' : 'text_to_image';

    // 乐观插入占位任务，让结果流立即有反馈
    const tempId = `temp_${Date.now()}`;
    const optimistic: TaskSummary = {
      id: tempId,
      status: 'queued',
      progress: 0,
      capability,
      prompt: text,
      model: { id: selectedId, displayName: displayNameOf(models, selectedId) },
      params: { ...params },
      results: [],
      createdAt: new Date().toISOString(),
    };
    setTasks((prev) => [optimistic, ...prev]);
    setSubmitting(true);

    try {
      const { task } = await api.createTask({
        capability,
        modelId: selectedId,
        prompt: text,
        inputAssetIds: references.map((r) => r.id),
        params: {
          aspectRatio: params.aspectRatio,
          resolution: params.resolution,
          count: params.count,
          ...(params.seed ? { seed: params.seed } : {}),
        },
        idempotencyKey: newIdempotencyKey(),
      });

      // 用真实任务替换占位
      setTasks((prev) => prev.map((x) => (x.id === tempId ? task : x)));
      setPrompt('');
      setReferences([]);
      notify('ok', '任务已提交，正在生成…');
    } catch (e) {
      setTasks((prev) => prev.filter((x) => x.id !== tempId));
      const msg =
        e instanceof ApiError
          ? e.code === 'NETWORK_ERROR'
            ? '无法连接后端服务'
            : e.code === 'UNAUTHORIZED'
              ? '请先登录后再生成'
              : e.message
          : '提交失败';
      notify('err', msg);
    } finally {
      setSubmitting(false);
    }
  }, [prompt, selectedId, references, params, models, notify]);

  // ---------------- 结果操作 ----------------
  const onRegenerate = useCallback(
    (task: TaskSummary) => {
      setPrompt(task.prompt ?? '');
      setSelectedId(task.model.id);
      const p = (task.params ?? {}) as Partial<GenParams>;
      setParams({
        aspectRatio: p.aspectRatio ?? DEFAULT_PARAMS.aspectRatio,
        resolution: p.resolution ?? DEFAULT_PARAMS.resolution,
        count: typeof p.count === 'number' ? p.count : DEFAULT_PARAMS.count,
        seed: typeof p.seed === 'string' ? p.seed : '',
      });
      notify('ok', '已回填参数，可直接再次生成');
    },
    [notify],
  );

  const onDelete = useCallback(
    async (task: TaskSummary) => {
      setTasks((prev) => prev.filter((x) => x.id !== task.id));
      for (const r of task.results ?? []) {
        try {
          await api.deleteAsset(r.assetId);
        } catch {
          /* 演示数据无真实资产，忽略 */
        }
      }
      notify('ok', '已从工作台移除');
    },
    [notify],
  );

  const onCancel = useCallback(
    async (task: TaskSummary) => {
      try {
        await api.cancelTask(task.id);
        setTasks((prev) =>
          prev.map((x) => (x.id === task.id ? { ...x, status: 'cancelled' as TaskStatus } : x)),
        );
      } catch {
        notify('err', '取消失败');
      }
    },
    [notify],
  );

  // ---------------- 派生 ----------------
  const visibleTasks = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return tasks;
    return tasks.filter((t) => (t.prompt ?? '').toLowerCase().includes(q));
  }, [tasks, query]);

  const paramOptions: ParamOption[] = detail?.params?.length
    ? detail.params
    : DEMO_MODEL_DETAIL.params;

  const selectedModel = models.find((m) => m.id === selectedId);

  const estCredits = useMemo(() => {
    const rows = detail?.pricing ?? DEMO_MODEL_DETAIL.pricing;
    const base = matchPrice(rows, {
      resolution: params.resolution,
      aspectRatio: params.aspectRatio,
    });
    return Number((base * params.count).toFixed(2));
  }, [detail, params]);

  return (
    <div className="app">
      <TopBar
        active={activeTab}
        onTab={setActiveTab}
        credits={58.1}
        offline={offlineMode}
        onAssets={() => notify('ok', '素材库：建设中')}
        onGallery={() => notify('ok', '画廊：建设中')}
        onSettings={() => notify('ok', '设置：建设中')}
      />

      <div className="app__body">
        <ModelRail
          models={models}
          selectedId={selectedId}
          onSelect={setSelectedId}
          loading={catalogLoading}
          query={query}
          onQuery={setQuery}
          credits={58.1}
        />

        <main className="app__center">
          <ResultFeed
            tasks={visibleTasks}
            onRegenerate={onRegenerate}
            onDelete={onDelete}
            onCancel={onCancel}
          />

          <Composer
            prompt={prompt}
            onPrompt={setPrompt}
            references={references}
            onReferences={setReferences}
            params={params}
            onSubmit={submit}
            submitting={submitting}
            estCredits={estCredits}
            onNotify={notify}
          />
        </main>

        <Inspector
          model={selectedModel}
          detail={detail}
          paramOptions={paramOptions}
          params={params}
          onChange={setParams}
          estCredits={estCredits}
        />
      </div>

      {toast && (
        <div className={`toast toast--${toast.kind}`} role="status">
          {toast.text}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ 工具

/**
 * 转存等待：succeeded 后 results 可能为空（后端先发终态再异步转存），轮询详情直到非空。
 * 最多 15 次 × 2 秒 = 30 秒，超时返回空结果由调用方展示转存超时态。
 */
async function waitForTaskResults(taskId: string): Promise<TaskSummary> {
  let last: TaskSummary | null = null;
  for (let i = 0; i < 15; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    try {
      const detail = await api.task(taskId);
      last = detail;
      if (detail.results && detail.results.length > 0) return detail;
      if (detail.status === 'failed' || detail.status === 'cancelled' || detail.status === 'timeout') {
        return detail;
      }
    } catch {
      /* 忽略单次失败，继续等 */
    }
  }
  return (
    last ?? {
      id: taskId,
      status: 'succeeded',
      progress: 100,
      capability: 'text_to_image',
      prompt: '',
      model: { id: '', displayName: '' },
      results: [],
      createdAt: new Date().toISOString(),
    }
  );
}

function displayNameOf(models: CatalogModel[], id: string): string {
  return models.find((m) => m.id === id)?.displayName ?? '未知模型';
}

/**
 * 由列表项字段构造参数面板选项。
 *
 * 线上 `GET /v1/catalog/models` 返回 `resolutions` / `aspectRatios`，
 * 详情接口不可用时用它们驱动右栏，避免面板空白。
 */
function deriveParams(m: CatalogModel | undefined): ParamOption[] {
  const ratios = (m?.aspectRatios ?? []).filter((r) => r !== 'auto');
  const res = (m?.resolutions ?? []).filter((r) => r !== 'auto');

  return [
    {
      key: 'aspectRatio',
      label: '画面比例',
      type: 'enum',
      default: ratios[0] ?? '1:1',
      options: (ratios.length ? ratios : ['1:1', '16:9', '9:16', '4:3']).map((v) => ({
        value: v,
        label: v,
      })),
    },
    {
      key: 'resolution',
      label: '输出质量',
      type: 'enum',
      default: res.includes('2K') ? '2K' : (res[0] ?? '2K'),
      options: (res.length ? res : ['1K', '2K', '4K']).map((v) => ({ value: v, label: v })),
    },
    { key: 'count', label: '生成张数', type: 'number', default: 1, min: 1, max: 4, step: 1 },
  ];
}
