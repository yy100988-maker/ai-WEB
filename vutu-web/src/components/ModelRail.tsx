/**
 * 左侧模型选择栏
 * ------------------------------------------------------------------
 * 搜索框 + 模型卡片列表。每张卡片：图标色块 + 展示名 + 副标题 + 百分比容量 + 可选 NEW 角标。
 * 激活项带 teal 淡底与左侧色条。
 */
import { useMemo, useState } from 'react';
import type { CatalogModel } from '../lib/api';
import { ApiError, api } from '../lib/api';
import { IconSearch } from './icons';

interface Props {
  models: CatalogModel[];
  selectedId: string;
  onSelect: (id: string) => void;
  loading: boolean;
  query: string;
  onQuery: (q: string) => void;
  credits: number | null;
  /** F3 兑换成功 → 上游刷新余额 */
  onRedeemed?: () => void;
}

/** 稳定派生：按模型 id 生成一套柔和的图标底色（与 V2 效果图的多彩小块一致） */
const SWATCHES = ['#eef2ff', '#fdf2f8', '#ecfdf5', '#fff7ed', '#f5f3ff', '#eff6ff', '#fef2f2'];

export function ModelRail({
  models,
  selectedId,
  onSelect,
  loading,
  query,
  onQuery,
  credits,
  onRedeemed,
}: Props) {
  const [redeemInput, setRedeemInput] = useState('');
  const [redeemBusy, setRedeemBusy] = useState(false);
  const [redeemMsg, setRedeemMsg] = useState<string | null>(null);

  const doRedeem = async (): Promise<void> => {
    const code = redeemInput.trim();
    if (!code || redeemBusy) return;
    setRedeemBusy(true);
    setRedeemMsg(null);
    try {
      const out = await api.redeemKey(code);
      setRedeemInput('');
      setRedeemMsg(`兑换成功 +${out.credits}`);
      onRedeemed?.();
    } catch (e) {
      setRedeemMsg(
        e instanceof ApiError ? (e.code === 'NOT_FOUND' ? '兑换码不存在' : e.message) : '兑换失败',
      );
    } finally {
      setRedeemBusy(false);
      window.setTimeout(() => setRedeemMsg(null), 4000);
    }
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return models;
    return models.filter((m) => m.displayName.toLowerCase().includes(q));
  }, [models, query]);

  return (
    <aside className="rail">
      <div className="rail__search">
        <IconSearch size={15} className="rail__search-icon" />
        <input
          type="search"
          className="rail__search-input"
          placeholder="搜索模型或功能…"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          aria-label="搜索模型"
        />
      </div>

      <div className="rail__list" role="listbox" aria-label="模型列表">
        {loading && <div className="rail__hint">正在加载模型…</div>}

        {!loading && filtered.length === 0 && <div className="rail__hint">没有匹配的模型</div>}

        {filtered.map((m, i) => {
          const isActive = m.id === selectedId;
          const isNew = (m.qualityScore ?? 0) >= 94 && i < 2;
          const capacity = 100;

          return (
            <button
              key={m.id}
              type="button"
              role="option"
              aria-selected={isActive}
              className={`model-card ${isActive ? 'model-card--active' : ''}`}
              onClick={() => onSelect(m.id)}
            >
              <span
                className="model-card__icon"
                style={{ background: SWATCHES[i % SWATCHES.length] }}
                aria-hidden="true"
              >
                <ModelGlyph index={i} />
              </span>

              <span className="model-card__body">
                <span className="model-card__title">
                  {isNew && <span className="model-card__new">NEW</span>}
                  <span className="model-card__name">{m.displayName}</span>
                </span>
                <span className="model-card__desc">{describe(m)}</span>
              </span>

              <span className="model-card__cap">{capacity}%</span>
            </button>
          );
        })}
      </div>
      <div className="rail__footer">
        <span className="rail__balance">
          <span className="rail__balance-label">余额</span>
          <span className="rail__balance-value">
            {credits === null ? '未登录' : credits.toFixed(2)}
          </span>
        </span>
        {credits !== null && (
          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            <input
              type="text"
              className="rail__search-input"
              placeholder="兑换码"
              value={redeemInput}
              onChange={(e) => setRedeemInput(e.target.value)}
              aria-label="兑换码"
            />
            <button
              type="button"
              className="ghost-btn"
              disabled={redeemBusy || redeemInput.trim().length === 0}
              onClick={() => void doRedeem()}
            >
              <span>{redeemBusy ? '…' : '兑换'}</span>
            </button>
          </div>
        )}
        {redeemMsg && (
          <p className="rail__hint" style={{ marginTop: 6 }}>
            {redeemMsg}
          </p>
        )}
      </div>
    </aside>
  );
}

/** 简短的模型说明（真实列表无描述字段，由参数能力派生） */
function describe(m: CatalogModel): string {
  const res = m.resolutions?.filter((r) => r !== 'auto').length ?? 0;
  const ratios = m.aspectRatios?.filter((r) => r !== 'auto').length ?? 0;
  const parts: string[] = [];
  if (res) parts.push(`${res} 档画质`);
  if (ratios) parts.push(`${ratios} 种比例`);
  if (m.features?.includes('hd')) parts.push('HD');
  return parts.length ? parts.join(' · ') : '图像生成';
}

/** 极简几何字形图标（避免依赖外部图标字体） */
function ModelGlyph({ index }: { index: number }) {
  const n = index % 4;
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      {n === 0 && (
        <>
          <path d="M12 3 21 12l-9 9-9-9Z" stroke="#7c8cf8" strokeWidth="1.6" strokeLinejoin="round" />
          <circle cx="12" cy="12" r="2.4" fill="#7c8cf8" />
        </>
      )}
      {n === 1 && (
        <>
          <path
            d="M12 3c3 3.2 5 6 5 8.6A5 5 0 0 1 7 11.6C7 9 9 6.2 12 3Z"
            stroke="#3fb98a"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
          <path d="M12 21v-6" stroke="#3fb98a" strokeWidth="1.6" strokeLinecap="round" />
        </>
      )}
      {n === 2 && (
        <>
          <circle cx="12" cy="12" r="8" stroke="#4a9ee8" strokeWidth="1.6" />
          <circle cx="12" cy="12" r="3" fill="#4a9ee8" />
        </>
      )}
      {n === 3 && (
        <>
          <path
            d="M12 3.5 14.6 9l6 .9-4.3 4.2 1 6-5.3-2.8L6.7 20l1-6L3.4 9.9 9.4 9Z"
            stroke="#e8a33d"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
        </>
      )}
    </svg>
  );
}
