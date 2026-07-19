import { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Brain, Check, Info, Link2, ListTree, Loader2, PanelRightClose, RotateCcw, Send, Star, X } from 'lucide-react';
import { api, post, streamRag, getAiProfile, getPageSuggestions, undoSuggestion } from '../../api';
import { setPendingScroll } from '../../editor/scrollTo';
import type { AiProfile } from '@mindloom/shared';
import { countWords, type PMNode } from '../../editor/prosemirror';
import { extractOutline } from '../notes/outline';
import { EmptyState } from '../../components/EmptyState';
import { SkeletonList } from '../../components/Skeleton';
import { useFavorites } from '../../hooks/useFavorites';
import type { PageDetail, Space, Workspace, WikiSuggestion } from '../../types';

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

        {tab === 'ai' && <AiTab workspace={workspace} space={space} pageId={pageId} onOpenPage={onOpenPage} />}
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

/* --------------------------------------------------------------- AI tab ---- */
type Citation = { title?: string; pageId?: string; chunkId?: string; excerpt?: string };
const SUGG_LABEL: Record<string, string> = {
  topic_proposal: '主题提案', cross_link: '关联建议', stale_topic: '主题待更新'
};
const RISK_LABEL: Record<string, string> = { low: '低风险', medium: '中风险', high: '高风险' };

function renderAnswer(text: string, sources: Citation[], onClick: (c: Citation) => void) {
  const parts = text.split(/(\[\d+\])/g);
  return parts.map((part, i) => {
    const m = part.match(/^\[(\d+)\]$/);
    if (m) {
      const c = sources[Number(m[1]) - 1];
      return (
        <button key={i} className="cite-badge" title={c?.title ?? `引用 ${m[1]}`} onClick={() => c && onClick(c)}>
          {m[1]}
        </button>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

function AiTab({ workspace, space, pageId, onOpenPage }: {
  workspace: Workspace; space: Space; pageId: string; onOpenPage: (id: string) => void;
}) {
  // 摘要 + 标签
  const { data: profData, isLoading: profLoading } = useQuery<{ profile: AiProfile | null }>({
    queryKey: ['ai-profile', pageId], queryFn: () => getAiProfile(pageId)
  });
  const profile = profData?.profile ?? null;

  // 相关页面（复用图谱 around-page）
  const { data: relData } = useQuery<{ nodes: GNode[]; edges: GEdge[] }>({
    queryKey: ['related', pageId], queryFn: () => api(`/api/graph/around-page/${pageId}`)
  });
  const related = useMemo(() => {
    const data = relData;
    if (!data) return [] as GNode[];
    const connected = new Set<string>();
    for (const e of data.edges) {
      if (e.source === pageId) connected.add(e.target);
      if (e.target === pageId) connected.add(e.source);
    }
    return data.nodes.filter((n) => n.id !== pageId && connected.has(n.id));
  }, [relData, pageId]);

  // 主题建议（本页）
  const { data: suggData, refetch: refetchSugg } = useQuery<{ suggestions: WikiSuggestion[] }>({
    queryKey: ['page-suggestions', pageId], queryFn: () => getPageSuggestions(pageId)
  });
  const suggestions = suggData?.suggestions ?? [];
  const [recentlyAccepted, setRecentlyAccepted] = useState<{ id: string; label: string }[]>([]);

  const accept = useMutation({
    mutationFn: (id: string) => post(`/api/llm-wiki/suggestions/${id}/accept`, {}),
    onSuccess: (_r, id) => {
      refetchSugg();
      const s = suggestions.find((x) => x.id === id);
      const label = s ? (SUGG_LABEL[s.type] ?? s.type) : '建议';
      setRecentlyAccepted((p) => [...p, { id, label }]);
    }
  });
  const ignore = useMutation({
    mutationFn: (id: string) => post(`/api/llm-wiki/suggestions/${id}/ignore`, {}),
    onSuccess: () => refetchSugg()
  });
  const undo = useMutation({
    mutationFn: (id: string) => undoSuggestion(id),
    onSuccess: (_r, id) => {
      setRecentlyAccepted((p) => p.filter((x) => x.id !== id));
      refetchSugg();
    }
  });

  // 问当前页面（流式 SSE）
  const [q, setQ] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [sources, setSources] = useState<Citation[]>([]);
  const [answer, setAnswer] = useState('');
  const [streamErr, setStreamErr] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const openChunk = (c: Citation) => {
    if (!c.pageId) return;
    if (c.excerpt) setPendingScroll(c.excerpt);
    onOpenPage(c.pageId);
  };

  const ask = () => {
    if (!q.trim() || streaming) return;
    setStreaming(true); setSources([]); setAnswer(''); setStreamErr(null);
    const ac = new AbortController();
    abortRef.current = ac;
    streamRag(
      { workspaceId: workspace.id, spaceId: space.id, query: q, pageId },
      (ev) => {
        if (ev.type === 'sources') setSources(ev.citations as Citation[]);
        else if (ev.type === 'token') setAnswer((a) => a + ev.text);
        else if (ev.type === 'error') { setStreamErr(ev.message); setStreaming(false); }
        else if (ev.type === 'done') setStreaming(false);
      },
      ac.signal
    ).catch(() => setStreaming(false));
  };

  return (
    <div className="rp-ai">
      {/* 摘要 + 标签 */}
      <section className="rp-section">
        <h4 className="rp-section-title">摘要</h4>
        {profLoading && <div className="muted small">生成中…</div>}
        {!profLoading && !profile?.summary && <p className="muted small">保存或整理后，AI 会在此生成本页摘要。</p>}
        {profile?.summary && <p className="rp-ai-summary">{profile.summary}</p>}
        {profile && profile.tags.length > 0 && (
          <div className="rp-tags">
            {profile.tags.map((t) => <span key={t} className="tag-chip">{t}</span>)}
          </div>
        )}
      </section>

      {/* 相关页面 */}
      <section className="rp-section">
        <h4 className="rp-section-title">相关页面</h4>
        {related.length === 0
          ? <p className="muted small">当本页与其他笔记产生联系时会显示在这里。</p>
          : (
            <div className="rp-related">
              {related.map((n) => (
                <button key={n.id} className="rp-related-item" onClick={() => n.type === 'page' && onOpenPage(n.id)}>
                  <span className={`rp-related-kind ${n.type}`}>{n.type === 'page' ? '笔记' : '主题'}</span>
                  <span className="rp-related-title">{n.label}</span>
                </button>
              ))}
            </div>
          )}
      </section>

      {/* 主题建议 */}
      <section className="rp-section">
        <h4 className="rp-section-title">主题建议</h4>
        {suggestions.length === 0 && recentlyAccepted.length === 0 && (
          <p className="muted small">AI 整理本页后，会在此给出可审阅的主题与关联建议。</p>
        )}
        {suggestions.map((s) => {
          const p = s.payload as { topicTitle?: string; targetPageTitle?: string; changes?: string; reason?: string };
          const title = s.type === 'topic_proposal' ? `提议新主题：${p.topicTitle ?? '未命名'}`
            : s.type === 'cross_link' ? `关联笔记：${p.targetPageTitle ?? '相关页面'}`
            : s.type === 'stale_topic' ? `主题待更新：${p.topicTitle ?? '某主题'}` : s.type;
          return (
            <div className="rp-sugg" key={s.id}>
              <div className="rp-sugg-head">
                <span className="tag">{SUGG_LABEL[s.type] ?? s.type}</span>
                <span className={`risk risk-${s.risk}`}>{RISK_LABEL[s.risk] ?? s.risk}</span>
                <b>{title}</b>
              </div>
              {p.changes && <p className="rp-sugg-changes">将改变：{p.changes}</p>}
              {p.reason && <p className="muted small">原因：{p.reason}</p>}
              <div className="rp-sugg-actions">
                <button className="ghost ok sm" disabled={accept.isPending} onClick={() => accept.mutate(s.id)}><Check size={13} /> 接受</button>
                <button className="ghost danger sm" disabled={ignore.isPending} onClick={() => ignore.mutate(s.id)}><X size={13} /> 忽略</button>
              </div>
            </div>
          );
        })}
        {recentlyAccepted.map((a) => (
          <div className="rp-sugg accepted" key={a.id}>
            <span className="muted small">已接受：{a.label}</span>
            <button className="ghost sm" disabled={undo.isPending} onClick={() => undo.mutate(a.id)}><RotateCcw size={13} /> 撤销</button>
          </div>
        ))}
      </section>

      {/* 问当前页面 */}
      <section className="rp-section">
        <h4 className="rp-section-title">问当前页面</h4>
        <p className="muted small">仅基于本篇笔记回答，并标注引用来源。</p>
        <div className="rp-ai-box">
          <input value={q} placeholder="问这篇笔记…" onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && q.trim()) ask(); }} />
          <button className="icon-btn" disabled={!q.trim() || streaming} onClick={ask}>
            {streaming ? <Loader2 className="spin" size={15} /> : <Send size={15} />}
          </button>
        </div>
        {streamErr && <p className="error">{streamErr}</p>}
        {(sources.length > 0 || answer) && (
          <div className="rp-ai-answer">
            {sources.length > 0 && (
              <div className="rp-ai-cites">
                <span className="muted small">来源（先出现，可点击跳转）</span>
                <div className="cite-list">
                  {sources.map((c, i) => (
                    <button key={c.chunkId ?? i} className="src-chip" title={c.excerpt} onClick={() => openChunk(c)}>
                      <Link2 size={12} /> <span className="cite-idx">[{i + 1}]</span> {c.title || '来源'}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {answer && <p className="answer-text">{renderAnswer(answer, sources, openChunk)}</p>}
            {streaming && <span className="stream-cursor" />}
          </div>
        )}
      </section>
    </div>
  );
}
