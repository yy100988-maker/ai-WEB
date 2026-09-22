/**
 * 右侧参数面板
 * ------------------------------------------------------------------
 * 分组：画面比例 / 输出质量 / 生成张数 / 随机种子
 * 底部为强调色主 CTA（与 V2 效果图一致）。
 */
import type { CatalogModel, ParamOption, ResolvedModelDetail } from '../lib/api';
import type { GenParams } from '../App';
import { IconDice, IconMinus, IconPlus } from './icons';

interface Props {
  model: CatalogModel | undefined;
  detail: ResolvedModelDetail | null;
  paramOptions: ParamOption[];
  params: GenParams;
  onChange: (p: GenParams) => void;
  estCredits: number;
}

const RATIOS: Array<{ value: string; label: string; box: [number, number] }> = [
  { value: '1:1', label: '1:1', box: [22, 22] },
  { value: '16:9', label: '16:9', box: [28, 16] },
  { value: '9:16', label: '9:16', box: [16, 28] },
  { value: '4:3', label: '4:3', box: [26, 20] },
];

const RESOLUTIONS = ['1K', '2K', '4K'];

export function Inspector({ model, detail, paramOptions, params, onChange, estCredits }: Props) {
  const ratioOptions = readEnum(paramOptions, 'aspectRatio', RATIOS.map((r) => r.value));
  const qualityOptions = readEnum(paramOptions, 'resolution', RESOLUTIONS);
  const countOption = paramOptions.find((p) => p.key === 'count');
  const maxCount = Math.min(countOption?.max ?? 4, 4);

  const set = <K extends keyof GenParams>(key: K, value: GenParams[K]) =>
    onChange({ ...params, [key]: value });

  return (
    <aside className="inspector">
      <div className="inspector__scroll">
        <div className="inspector__head">
          <h2 className="inspector__title">{model?.displayName ?? '参数设置'}</h2>
          <p className="inspector__sub">
            {detail?.capabilityKind === 'image' ? '图像生成' : '生成设置'}
          </p>
        </div>

        {/* ---------------- 画面比例 ---------------- */}
        <section className="field">
          <span className="field__label">画面比例</span>
          <div className="ratio-grid">
            {RATIOS.filter((r) => ratioOptions.includes(r.value)).map((r) => {
              const active = params.aspectRatio === r.value;
              return (
                <button
                  key={r.value}
                  type="button"
                  className={`ratio-chip ${active ? 'ratio-chip--active' : ''}`}
                  aria-pressed={active}
                  onClick={() => set('aspectRatio', r.value)}
                >
                  <span
                    className="ratio-chip__box"
                    style={{ width: r.box[0], height: r.box[1] }}
                    aria-hidden="true"
                  />
                  <span className="ratio-chip__label">{r.label}</span>
                </button>
              );
            })}
          </div>
        </section>

        {/* ---------------- 输出质量 ---------------- */}
        <section className="field">
          <span className="field__label">输出质量</span>
          <div className="segmented">
            {qualityOptions.map((q) => (
              <button
                key={q}
                type="button"
                className={`segmented__item ${params.resolution === q ? 'segmented__item--active' : ''}`}
                aria-pressed={params.resolution === q}
                onClick={() => set('resolution', q)}
              >
                {q}
              </button>
            ))}
          </div>
        </section>

        {/* ---------------- 生成张数 ---------------- */}
        <section className="field">
          <span className="field__label">生成张数</span>
          <div className="stepper">
            <button
              type="button"
              className="stepper__btn"
              onClick={() => set('count', Math.max(1, params.count - 1))}
              disabled={params.count <= 1}
              aria-label="减少张数"
            >
              <IconMinus size={15} />
            </button>
            <span className="stepper__value">{params.count}</span>
            <button
              type="button"
              className="stepper__btn"
              onClick={() => set('count', Math.min(maxCount, params.count + 1))}
              disabled={params.count >= maxCount}
              aria-label="增加张数"
            >
              <IconPlus size={15} />
            </button>
          </div>
        </section>

        {/* ---------------- 随机种子 ---------------- */}
        <section className="field">
          <span className="field__label">随机种子</span>
          <div className="seed">
            <input
              className="seed__input"
              placeholder="留空则随机"
              value={params.seed}
              inputMode="numeric"
              onChange={(e) => set('seed', e.target.value.replace(/[^0-9]/g, ''))}
            />
            <button
              type="button"
              className="seed__dice"
              title="随机一个种子"
              aria-label="随机种子"
              onClick={() => set('seed', String(Math.floor(Math.random() * 1_000_000_000)))}
            >
              <IconDice size={16} />
            </button>
          </div>
          <p className="field__hint">固定种子可复现同一张图</p>
        </section>
      </div>

      {/* ---------------- 底部报价 + CTA ---------------- */}
      <div className="inspector__foot">
        <div className="quote">
          <span className="quote__label">预估消耗</span>
          <span className="quote__value">
            {estCredits.toFixed(2)}
            <span className="quote__unit">积分</span>
          </span>
        </div>
        <button type="button" className="cta" disabled>
          设置已应用到下方输入框
        </button>
      </div>
    </aside>
  );
}

/** 从 params 里读枚举选项；缺失时回退到默认集合 */
function readEnum(options: ParamOption[], key: string, fallback: string[]): string[] {
  const opt = options.find((p) => p.key === key);
  if (!opt?.options?.length) return fallback;
  return opt.options.map((o) => o.value);
}
