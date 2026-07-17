import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Brain, Check, Layers, Link2, Network, Pause, Play, Plus, RefreshCw, X, Zap } from 'lucide-react';
import { api, post } from '../../api';
import { useAdaptivePolling } from '../../hooks/useAdaptivePolling';
import { EmptyState } from '../../components/EmptyState';
import type { Space } from '../../types';

type WikiTopic = {
  id: string; title: string; status: string; source: string;
  aiSummary: string; textContent?: string; createdAt?: string;
};
type WikiSuggestion = {
  id: string; type: string; risk: string; status: string;
  payload: Record<string, unknown>; evidence: Record<string, unknown>;
  pageId?: string | null; topicId?: string | null; createdAt?: string;
};

const SUGGESTION_TYPE_LABEL: Record<string, string> = {
  topic_proposal: '主题提案', cross_link: '关联建议', link_suggestion: '关联建议',
  outdated_topic: '主题待更新', stale_topic: '主题待更新'
};
const RISK_LABEL: Record<string, string> = { low: '低风险', medium: '中风险', high: '高风险' };
const TOPIC_STATUS_LABEL: Record<string, string> = {
  suggested: '待审阅', accepted: '已采纳', user_edited: '已编辑', stale: '待更新', archived: '已归档'
};

function suggestionSummary(s: WikiSuggestion): { title: string; desc: string } {
  if (s.type === 'topic_proposal') {
    const p = s.payload as { topicTitle?: string; topicSummary?: string };
    return { title: `提议新主题：${p.topicTitle ?? '未命名'}`, desc: p.topicSummary || 'AI 从笔记中提炼出的候选主题，审阅后可纳入知识库。' };
  }
  if (s.type === 'cross_link' || s.type === 'link_suggestion') {
    const p = s.payload as { targetPageTitle?: string; reason?: string };
    return { title: `关联笔记：${p.targetPageTitle ?? '相关页面'}`, desc: p.reason || '内容主题高度相关，建议建立双向链接。' };
  }
  if (s.type === 'outdated_topic' || s.type === 'stale_topic') {
    const p = s.payload as { topicTitle?: string };
    return { title: `主题待更新：${p.topicTitle ?? '某主题'}`, desc: '源笔记有改动，建议重新生成该主题内容。' };
  }
  return { title: s.type, desc: '' };
}

export function WikiView({ space, onOpenPage }: { space: Space; onOpenPage: (id: string) => void }) {
  const qc = useQueryClient();
  const [tab, setTab] = useState<'inbox' | 'suggestions' | 'topics'>('inbox');

  // Adaptive polling (Phase 2): faster when there is activity, off when hidden.
  // `hasActivity` is derived from the list data via an effect below, so the hook
  // can be declared before the queries that bind `refetchInterval: poll`.
  const [hasActivity, setHasActivity] = useState(false);
  const poll = useAdaptivePolling({ enabled: !!space, hasActivity });

  const { data: inboxData, isLoading: inboxLoading } = useQuery<{ inbox: { id: string; title: string; llmProcessStatus: string }[] }>({
    queryKey: ['inbox', space.id], queryFn: () => api(`/api/llm-wiki/inbox?spaceId=${space.id}`), refetchInterval: poll
  });
  const inbox = inboxData?.inbox ?? [];

  const { data: spaceData } = useQuery<{ space: Space & { autoLlmProcessing: boolean } }>({
    queryKey: ['wiki-space', space.id], queryFn: () => api(`/api/spaces/${space.id}`)
  });
  const autoOn = spaceData?.space?.autoLlmProcessing ?? true;

  const { data: suggData } = useQuery<{ suggestions: WikiSuggestion[] }>({
    queryKey: ['suggestions', space.id], queryFn: () => api(`/api/llm-wiki/suggestions?spaceId=${space.id}`), refetchInterval: poll
  });
  const suggestions = suggData?.suggestions ?? [];

  const { data: topicData } = useQuery<{ topics: WikiTopic[] }>({
    queryKey: ['topics', space.id], queryFn: () => api(`/api/llm-wiki/topics?spaceId=${space.id}`), refetchInterval: poll
  });
  const topics = topicData?.topics ?? [];

  useEffect(() => {
    setHasActivity(inbox.length > 0 || suggestions.length > 0 || topics.length > 0);
  }, [inbox, suggestions, topics]);

  const processNow = useMutation({
    mutationFn: (pageId: string) => post(`/api/llm-wiki/pages/${pageId}/process-now`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['inbox', space.id] })
  });
  const toggleAuto = useMutation({
    mutationFn: () => post(`/api/llm-wiki/spaces/${space.id}/${autoOn ? 'pause' : 'resume'}`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['wiki-space', space.id] })
  });
  const reprocess = useMutation({
    mutationFn: () => post(`/api/llm-wiki/spaces/${space.id}/reprocess`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inbox', space.id] });
      qc.invalidateQueries({ queryKey: ['suggestions', space.id] });
      qc.invalidateQueries({ queryKey: ['topics', space.id] });
    }
  });

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const toggleSel = (id: string) =>
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const accept = useMutation({
    mutationFn: (id: string) => post(`/api/llm-wiki/suggestions/${id}/accept`, {}),
    onSuccess: () => { setSelected(new Set()); qc.invalidateQueries({ queryKey: ['suggestions', space.id] }); }
  });
  const ignore = useMutation({
    mutationFn: (id: string) => post(`/api/llm-wiki/suggestions/${id}/ignore`, {}),
    onSuccess: () => { setSelected(new Set()); qc.invalidateQueries({ queryKey: ['suggestions', space.id] }); }
  });
  const bulkAccept = useMutation({
    mutationFn: (ids: string[]) => post(`/api/llm-wiki/suggestions/bulk-accept`, { spaceId: space.id, ids }),
    onSuccess: () => { setSelected(new Set()); qc.invalidateQueries({ queryKey: ['suggestions', space.id] }); }
  });

  const [activeTopic, setActiveTopic] = useState<WikiTopic | null>(null);
  const { data: topicSources } = useQuery<{ sources: { id: string; title: string }[] }>({
    queryKey: ['topic-sources', activeTopic?.id], enabled: !!activeTopic,
    queryFn: () => api(`/api/llm-wiki/topics/${activeTopic!.id}/sources`)
  });
  const acceptTopic = useMutation({
    mutationFn: (id: string) => post(`/api/llm-wiki/topics/${id}/accept`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['topics', space.id] });
      if (activeTopic) setActiveTopic({ ...activeTopic, status: 'accepted' });
    }
  });
  const refreshTopic = useMutation({
    mutationFn: (id: string) => post(`/api/llm-wiki/topics/${id}/refresh-suggestions`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['suggestions', space.id] })
  });
  const [newTitle, setNewTitle] = useState('');
  const createTopic = useMutation({
    mutationFn: () => post<{ topic: WikiTopic }>(`/api/llm-wiki/topics`, {
      workspaceId: space.workspaceId, spaceId: space.id, title: newTitle || '新主题',
      contentJson: { type: 'doc', content: [] }, aiSummary: ''
    }),
    onSuccess: async (r) => { setNewTitle(''); await qc.invalidateQueries({ queryKey: ['topics', space.id] }); setActiveTopic(r.topic); }
  });

  const TABS: { key: typeof tab; label: string; icon: React.ReactNode; count: number }[] = [
    { key: 'inbox', label: 'Inbox', icon: <Layers size={16} />, count: inbox.length },
    { key: 'suggestions', label: '建议', icon: <Brain size={16} />, count: suggestions.length },
    { key: 'topics', label: 'Topic Center', icon: <Network size={16} />, count: topics.length }
  ];

  return (
    <div className="wiki-view">
      <div className="wiki-tabs">
        {TABS.map((t) => (
          <button key={t.key} className={`wiki-tab${tab === t.key ? ' active' : ''}`} onClick={() => setTab(t.key)}>
            {t.icon}<span>{t.label}</span>{t.count > 0 && <span className="tab-count">{t.count}</span>}
          </button>
        ))}
        <div className="wiki-tabs-right">
          <button className="chip" onClick={() => reprocess.mutate()} title="重新处理本 Space 全部笔记并生成 Wiki 产物" disabled={reprocess.isPending}>
            <RefreshCw size={13} /> 重新生成
          </button>
          <button className={`chip${autoOn ? ' on' : ''}`} onClick={() => toggleAuto.mutate()} title="切换自动处理">
            {autoOn ? <><Play size={13} /> 自动处理中</> : <><Pause size={13} /> 已暂停</>}
          </button>
        </div>
      </div>

      {tab === 'inbox' && (
        <div className="wiki-pane">
          {inboxLoading && <div className="muted small">加载中…</div>}
          {!inboxLoading && inbox.length === 0 && (
            <EmptyState icon={<Layers size={36} />} title="收件箱为空" hint="新建或编辑笔记后会自动进入 LLM 处理队列，处理完成后将生成主题与建议。" />
          )}
          {inbox.map((p) => (
            <div className="wiki-row" key={p.id}>
              <div className="wiki-row-main">
                <b>{p.title || '未命名笔记'}</b>
                <span className="muted small">{p.llmProcessStatus}</span>
              </div>
              <div className="wiki-row-actions">
                <button className="ghost" onClick={() => onOpenPage(p.id)}>打开</button>
                <button className="ghost" disabled={processNow.isPending} onClick={() => processNow.mutate(p.id)}><Zap size={14} /> 立即处理</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'suggestions' && (
        <div className="wiki-pane">
          <div className="batch-bar">
            <label className="check-all">
              <input type="checkbox" checked={selected.size === suggestions.length && suggestions.length > 0}
                onChange={(e) => setSelected(e.target.checked ? new Set(suggestions.map((s) => s.id)) : new Set())} />
              全选
            </label>
            <span className="muted small">已选 {selected.size} / {suggestions.length}</span>
            <div className="spacer" />
            <button className="primary sm" disabled={selected.size === 0 || bulkAccept.isPending} onClick={() => bulkAccept.mutate([...selected])}>
              <Check size={14} /> 批量接受
            </button>
          </div>
          {suggestions.length === 0 && <EmptyState icon={<Brain size={36} />} title="暂无待审阅建议" hint="处理笔记后会由 AI 生成主题提案与关联建议。" />}
          {suggestions.map((s) => {
            const sum = suggestionSummary(s);
            const checked = selected.has(s.id);
            return (
              <div className={`wiki-row sugg${checked ? ' checked' : ''}`} key={s.id}>
                <input type="checkbox" className="row-check" checked={checked} onChange={() => toggleSel(s.id)} />
                <div className="wiki-row-main">
                  <div className="sugg-head">
                    <span className="tag">{SUGGESTION_TYPE_LABEL[s.type] ?? s.type}</span>
                    <span className={`risk risk-${s.risk}`}>{RISK_LABEL[s.risk] ?? s.risk}</span>
                    <b>{sum.title}</b>
                  </div>
                  <p className="muted small">{sum.desc}</p>
                </div>
                <div className="wiki-row-actions">
                  {s.type === 'topic_proposal' && s.topicId && (
                    <button className="ghost" onClick={() => { const t = topics.find((x) => x.id === s.topicId); setTab('topics'); if (t) setActiveTopic(t); }}>查看主题</button>
                  )}
                  {s.type === 'cross_link' && (s.payload as { targetPageId?: string }).targetPageId && (
                    <button className="ghost" onClick={() => onOpenPage((s.payload as { targetPageId: string }).targetPageId!)}><Link2 size={14} /> 打开</button>
                  )}
                  <button className="ghost danger" disabled={ignore.isPending} onClick={() => ignore.mutate(s.id)}><X size={14} /> 忽略</button>
                  <button className="ghost ok" disabled={accept.isPending} onClick={() => accept.mutate(s.id)}><Check size={14} /> 接受</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {tab === 'topics' && (
        <div className="topic-layout">
          <div className="topic-list">
            <div className="topic-new">
              <input value={newTitle} placeholder="新建主题…" onChange={(e) => setNewTitle(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && createTopic.mutate()} />
              <button className="icon-btn" disabled={createTopic.isPending} onClick={() => createTopic.mutate()}><Plus size={15} /></button>
            </div>
            {topics.length === 0 && <EmptyState icon={<Network size={36} />} title="暂无 Topic" hint="处理笔记后，AI 会提炼候选主题；也可手动创建。" />}
            {topics.map((t) => (
              <button key={t.id} className={`topic-item${activeTopic?.id === t.id ? ' active' : ''}`} onClick={() => setActiveTopic(t)}>
                <div><b>{t.title}</b><span className={`tag status-${t.status}`}>{TOPIC_STATUS_LABEL[t.status] ?? t.status}</span></div>
                {t.aiSummary && <p className="muted small topic-sum">{t.aiSummary}</p>}
              </button>
            ))}
          </div>
          <div className="topic-detail">
            {!activeTopic && <EmptyState icon={<Network size={36} />} title="选择左侧主题查看详情" />}
            {activeTopic && (
              <>
                <div className="topic-detail-head">
                  <h3>{activeTopic.title}</h3>
                  <span className={`tag status-${activeTopic.status}`}>{TOPIC_STATUS_LABEL[activeTopic.status] ?? activeTopic.status}</span>
                </div>
                <p className="topic-ai-sum">{activeTopic.aiSummary || '（暂无 AI 摘要）'}</p>
                <div className="topic-detail-actions">
                  {activeTopic.status !== 'accepted' && (
                    <button className="primary sm" disabled={acceptTopic.isPending} onClick={() => acceptTopic.mutate(activeTopic.id)}><Check size={14} /> 采纳主题</button>
                  )}
                  <button className="ghost" disabled={refreshTopic.isPending} onClick={() => refreshTopic.mutate(activeTopic.id)}><RefreshCw size={14} /> 刷新建议</button>
                </div>
                <h4>来源页面（{topicSources?.sources?.length ?? 0}）</h4>
                <div className="topic-sources">
                  {(topicSources?.sources ?? []).map((src) => (
                    <button key={src.id} className="src-chip" onClick={() => onOpenPage(src.id)}><Link2 size={13} /> {src.title}</button>
                  ))}
                  {(topicSources?.sources?.length ?? 0) === 0 && <p className="muted small">暂无关联页面</p>}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
