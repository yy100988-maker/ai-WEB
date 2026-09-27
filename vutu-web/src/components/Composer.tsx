/**
 * 底部输入区（悬浮 composer）
 * ------------------------------------------------------------------
 * 上排：参考图缩略图组 + 虚线「+」上传位（支持拖拽、粘贴、文件选择；
 *       图片选中后立即经 `POST /v1/assets/upload-url` 直传并确认，
 *       拿到后端 assetId 后才可作为图生图输入）
 * 中排：多行提示词输入
 * 右下：模板 / 比例胶囊 / 强调色圆形发送键
 */
import { useEffect, useRef, useState, type ChangeEvent, type ClipboardEvent, type DragEvent } from 'react';
import type { GenParams } from '../App';
import { ApiError, api, uploadImageFile } from '../lib/api';
import { IconArrowUp, IconPaperclip, IconPlus, IconSparkle, IconX } from './icons';

/** 参考图条目：assetId 为后端资产 ID（图生图 inputAssetIds 用它） */
export interface RefImage {
  id: string;
  name: string;
  /** 本地预览 URL（objectURL） */
  url: string;
  assetId?: string;
  status: 'ready' | 'uploading' | 'error';
  error?: string;
}

interface Props {
  prompt: string;
  onPrompt: (v: string) => void;
  references: RefImage[];
  onReferences: (r: RefImage[]) => void;
  params: GenParams;
  onSubmit: () => void;
  submitting: boolean;
  estCredits: number;
  onNotify: (kind: 'ok' | 'err', text: string) => void;
  /** 未登录时触新增参考图：调用方弹登录框 */
  onRequireAuth: () => void;
  /** F1/F2 扣积分成功后刷新余额 */
  onCharged?: () => void;
}

/** 后端模板不可用时的兜底（真实环境来自 GET /v1/catalog/templates） */
const FALLBACK_TEMPLATES = [
  { title: '产品棚拍', prompt: 'a product on a seamless white studio backdrop, soft daylight, studio photo' },
  { title: '人像特写', prompt: 'close-up portrait, 85mm lens, shallow depth of field, natural window light' },
  { title: '场景插画', prompt: 'flat vector illustration, minimal composition, muted palette' },
];

interface TemplateItem {
  title: string;
  prompt: string;
}

export function Composer({
  prompt,
  onPrompt,
  references,
  onReferences,
  params,
  onSubmit,
  submitting,
  estCredits,
  onNotify,
  onRequireAuth,
  onCharged,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [templates, setTemplates] = useState<TemplateItem[]>(FALLBACK_TEMPLATES);
  const refsRef = useRef(references);
  refsRef.current = references;

  // ---------------- F1 优化 / F2 反推（决议 D1：charge-after 扣积分） ----------------
  const [optimizing, setOptimizing] = useState(false);
  const [reversing, setReversing] = useState(false);

  const chargeFailed = (e: unknown): void => {
    if (e instanceof ApiError && e.code === 'UNAUTHORIZED') onRequireAuth();
    else onNotify('err', e instanceof ApiError ? e.message : '请求失败');
    // 扣费/调用失败一律不改写用户原文
  };

  async function doOptimize(): Promise<void> {
    if (optimizing) return;
    const src = prompt.trim();
    if (!src) {
      onNotify('err', '请先输入提示词');
      return;
    }
    setOptimizing(true);
    try {
      const out = await api.optimizePrompt(src);
      onPrompt(out.optimized.slice(0, 2000));
      onNotify('ok', `已优化（消耗 ${out.credits} 积分）`);
      onCharged?.();
    } catch (e) {
      chargeFailed(e);
    } finally {
      setOptimizing(false);
    }
  }

  async function doReverse(): Promise<void> {
    if (reversing) return;
    const ref = references.find((r) => r.status === 'ready' && r.assetId);
    if (!ref?.assetId) {
      onNotify('err', '请先上传参考图');
      return;
    }
    setReversing(true);
    try {
      const out = await api.reversePrompt(ref.assetId);
      onPrompt(out.prompt);
      onNotify('ok', `已提取提示词（消耗 ${out.credits} 积分）`);
      onCharged?.();
    } catch (e) {
      chargeFailed(e);
    } finally {
      setReversing(false);
    }
  }

  // 后端模板库（失败则保留兜底）
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await api.templates();
        if (cancelled || list.length === 0) return;
        setTemplates(
          list.map((t) => ({
            title: String(t.titleI18n['zh-CN'] ?? t.titleI18n['en'] ?? t.id),
            prompt: t.prompt,
          })),
        );
      } catch {
        /* 保留兜底模板 */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const uploadOne = async (entryId: string, file: File) => {
    try {
      const { assetId } = await uploadImageFile(file);
      onReferences(
        refsRef.current.map((r) => (r.id === entryId ? { ...r, assetId, status: 'ready' as const } : r)),
      );
    } catch (e) {
      const unauthorized = e instanceof ApiError && (e.code === 'UNAUTHORIZED' || e.status === 401);
      const msg =
        e instanceof ApiError
          ? unauthorized
            ? '请先登录后再传参考图'
            : e.message
          : '上传失败';
      onReferences(
        refsRef.current.map((r) =>
          r.id === entryId ? { ...r, status: 'error' as const, error: msg } : r,
        ),
      );
      onNotify('err', `${file.name}：${msg}`);
      if (unauthorized) onRequireAuth();
    }
  };

  const addFiles = (files: FileList | File[] | null) => {
    if (!files || files.length === 0) return;
    const arr = Array.from(files);
    const slots = 10 - refsRef.current.length;
    if (slots <= 0) {
      onNotify('err', '参考图最多 10 张');
      return;
    }
    const accepted: File[] = [];
    for (const f of arr.slice(0, slots)) {
      if (!f.type.startsWith('image/')) {
        onNotify('err', `${f.name} 不是图片`);
        continue;
      }
      accepted.push(f);
    }
    if (accepted.length === 0) return;
    const entries: RefImage[] = accepted.map((f) => ({
      id: `local_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      name: f.name,
      url: URL.createObjectURL(f),
      status: 'uploading' as const,
    }));
    onReferences([...refsRef.current, ...entries]);
    // 逐个直传（后端限流 10/min/IP，前端天然串行间隔不足时由后端 429 提示）
    entries.forEach((entry, i) => {
      const file = accepted[i];
      if (file) void uploadOne(entry.id, file);
    });
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    addFiles(e.dataTransfer.files);
  };

  const onPaste = (e: ClipboardEvent<HTMLDivElement>) => {
    const files: File[] = [];
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of Array.from(items)) {
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const f = item.getAsFile();
        if (f) files.push(f);
      }
    }
    if (files.length > 0) {
      e.preventDefault();
      addFiles(files);
    }
  };

  const uploadingCount = references.filter((r) => r.status === 'uploading').length;

  return (
    <div className="composer">
      <div
        className={`composer__card ${dragging ? 'composer__card--drag' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onPaste={onPaste}
      >
        {/* 参考图行 */}
        <div className="composer__refs">
          {references.map((r) => (
            <span
              key={r.id}
              className={`ref-thumb ${r.status === 'uploading' ? 'ref-thumb--uploading' : ''} ${r.status === 'error' ? 'ref-thumb--error' : ''}`}
              title={r.status === 'error' ? (r.error ?? '上传失败，点击移除') : r.name}
            >
              <img src={r.url} alt={r.name} />
              {r.status === 'uploading' && <span className="ref-thumb__spin" aria-label="上传中" />}
              {r.status === 'error' && (
                <span className="ref-thumb__err" aria-hidden="true">
                  !
                </span>
              )}
              <button
                type="button"
                className="ref-thumb__remove"
                aria-label={`移除 ${r.name}`}
                onClick={() => onReferences(references.filter((x) => x.id !== r.id))}
              >
                <IconX size={11} />
              </button>
            </span>
          ))}

          {references.length < 10 && (
            <button
              type="button"
              className="ref-add"
              onClick={() => fileRef.current?.click()}
              title="上传参考图（图生图 / 局部编辑 / 多图融合）"
            >
              <IconPlus size={16} />
            </button>
          )}

          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e: ChangeEvent<HTMLInputElement>) => {
              addFiles(e.target.files);
              e.target.value = '';
            }}
          />
        </div>

        {/* 提示词输入 */}
        <textarea
          className="composer__input"
          placeholder="描述你想生成的画面…（主体 + 场景 + 风格 + 光线 + 氛围）"
          value={prompt}
          rows={3}
          onChange={(e) => onPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              onSubmit();
            }
          }}
        />

        {/* 工具栏 */}
        <div className="composer__bar">
          <div className="composer__bar-left">
            <button
              type="button"
              className="icon-btn icon-btn--sm"
              title="模板库"
              aria-label="模板库"
              onClick={() => setShowTemplates((v) => !v)}
            >
              <IconSparkle size={15} />
            </button>
            <button
              type="button"
              className="icon-btn icon-btn--sm"
              title="以链接导入参考图"
              aria-label="导入链接"
              onClick={() => onNotify('ok', '链接导入：请在素材库中使用')}
            >
              <IconPaperclip size={15} />
            </button>
            <button
              type="button"
              className="ghost-btn"
              title="AI 优化提示词（成功才扣积分）"
              disabled={optimizing || submitting}
              onClick={() => void doOptimize()}
            >
              <IconSparkle size={14} />
              <span>{optimizing ? '优化中…' : 'AI 优化'}</span>
            </button>
            <button
              type="button"
              className="ghost-btn"
              title="从参考图反推提示词（成功才扣积分）"
              disabled={reversing || submitting}
              onClick={() => void doReverse()}
            >
              <span>{reversing ? '提取中…' : '反推'}</span>
            </button>

            <span className="composer__ratio" title="当前比例">
              {params.aspectRatio}
            </span>
            <span className="composer__ratio composer__ratio--muted" title="当前质量">
              {params.resolution}
            </span>
          </div>

          <div className="composer__bar-right">
            <span className="composer__cost">
              {estCredits.toFixed(2)} 积分 · {params.count} 张
              {uploadingCount > 0 && ` · ${uploadingCount} 张上传中`}
            </span>
            <button
              type="button"
              className="send-btn"
              onClick={onSubmit}
              disabled={submitting || prompt.trim().length === 0 || uploadingCount > 0}
              aria-label="开始生成"
            >
              {submitting ? <span className="send-btn__spin" /> : <IconArrowUp size={17} />}
            </button>
          </div>
        </div>

        {/* 模板库浮层 */}
        {showTemplates && (
          <div className="templates">
            {templates.map((t) => (
              <button
                key={t.title}
                type="button"
                className="templates__item"
                onClick={() => {
                  onPrompt(t.prompt);
                  setShowTemplates(false);
                }}
              >
                <span className="templates__title">{t.title}</span>
                <span className="templates__prompt">{t.prompt}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <p className="composer__hint">
        支持上传 / 拖拽 / 粘贴 1–10 张参考图做图生图 / 局部编辑 / 多图融合 ·
        <kbd>Ctrl</kbd>+<kbd>Enter</kbd> 快速生成
      </p>
    </div>
  );
}
