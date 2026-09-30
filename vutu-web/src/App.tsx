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
  clearSession,
  hydrateTask,
  isLoggedIn,
  matchPrice,
  newIdempotencyKey,
  offlineMode,
  restoreSession,
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
import { Composer, type RefImage } from './components/Composer';
import { AuthDialog } from './components/AuthDialog';
import { BatchPanel } from './components/BatchPanel';
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
  const [references, setReferences] = useState<RefImage[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  // ---------------- 会话 ----------------
  const [credits, setCredits] = useState<number | null>(null);
  const [userLabel, setUserLabel] = useState<string | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [maxConcurrency, setMaxConcurrency] = useState(2);
  const [batchOpen, setBatchOpen] = useState(false);
  const [batchBusy, setBatchBusy] = useState(false);

  const notify = useCallback((kind: 'ok' | 'err', text: string) => {
    setToast({ kind, text });
    window.setTimeout(() => setToast(null), 3600);
  }, []);

  // ---------------- 会话恢复：localStorage token → me（余额/昵称） ----------------
  const refreshMe = useCallback(async () => {
    try {
      const me = await api.me();
      setCredits(me.balance.credits);
      setMaxConcurrency(me.user.plan.maxConcurrency);
      setUserLabel(me.user.displayName ?? me.user.email ?? me.user.phone ?? '已登录');
    } catch {
      // token 失效（刷新也救不回）→ 回到未登录
      clearSession();
      setCredits(null);
      setUserLabel(null);
    }
  }, []);

  useEffect(() => {
    if (restoreSession()) void refreshMe();
  }, [refreshMe]);

  // ---------------- F2 反推 / F4 发布（决议 D1 扣积分 / D3 自动过审） ----------------
  const tabsCacheRef = useRef<Array<{ id: string }> | null>(null);

  async function handleReverse(task: TaskSummary): Promise<void> {
    const assetId = task.results?.[0]?.assetId;
    if (!assetId) {
      notify('err', '该任务没有可反推的结果图');
      return;
    }
    try {
      const out = await api.reversePrompt(assetId);
      setPrompt(out.prompt);
      notify('ok', `已提取提示词（消耗 ${out.credits} 积分）`);
      void refreshMe();
    } catch (e) {
      notify('err', e instanceof ApiError ? e.message : '反推失败');
    }
  }

  async function handlePublish(task: TaskSummary): Promise<void> {
    const assetId = task.results?.[0]?.assetId;
    const title = (task.prompt ?? '').trim();
    if (!assetId) {
      notify('err', '没有可发布的结果图');
      return;
    }
    if (!title) {
      notify('err', '该任务没有提示词可发布');
      return;
    }
    try {
      if (tabsCacheRef.current === null) {
        const lib = await api.promptLibrary();
        tabsCacheRef.current = lib.tabs;
      }
      const tab = tabsCacheRef.current.find((x) => x.id !== 'all');
      if (!tab) {
        notify('err', '暂无可发布的分类');
        return;
      }
      const res = await api.publishPost({ tabCode: tab.id, title: title.slice(0, 2000), assetId });
      notify('ok', res.status === 'published' ? '已发布到灵感广场' : '已提交审核');
    } catch (e) {
      notify('err', e instanceof ApiError ? e.message : '发布失败');
    }
  }

  // ---------------- F5 批量生成（客户端扇出 + batchId 分组；波次并发 = plan.maxConcurrency） ----------------
  async function runBatch(cfg: {
    prompt: string;
    n: number;
    aspectRatio: string;
    resolution: string;
  }): Promise<void> {
    if (batchBusy) return;
    setBatchBusy(true);
    setBatchOpen(false);
    const batchId = `b_${crypto.randomUUID()}`;
    const capability: Capability = references.length > 0 ? 'image_to_image' : 'text_to_image';
    const inputAssetIds = references.map((r) => r.assetId).filter((id): id is string => Boolean(id));
    const wave = Math.max(1, maxConcurrency);
    const indices = Array.from({ length: cfg.n }, (_, i) => i);
    let ok = 0;
    let fail = 0;
    for (let start = 0; start < indices.length; start += wave) {
      const slice = indices.slice(start, start + wave);
      await Promise.all(
        slice.map(async (i) => {
          const tempId = `temp_${batchId}_${i}`;
          const optimistic: TaskSummary = {
            id: tempId,
            status: 'queued',
            progress: 0,
            capability,
            prompt: cfg.prompt,
            model: { id: selectedId, displayName: displayNameOf(models, selectedId) },
            params: { aspectRatio: cfg.aspectRatio, resolution: cfg.resolution, count: 1 },
            results: [],
            createdAt: new Date().toISOString(),
          };
          setTasks((prev) => [optimistic, ...prev]);
          try {
            const { task } = await api.createTask({
              capability,
              modelId: selectedId,
              prompt: cfg.prompt,
              inputAssetIds,
              params: { aspectRatio: cfg.aspectRatio, resolution: cfg.resolution, count: 1 },
              idempotencyKey: newIdempotencyKey(),
              batchId,
            });
            // ⚠️ 回退分支必须是 x 而不是 task：
            // 写 task 会把列表里**其余所有行**（含全部历史任务）都替换成这条任务。
            setTasks((prev) =>
              prev.map((x) => (x.id === tempId ? { ...task, prompt: cfg.prompt } : x)),
            );
            ok += 1;
          } catch {
            // 逐项独立失败（对齐 assets batch-delete 语义），单项失败不影响其余
            setTasks((prev) => prev.filter((x) => x.id !== tempId));
            fail += 1;
          }
        }),
      );
    }
    setBatchBusy(false);
    void refreshMe();
    notify(
      fail > 0 ? 'err' : 'ok',
      fail > 0 ? `批量提交：成功 ${ok} · 失败 ${fail}` : `批量完成：${ok} 个任务已提交`,
    );
  }

  const handleAuthButton = useCallback(() => {
    if (isLoggedIn()) {
      // 已登录态点账号 → 登出
      void (async () => {
        await api.logout();
        clearSession();
        setCredits(null);
        setUserLabel(null);
        setTasks(DEMO_TASKS);
        notify('ok', '已退出登录');
      })();
    } else {
      setAuthOpen(true);
    }
  }, [notify]);

  /** 每个任务的 SSE 取消函数 */
  const streamsRef = useRef(new Map<string, () => void>());

  /** 目录加载时已取到的模型详情缓存，避免切换模型重复请求 */
  const detailsByIdRef = useRef(new Map<string, ResolvedModelDetail>());

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
        if (cancelled) return;
        setTasks(page.items);

        // 列表接口不返回 results（后端 serializeTaskListRow 无该字段），
        // 因此**终态任务**既不会被下面的 SSE effect 建流，也就没有人 hydrate，
        // 结果是刷新后所有历史任务永久显示灰骨架。
        // 这里补一次 hydrate（拉详情 + 签发 viewUrl），仅对终态且缺 results 的行。
        const TERMINAL: TaskStatus[] = ['succeeded', 'failed', 'cancelled', 'timeout'];
        const needHydrate = page.items.filter(
          (t) => TERMINAL.includes(t.status) && !(t.results && t.results.length > 0),
        );
        if (needHydrate.length === 0) return;

        const hydrated = await Promise.all(
          needHydrate.map(async (t) => {
            try {
              return await hydrateTask(t.id);
            } catch {
              return null;
            }
          }),
        );
        if (cancelled) return;
        const byId = new Map(hydrated.filter(Boolean).map((t) => [t!.id, t!]));
        if (byId.size === 0) return;
        setTasks((prev) => prev.map((x) => byId.get(x.id) ?? x));
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
          // SSE 断线 → 回落详情查询（hydrateTask 会一并签发结果图 viewUrl）
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
    if (!isLoggedIn()) {
      notify('err', '请先登录后再生成');
      setAuthOpen(true);
      return;
    }
    const pending = references.filter((r) => r.status === 'uploading');
    if (pending.length > 0) {
      notify('err', `还有 ${pending.length} 张参考图上传中，稍候再提交`);
      return;
    }
    const failed = references.filter((r) => r.status === 'error' || !r.assetId);
    if (failed.length > 0) {
      notify('err', `${failed.length} 张参考图未上传成功，请移除后重试`);
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
        inputAssetIds: references.map((r) => r.assetId).filter((id): id is string => Boolean(id)),
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
      // 提交即扣费，刷新余额
      void refreshMe();
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
  }, [prompt, selectedId, references, params, models, notify, refreshMe]);

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
        credits={credits}
        offline={offlineMode}
        userLabel={userLabel}
        onAuth={handleAuthButton}
        onAssets={() => notify('ok', '素材库：建设中')}
        onGallery={() => notify('ok', '画廊：建设中')}
        onSettings={() => notify('ok', '设置：建设中')}
        onBatch={() => setBatchOpen(true)}
      />

      <div className="app__body">
        <ModelRail
          models={models}
          selectedId={selectedId}
          onSelect={setSelectedId}
          loading={catalogLoading}
          query={query}
          onQuery={setQuery}
          credits={credits}
        />

        <main className="app__center">
          <ResultFeed
            tasks={visibleTasks}
            onRegenerate={onRegenerate}
            onDelete={onDelete}
            onCancel={onCancel}
            onReverse={(t) => void handleReverse(t)}
            onPublish={(t) => void handlePublish(t)}
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
            onRequireAuth={() => setAuthOpen(true)}
            onCharged={() => void refreshMe()}
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

      {batchOpen && (
        <BatchPanel
          aspectRatio={params.aspectRatio}
          resolution={params.resolution}
          maxConcurrency={maxConcurrency}
          busy={batchBusy}
          onClose={() => setBatchOpen(false)}
          onRun={(cfg) => void runBatch(cfg)}
        />
      )}

      <AuthDialog
        open={authOpen}
        onClose={() => setAuthOpen(false)}
        onAuthed={() => void refreshMe()}
        onNotify={notify}
      />
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
      // 拿到结果后必须经 hydrateTask 补签 viewUrl：详情接口的 results 不含 url，
      // 直接返回会让 ResultFeed 渲染 <img src={undefined}> 破图。
      if (detail.results && detail.results.length > 0) return hydrateTask(taskId);
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
