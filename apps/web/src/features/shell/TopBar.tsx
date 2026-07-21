import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Check, ChevronRight, Download, Loader2, MoreHorizontal,
  Printer, Search, Share2, Trash2, Upload
} from 'lucide-react';
import { useEditorStatus } from './editorStatus';
import { SaveIndicator } from './SaveIndicator';
import { urls } from '../../nav';
import type { MainRoute, Space, Workspace } from '../../types';

const ROUTE_LABEL: Record<MainRoute, string> = {
  home: '首页', page: '', organize: '智能整理', search: '搜索', ask: '知识问答', map: '关系图'
};

export function TopBar({ workspace, space, route, pageId, pageTitle, onOpenPalette }: {
  workspace: Workspace | null;
  space: Space | null;
  route: MainRoute;
  pageId: string | null;
  pageTitle?: string | null;
  onOpenPalette: () => void;
}) {
  const navigate = useNavigate();
  const { status } = useEditorStatus();
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!moreOpen) return;
    const onClick = (e: MouseEvent) => {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) setMoreOpen(false);
    };
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, [moreOpen]);

  const goSpaceHome = () => {
    if (workspace && space) navigate(urls.spaceHome(workspace.id, space.id));
    else navigate(urls.home());
  };

  const crumbTail = route === 'page' ? (pageTitle || status.pageTitle || '未命名笔记') : ROUTE_LABEL[route];

  return (
    <header className="topbar">
      <div className="crumbs">
        {/* Workspace — clickable */}
        <button className="crumb-link" onClick={goSpaceHome}>{workspace?.name ?? '知识库'}</button>

        {/* Space — clickable */}
        {space && (
          <>
            <ChevronRight size={13} className="crumb-sep" />
            <button className="crumb-link" onClick={goSpaceHome}>{space.name}</button>
          </>
        )}

        {/* Page (or route) — clickable when on a page */}
        {crumbTail && (
          <>
            <ChevronRight size={13} className="crumb-sep" />
            {route === 'page' && pageId ? (
              <button className="crumb-link crumb-current" onClick={() => navigate(urls.page(pageId))}>
                {crumbTail}
              </button>
            ) : (
              <span className="crumb-current">{crumbTail}</span>
            )}
          </>
        )}
      </div>

      <button className="palette-trigger" onClick={onOpenPalette}>
        <Search size={15} />
        <span>搜索笔记或执行命令</span>
        <kbd>⌘K</kbd>
      </button>

      <div className="topbar-actions">
        {status.hasPage && <SaveIndicator state={status.saveState} />}
        {status.hasPage && status.onSave && (
          <button className="primary sm" disabled={status.saveState === 'saved' || status.saveState === 'saving'} onClick={status.onSave}>
            {status.saveState === 'saving' ? <Loader2 className="spin" size={14} /> : <Check size={14} />} 保存
          </button>
        )}
        {status.hasPage && status.onShare && (
          <button className="ghost sm" title="分享" onClick={status.onShare}><Share2 size={15} /> 分享</button>
        )}
        {status.hasPage && (
          <div className="more-menu" ref={moreRef}>
            <button className="icon-btn" title="更多" onClick={() => setMoreOpen((o) => !o)}><MoreHorizontal size={17} /></button>
            {moreOpen && (
              <div className="more-pop">
                <button className="more-item" onClick={() => { setMoreOpen(false); status.onExport?.(); }}><Download size={14} /> 导出 Markdown</button>
                <button className="more-item" onClick={() => { setMoreOpen(false); status.onImport?.(); }}><Upload size={14} /> 导入 Markdown</button>
                <button className="more-item" onClick={() => { setMoreOpen(false); status.onPrint?.(); }}><Printer size={14} /> 打印 / 导出 PDF</button>
                <div className="more-sep" />
                <button className="more-item danger" onClick={() => { setMoreOpen(false); status.onDelete?.(); }}><Trash2 size={14} /> 删除笔记</button>
              </div>
            )}
          </div>
        )}
      </div>
    </header>
  );
}
