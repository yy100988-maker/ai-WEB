/**
 * 批量生成面板（F5，docs/xiaoye-adoption-design.md §7）
 * ------------------------------------------------------------------
 * 模板 × 张数 N → 客户端扇出 N 个任务（同一 batchId，波次并发 = plan.maxConcurrency），
 * 每项独立成败（对齐 assets batch-delete 语义）。
 *
 * **不建批量原子接口**：CONTRACT 固化的幂等/退费模型是「一任务一扣一退」，
 * 单请求建 N 任务会把部分失败/部分退款裁决塞进新事务语义 —— 客户端扇出 = 零新不变式。
 * 复用 auth-mask/auth-card 等既有弹层样式（AuthDialog 同款），不新增 CSS。
 */
import { useEffect, useState } from 'react';
import { api } from '../lib/api';

interface TemplateItem {
  title: string;
  prompt: string;
}

interface Props {
  /** 沿用当前参数面板的规格（面板内不可改，避免与 Inspector 双源） */
  aspectRatio: string;
  resolution: string;
  /** plan.maxConcurrency（me 下发），波次大小 */
  maxConcurrency: number;
  busy: boolean;
  onClose: () => void;
  onRun: (cfg: { prompt: string; n: number; aspectRatio: string; resolution: string }) => void;
}

const N_OPTIONS = [2, 4, 6, 8, 12, 16];

export function BatchPanel({ aspectRatio, resolution, maxConcurrency, busy, onClose, onRun }: Props) {
  const [templates, setTemplates] = useState<TemplateItem[]>([]);
  const [tplIdx, setTplIdx] = useState(0);
  const [n, setN] = useState(4);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const list = await api.templates();
        if (alive && list.length > 0) {
          setTemplates(
            list.map((t) => ({
              title: String(t.titleI18n['zh-CN'] ?? t.titleI18n['en'] ?? t.id),
              prompt: t.prompt,
            })),
          );
        }
      } catch {
        /* 离线：面板显示空态，开始按钮保持禁用 */
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const tpl: TemplateItem | undefined = templates[tplIdx];

  return (
    <div className="auth-mask" onClick={onClose}>
      <div className="auth-card" role="dialog" aria-modal="true" aria-label="批量生成" onClick={(e) => e.stopPropagation()}>
        <div className="auth-tabs">
          <button type="button" className="auth-tab auth-tab--active">
            批量生成
          </button>
          <button type="button" className="auth-close" aria-label="关闭" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="auth-body">
          <p className="rail__hint" style={{ marginBottom: 10 }}>
            模板 × {n} 个任务 · 波次并发 {Math.max(1, maxConcurrency)} · 每项独立扣费/失败
          </p>
          <label className="auth-field">
            <span>模板</span>
            <select
              value={tplIdx}
              onChange={(e) => setTplIdx(Number(e.target.value))}
              disabled={loading || templates.length === 0}
            >
              {loading && <option value={0}>加载中…</option>}
              {!loading && templates.length === 0 && <option value={0}>模板不可用（离线）</option>}
              {templates.map((t, i) => (
                <option key={t.title} value={i}>
                  {t.title}
                </option>
              ))}
            </select>
          </label>
          <label className="auth-field">
            <span>任务数</span>
            <select value={n} onChange={(e) => setN(Number(e.target.value))}>
              {N_OPTIONS.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <p className="rail__hint">
            比例 {aspectRatio} · 画质 {resolution}（沿用当前参数面板）
          </p>
          <button
            type="button"
            className="cta"
            disabled={busy || loading || templates.length === 0 || !tpl}
            onClick={() => {
              if (tpl) onRun({ prompt: tpl.prompt, n, aspectRatio, resolution });
            }}
          >
            {busy ? '提交中…' : `开始批量（${n}）`}
          </button>
        </div>
      </div>
    </div>
  );
}
