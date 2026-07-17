import { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Brain, Info, Link2, ListTree, Loader2, PanelRightClose, Send, Star } from 'lucide-react';
import { api, post } from '../../api';
import { countWords, type PMNode } from '../../editor/prosemirror';
import { extractOutline } from '../notes/outline';
import { EmptyState } from '../../components/EmptyState';
import { SkeletonList } from '../../components/Skeleton';
import { useFavorites } from '../../hooks/useFavorites';
import type { PageDetail, Space, Workspace } from '../../types';

type Tab = 'outline' | 'related' | 'info' | 'ai';

const STATUS_LABEL: Record<string, string> = {
  pending: '待整理', processing: '整理中', done: '已整理', processed: '已整理',
  failed: '整理失败', skipped: '已跳过', ignored: '未开启整理'
};

function scrollToHeading(index: number) {
  const nodes = document.querySelectorAll('.editor-content h1, .editor-content h2, .editor-content h3, .editor-content h4, .editor-content h5, .editor-content h6');
  const el = nodes[index] as HTMLElement | undefined;
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

export function RightPanel({ workspace, space, pageId, onOpenPage, onClose }: {
  workspace: Workspace;
  space: Space;
  pageId: string;
  onOpenPage: (id: string) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>('outline');
  const { isFavorite, toggle } = useFavorites();

  const { data } = useQuery<{ page: PageDetail }>({
    queryKey: ['page-detail', pageId],
    staleTime: 0,
    queryFn: () => api(`/api/pages/${pageId}`)
  });
  const page = data?.page ?? null;

  const outline = useMemo(() => extractOutline(page?.contentJson as PMNode | undefined), [page?.contentJson]);
  const words = useMemo(() => countWords(page?.textContent ?? ''), [page?.textContent]);

  const TABS: { key: Tab; label: string; icon: React.ReactNode }[] = [
    { key: 'outline', label: '大纲', icon: <ListTree size={15} /> },
    { key: 'related', label: '关联', icon: <Link2 size={15} /> },
    { key: 'info', label: '信息', icon: <Info size={15} /> },
    { key: 'ai', label: 'AI 助手', icon: <Brain size={15} /> }
  ];

  return (
    <aside className="right-panel">
      <div className="rp-tabs">
        {TABS.map((t) => (
          <button key={t.key} className={`rp-tab${tab === t.key ? ' active' : ''}`} title={t.label} onClick={() => setTab(t.key)}>
            {t.icon}
          </button>
        ))}
        <div className="spacer" />
        <button className="icon-btn" title="收起面板" onClick={onClose}><PanelRightClose size={16} /></button>
      </div>

      <div className="rp-body">
        {tab === 'outline' && (
          outline.length === 0
            ? <EmptyState icon={<ListTree size={28} />} title="暂无大纲" hint="在正文中添加标题，这里会自动生成目录。" />
            : (
              <div className="rp-outline">
                {outline.map((h) => (
                  <button key={h.id} className={`rp-outline-item lvl-${h.level}`} onClick={() => scrollToHeading(h.index)}>
                    {h.text}
                  </button>
                ))}
              </div>
            )
        )}

        {tab === 'related' && <RelatedTab pageId={pageId} onOpenPage={onOpenPage} />}

        {tab === 'info' && page && (
          <div className="rp-info">
            <div className="rp-info-row"><span>字数</span><b>{words}</b></div>
            <div className="rp-info-row"><span>版本</span><b>v{page.contentVersion}</b></div>
            <div className="rp-info-row"><span>整理状态</span><b>{STATUS_LABEL[page.llmProcessStatus] ?? page.llmProcessStatus}</b></div>
            {page.updatedAt && <div className="rp-info-row"><span>更新时间</span><b>{new Date(page.updatedAt).toLocaleString()}</b></div>}
            <button
              className={`rp-fav${isFavorite(page.id) ? ' on' : ''}`}
              onClick={() => toggle(page.id)}
            >
              <Star size={15} fill={isFavorite(page.id) ? 'currentColor' : 'none'} />
              {isFavorite(page.id) ? '已收藏' : '收藏这篇笔记'}
            </button>
          </div>
        )}

        {tab === 'ai' && <AiTab workspace={workspace} space={space} onOpenPage={onOpenPage} />}
      </div>
    </aside>
  );
}

/* ------------------------------------------------ related (relationships) --- */
type GNode = { id: string; type: 'page' | 'topic'; label: string };
type GEdge = { id: string; source: string; target: string };

function RelatedTab({ pageId, onOpenPage }: { pageId: string; onOpenPage: (id: string) => void }) {
  const { data, isLoading, isError } = useQuery<{ nodes: GNode[]; edges: GEdge[] }>({
    queryKey: ['related', pageId],
    queryFn: () => api(`/api/graph/around-page/${pageId}`)
  });

  const related = useMemo(() => {
    if (!data) return [] as GNode[];
    const connected = new Set<string>();
    for (const e of data.edges) {
      if (e.source === pageId) connected.add(e.target);
      if (e.target === pageId) connected.add(e.source);
    }
    return data.nodes.filter((n) => n.id !== pageId && connected.has(n.id));
  }, [data, pageId]);

  if (isLoading) return <SkeletonList rows={4} />;
  if (isError || related.length === 0) {
    return <EmptyState icon={<Link2 size={28} />} title="暂无关联" hint="当这篇笔记与其他内容产生联系时，会显示在这里。" />;
  }
  return (
    <div className="rp-related">
      {related.map((n) => (
        <button key={n.id} className="rp-related-item" onClick={() => n.type === 'page' && onOpenPage(n.id)}>
          <span className={`rp-related-kind ${n.type}`}>{n.type === 'page' ? '笔记' : '主题'}</span>
          <span className="rp-related-title">{n.label}</span>
        </button>
      ))}
    </div>
  );
}

/* --------------------------------------------------------------- AI helper --- */
type Citation = { title?: string; pageId?: string };

function AiTab({ workspace, space, onOpenPage }: { workspace: Workspace; space: Space; onOpenPage: (id: string) => void }) {
  const [q, setQ] = useState('');
  const ask = useMutation({
    mutationFn: () => post<{ answer: string; citations: Citation[] }>('/api/rag/ask', {
      workspaceId: workspace.id, spaceId: space.id, query: q, limit: 5
    })
  });
  return (
    <div className="rp-ai">
      <p className="muted small">向 AI 提问，回答会基于「{space.name}」中的笔记，并附上来源。</p>
      <div className="rp-ai-box">
        <input value={q} placeholder="问这个空间…" onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && q.trim()) ask.mutate(); }} />
        <button className="icon-btn" disabled={!q.trim() || ask.isPending} onClick={() => ask.mutate()}>
          {ask.isPending ? <Loader2 className="spin" size={15} /> : <Send size={15} />}
        </button>
      </div>
      {ask.error && <p className="error">{(ask.error as Error).message}</p>}
      {ask.data && (
        <div className="rp-ai-answer">
          <p>{ask.data.answer}</p>
          {ask.data.citations?.length > 0 && (
            <div className="rp-ai-cites">
              <span className="muted small">来源</span>
              {ask.data.citations.map((c, i) => (
                <button key={i} className="src-chip" onClick={() => c.pageId && onOpenPage(c.pageId)}>
                  <Link2 size={12} /> {c.title || '来源'}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
