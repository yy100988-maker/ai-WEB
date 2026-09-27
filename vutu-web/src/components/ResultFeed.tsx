/**
 * 中间结果流
 * ------------------------------------------------------------------
 * 每张结果卡片采用 V2 的**左右两栏**排布，避免大图旁留白：
 *   左：生成图（1:1，圆角，细边）
 *   右：提示词摘要 + 状态/进度 + 操作按钮组 + 时间戳 + 参数 chip
 */
import type { TaskStatus, TaskSummary } from '../lib/api';
import { IconDownload, IconEdit, IconRefresh, IconSparkle, IconTrash, IconX } from './icons';

interface Props {
  tasks: TaskSummary[];
  onRegenerate: (t: TaskSummary) => void;
  onDelete: (t: TaskSummary) => void;
  onCancel: (t: TaskSummary) => void;
  /** F2 反推提示词（成功才扣积分） */
  onReverse?: (t: TaskSummary) => void;
  /** F4 发布到灵感广场 */
  onPublish?: (t: TaskSummary) => void;
}

const STATUS_TEXT: Record<TaskStatus, string> = {
  queued: '排队中',
  running: '生成中',
  succeeded: '已完成',
  failed: '生成失败',
  cancelled: '已取消',
  timeout: '超时',
};

export function ResultFeed({ tasks, onRegenerate, onDelete, onCancel, onReverse, onPublish }: Props) {
  if (tasks.length === 0) {
    return (
      <div className="feed feed--empty">
        <div className="feed__empty-card">
          <span className="feed__empty-icon" aria-hidden="true">
            <IconSparkle size={22} />
          </span>
          <h2 className="feed__empty-title">开始你的第一次生成</h2>
          <p className="feed__empty-desc">
            在下方输入提示词，选择模型与参数，即可生成图片。支持上传参考图做图生图与局部编辑。
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="feed">
      {tasks.map((t) => (
        <ResultCard
          key={t.id}
          task={t}
          onRegenerate={onRegenerate}
          onDelete={onDelete}
          onCancel={onCancel}
          onReverse={onReverse}
          onPublish={onPublish}
        />
      ))}
      <div className="feed__tail" aria-hidden="true" />
    </div>
  );
}

function ResultCard({
  task,
  onRegenerate,
  onDelete,
  onCancel,
  onReverse,
  onPublish,
}: {
  task: TaskSummary;
  onRegenerate: (t: TaskSummary) => void;
  onDelete: (t: TaskSummary) => void;
  onCancel: (t: TaskSummary) => void;
  /** F2 反推提示词（成功才扣积分） */
  onReverse?: (t: TaskSummary) => void;
  /** F4 发布到灵感广场 */
  onPublish?: (t: TaskSummary) => void;
}) {
  const busy = task.status === 'queued' || task.status === 'running';
  const failed = task.status === 'failed' || task.status === 'timeout';
  const image = task.results?.[0];

  return (
    <article className={`rcard ${busy ? 'rcard--busy' : ''} ${failed ? 'rcard--failed' : ''}`}>
      <div className="rcard__media">
        {image ? (
          <img className="rcard__img" src={image.url} alt={task.prompt ?? '生成结果'} loading="lazy" />
        ) : (
          <div className="rcard__skeleton" role="img" aria-label={STATUS_TEXT[task.status]}>
            {busy ? (
              <>
                <span className="rcard__spinner" aria-hidden="true" />
                <span className="rcard__skeleton-text">
                  {STATUS_TEXT[task.status]} {Math.round(task.progress)}%
                </span>
              </>
            ) : (
              <span className="rcard__skeleton-text">{STATUS_TEXT[task.status]}</span>
            )}
          </div>
        )}

        {busy && image === undefined && (
          <div className="rcard__progress" aria-hidden="true">
            <span className="rcard__progress-bar" style={{ width: `${task.progress}%` }} />
          </div>
        )}
      </div>

      <div className="rcard__side">
        <div className="rcard__head">
          <p className="rcard__prompt" title={task.prompt}>
            {task.prompt ?? '（无提示词）'}
          </p>
          <StatusPill status={task.status} />
        </div>

        <div className="rcard__meta">
          <MetaChip label="模型" value={task.model.displayName} />
          {typeof task.params?.['aspectRatio'] === 'string' && (
            <MetaChip label="比例" value={String(task.params['aspectRatio'])} />
          )}
          {typeof task.params?.['resolution'] === 'string' && (
            <MetaChip label="质量" value={String(task.params['resolution'])} />
          )}
          {typeof task.params?.['count'] === 'number' && (
            <MetaChip label="张数" value={String(task.params['count'])} />
          )}
        </div>

        {failed && task.error && <p className="rcard__error">{task.error.message}</p>}

        <div className="rcard__foot">
          <div className="rcard__actions">
            <button type="button" className="ghost-btn" onClick={() => onRegenerate(task)} title="重新编辑">
              <IconEdit size={15} />
              <span>重新编辑</span>
            </button>
            <button type="button" className="ghost-btn" onClick={() => onRegenerate(task)} title="再次生成">
              <IconRefresh size={15} />
              <span>再次生成</span>
            </button>
            {image && task.status === 'succeeded' && onReverse && (
              <button
                type="button"
                className="ghost-btn"
                onClick={() => onReverse(task)}
                title="从结果图反推提示词（成功才扣积分）"
              >
                <IconRefresh size={15} />
                <span>反推</span>
              </button>
            )}
            {image && task.status === 'succeeded' && onPublish && (
              <button
                type="button"
                className="ghost-btn"
                onClick={() => onPublish(task)}
                title="发布到灵感广场"
              >
                <IconSparkle size={15} />
                <span>发布</span>
              </button>
            )}
            {busy ? (
              <button type="button" className="ghost-btn" onClick={() => onCancel(task)} title="取消">
                <IconX size={15} />
                <span>取消</span>
              </button>
            ) : (
              <button
                type="button"
                className="ghost-btn ghost-btn--danger"
                onClick={() => onDelete(task)}
                title="删除"
              >
                <IconTrash size={15} />
                <span>删除</span>
              </button>
            )}
          </div>

          <div className="rcard__stamp">
            {image && (
              <a className="ghost-btn ghost-btn--icon" href={image.url} download title="下载">
                <IconDownload size={15} />
              </a>
            )}
            <time dateTime={task.createdAt}>{formatTime(task.createdAt)}</time>
          </div>
        </div>
      </div>
    </article>
  );
}

function StatusPill({ status }: { status: TaskStatus }) {
  return <span className={`pill pill--${status}`}>{STATUS_TEXT[status]}</span>;
}

function MetaChip({ label, value }: { label: string; value: string }) {
  return (
    <span className="meta-chip">
      <span className="meta-chip__label">{label}</span>
      <span className="meta-chip__value">{value}</span>
    </span>
  );
}

/** 本地时间「YYYY-MM-DD HH:mm:ss」（对齐参考图的完整时间戳） */
function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
