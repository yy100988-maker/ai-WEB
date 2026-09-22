/**
 * 顶部全局栏（56px）
 * ------------------------------------------------------------------
 * 左：品牌标识 + 四个主导航 tab（首个为激活态）
 * 右：素材库 / 画廊 / 设置 三个圆形图标入口 + 余额
 */
import { IconGallery, IconGrid, IconSettings, IconSparkle } from './icons';

const TABS = [
  { key: 'all', label: '全部' },
  { key: 'chat', label: '聊天' },
  { key: 'image', label: '图片' },
  { key: 'video', label: '视频' },
];

interface Props {
  active: string;
  onTab: (key: string) => void;
  credits: number;
  offline: boolean;
  onAssets: () => void;
  onGallery: () => void;
  onSettings: () => void;
}

export function TopBar({
  active,
  onTab,
  credits,
  offline,
  onAssets,
  onGallery,
  onSettings,
}: Props) {
  return (
    <header className="topbar">
      <div className="topbar__brand">
        <span className="topbar__logo" aria-hidden="true">
          <IconSparkle size={17} />
        </span>
        <span className="topbar__name">Vutu</span>
        {offline && (
          <span className="topbar__offline" title="后端不可达，正在展示演示数据">
            离线预览
          </span>
        )}
      </div>

      <nav className="topbar__tabs" aria-label="主导航">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            className={`tab ${active === t.key ? 'tab--active' : ''}`}
            aria-current={active === t.key ? 'page' : undefined}
            onClick={() => onTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <div className="topbar__right">
        <span className="topbar__credits" title="剩余积分">
          <span className="topbar__credits-dot" aria-hidden="true" />
          {credits.toFixed(2)}
        </span>

        <button type="button" className="icon-btn" onClick={onAssets} title="素材库" aria-label="素材库">
          <IconGrid size={17} />
        </button>
        <button type="button" className="icon-btn" onClick={onGallery} title="画廊" aria-label="画廊">
          <IconGallery size={17} />
        </button>
        <button type="button" className="icon-btn" onClick={onSettings} title="设置" aria-label="设置">
          <IconSettings size={17} />
        </button>
      </div>
    </header>
  );
}
