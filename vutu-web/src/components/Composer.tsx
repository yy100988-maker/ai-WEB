/**
 * 底部输入区（悬浮 composer）
 * ------------------------------------------------------------------
 * 上排：参考图缩略图组 + 虚线「+」上传位（支持拖拽与粘贴）
 * 中排：多行提示词输入
 * 右下：回形针 / 比例胶囊 / 强调色圆形发送键
 */
import { useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import type { GenParams } from '../App';
import { IconArrowUp, IconPaperclip, IconPlus, IconSparkle, IconX } from './icons';

interface Props {
  prompt: string;
  onPrompt: (v: string) => void;
  references: Array<{ id: string; name: string; url: string }>;
  onReferences: (r: Array<{ id: string; name: string; url: string }>) => void;
  params: GenParams;
  onSubmit: () => void;
  submitting: boolean;
  estCredits: number;
  onNotify: (kind: 'ok' | 'err', text: string) => void;
}

/** 常用提示词模板（真实环境来自 GET /v1/catalog/templates） */
const TEMPLATES = [
  { title: '产品棚拍', prompt: 'a product on a seamless white studio backdrop, soft daylight, studio photo' },
  { title: '人像特写', prompt: 'close-up portrait, 85mm lens, shallow depth of field, natural window light' },
  { title: '场景插画', prompt: 'flat vector illustration, minimal composition, muted palette' },
];

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
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);

  const addFiles = (files: FileList | null) => {
    if (!files?.length) return;
    const next = [...references];
    for (const f of Array.from(files)) {
      if (!f.type.startsWith('image/')) {
        onNotify('err', `${f.name} 不是图片`);
        continue;
      }
      if (next.length >= 10) {
        onNotify('err', '参考图最多 10 张');
        break;
      }
      next.push({ id: `local_${crypto.randomUUID()}`, name: f.name, url: URL.createObjectURL(f) });
    }
    onReferences(next);
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    addFiles(e.dataTransfer.files);
  };

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
      >
        {/* 参考图行 */}
        <div className="composer__refs">
          {references.map((r) => (
            <span key={r.id} className="ref-thumb" title={r.name}>
              <img src={r.url} alt={r.name} />
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
            </span>
            <button
              type="button"
              className="send-btn"
              onClick={onSubmit}
              disabled={submitting || prompt.trim().length === 0}
              aria-label="开始生成"
            >
              {submitting ? <span className="send-btn__spin" /> : <IconArrowUp size={17} />}
            </button>
          </div>
        </div>

        {/* 模板库浮层 */}
        {showTemplates && (
          <div className="templates">
            {TEMPLATES.map((t) => (
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
        支持上传 1–10 张参考图做图生图 / 局部编辑 / 多图融合 · <kbd>Ctrl</kbd>+<kbd>Enter</kbd> 快速生成
      </p>
    </div>
  );
}
