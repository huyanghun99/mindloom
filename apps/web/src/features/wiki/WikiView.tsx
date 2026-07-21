import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAdaptivePolling } from '../../hooks/useAdaptivePolling';
import { Brain, Check, Layers, Link2, Network, Pause, Play, Plus, RefreshCw, RotateCcw, X, Zap } from 'lucide-react';
import { api, post, skipPageLlm } from '../../api';
import { useToast } from '../../components/Toast';
import { EmptyState } from '../../components/EmptyState';
import { SuggestionCard, SuggestionAccepted, suggestionTitle, HighRiskModal } from './SuggestionCard';
import type { Space, WikiSuggestion } from '../../types';

type WikiTopic = {
  id: string; title: string; status: string; source: string;
  aiSummary: string; textContent?: string; createdAt?: string;
};

type InboxItem = { id: string; title: string; llmProcessStatus: string; updatedAt?: string };

type WikiError = { id: string; title: string; wikiErrorMessage: string };

const TOPIC_STATUS_LABEL: Record<string, string> = {
  suggested: '待审阅', accepted: '已采纳', user_edited: '已编辑', stale: '待更新', archived: '已归档'
};
const INBOX_STATUS_LABEL: Record<string, string> = {
  pending: '待整理', processing: '整理中', processed: '已整理', failed: '整理失败', ignored: '已忽略'
};

export function WikiView({ space, onOpenPage }: { space: Space; onOpenPage: (id: string) => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [tab, setTab] = useState<'inbox' | 'suggestions' | 'topics'>('inbox');

  const [hasActivity, setHasActivity] = useState(false);
  const poll = useAdaptivePolling({ enabled: !!space, hasActivity });

  const { data: inboxData, isLoading: inboxLoading } = useQuery<{ inbox: InboxItem[] }>({
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

  // Phase 0 task 6: surface pages whose Wiki artifact generation failed.
  const { data: wikiErrData } = useQuery<{ errors: WikiError[] }>({
    queryKey: ['wiki-errors', space.id], queryFn: () => api(`/api/llm-wiki/spaces/${space.id}/wiki-errors`), refetchInterval: poll
  });
  const wikiErrors = wikiErrData?.errors ?? [];

  useEffect(() => {
    setHasActivity(inbox.length > 0 || suggestions.length > 0 || topics.length > 0);
  }, [inbox, suggestions, topics]);

  const reprocess = useMutation({
    mutationFn: () => post(`/api/llm-wiki/spaces/${space.id}/reprocess`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inbox', space.id] });
      qc.invalidateQueries({ queryKey: ['suggestions', space.id] });
      qc.invalidateQueries({ queryKey: ['topics', space.id] });
      toast.success('已重新生成全部 Wiki 产物');
    },
    onError: (e) => toast.error(`操作失败：${(e as Error).message}`)
  });
  const toggleAuto = useMutation({
    mutationFn: () => post(`/api/llm-wiki/spaces/${space.id}/${autoOn ? 'pause' : 'resume'}`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['wiki-space', space.id] })
  });

  /* ------------------------------------------------ LLM Inbox ------------ */
  const [doneIds, setDoneIds] = useState<Set<string>>(new Set());
  const markDone = (ids: string[]) => setDoneIds((p) => { const n = new Set(p); ids.forEach((i) => n.add(i)); return n; });

  const bulkProcess = useMutation({
    mutationFn: (ids: string[]) => Promise.all(ids.map((id) => post(`/api/llm-wiki/pages/${id}/process-now`, {}))),
    onSuccess: () => { markDone(inbox.map((p) => p.id)); qc.invalidateQueries({ queryKey: ['inbox', space.id] }); toast.success('已加入处理队列'); },
    onError: (e) => toast.error(`操作失败：${(e as Error).message}`)
  });
  const bulkIgnore = useMutation({
    mutationFn: (ids: string[]) => Promise.all(ids.map((id) => skipPageLlm(id))),
    onSuccess: () => { markDone(inbox.map((p) => p.id)); qc.invalidateQueries({ queryKey: ['inbox', space.id] }); toast.success('已忽略收件箱中的页面'); },
    onError: (e) => toast.error(`操作失败：${(e as Error).message}`)
  });

  const processNow = useMutation({
    mutationFn: (pageId: string) => post(`/api/llm-wiki/pages/${pageId}/process-now`, {}),
    onSuccess: (_r, id) => { markDone([id]); qc.invalidateQueries({ queryKey: ['inbox', space.id] }); },
    onError: (e) => toast.error(`操作失败：${(e as Error).message}`)
  });
  const skipOne = useMutation({
    mutationFn: (pageId: string) => skipPageLlm(pageId),
    onSuccess: (_r, id) => { markDone([id]); qc.invalidateQueries({ queryKey: ['inbox', space.id] }); },
    onError: (e) => toast.error(`操作失败：${(e as Error).message}`)
  });

  /* --------------------------------------------- Suggestions (review) ---- */
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const bulkAccept = useMutation({
    mutationFn: (ids: string[]) => post(`/api/llm-wiki/suggestions/bulk-accept`, { spaceId: space.id, ids }),
    onSuccess: () => { setSelected(new Set()); qc.invalidateQueries({ queryKey: ['suggestions', space.id] }); }
  });
  const [recentlyAccepted, setRecentlyAccepted] = useState<{ id: string; label: string }[]>([]);
  const [highSugg, setHighSugg] = useState<WikiSuggestion | null>(null);
  const [snoozed, setSnoozed] = useState<Set<string>>(new Set());

  const accept = useMutation({
    mutationFn: (id: string) => post(`/api/llm-wiki/suggestions/${id}/accept`, {}),
    onSuccess: (_r, id) => {
      setSelected(new Set());
      qc.invalidateQueries({ queryKey: ['suggestions', space.id] });
      const s = suggestions.find((x) => x.id === id);
      if (s) setRecentlyAccepted((p) => [...p, { id, label: suggestionTitle(s).title }]);
    }
  });
  const ignore = useMutation({
    mutationFn: (id: string) => post(`/api/llm-wiki/suggestions/${id}/ignore`, {}),
    onSuccess: () => { setSelected(new Set()); qc.invalidateQueries({ queryKey: ['suggestions', space.id] }); }
  });
  const undo = useMutation({
    mutationFn: (id: string) => post(`/api/llm-wiki/suggestions/${id}/undo`, {}),
    onSuccess: (_r, id) => {
      setRecentlyAccepted((p) => p.filter((x) => x.id !== id));
      qc.invalidateQueries({ queryKey: ['suggestions', space.id] });
    }
  });

  // Low-risk (tag) suggestions are applied automatically — but transparently,
  // via a toast — so the user always knows what changed (never "secret" edits).
  const autoHandled = useRef<Set<string>>(new Set());
  useEffect(() => {
    for (const s of suggestions) {
      if (s.risk === 'low' && !autoHandled.current.has(s.id)) {
        autoHandled.current.add(s.id);
        const label = (s.payload as { topicTitle?: string; targetPageTitle?: string })?.topicTitle
          ?? (s.payload as { targetPageTitle?: string })?.targetPageTitle
          ?? (s.type === 'topic_proposal' ? '新主题' : '关联');
        accept.mutate(s.id);
        toast.info(`已自动添加标签：${label}`);
      }
    }
  }, [suggestions, accept, toast]);

  const lowRiskIds = suggestions.filter((s) => s.risk === 'low').map((s) => s.id);
  const visibleSuggestions = suggestions.filter((s) => !snoozed.has(s.id));

  /* ----------------------------------------------------- Topics ---------- */
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
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['suggestions', space.id] }); qc.invalidateQueries({ queryKey: ['topics', space.id] }); toast.success('已提交重新生成，稍后查看结果'); },
    onError: (e) => toast.error(`操作失败：${(e as Error).message}`)
  });
  const undoTopicM = useMutation({
    mutationFn: (id: string) => post(`/api/llm-wiki/topics/${id}/undo`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['topics', space.id] });
      if (activeTopic) setActiveTopic({ ...activeTopic, status: 'suggested' });
    }
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
    { key: 'suggestions', label: '建议', icon: <Brain size={16} />, count: visibleSuggestions.length },
    { key: 'topics', label: 'Topic Center', icon: <Network size={16} />, count: topics.length }
  ];

  return (
    <div className="wiki-view">
      {wikiErrors.length > 0 && (
        <div className="wiki-errors-banner">
          <b>⚠ {wikiErrors.length} 篇笔记的 Wiki 产物生成失败</b>
          <ul>
            {wikiErrors.map((e) => (
              <li key={e.id}>
                <span className="muted small">{e.title}</span>
                <span className="wiki-err-msg">{e.wikiErrorMessage}</span>
                <button className="ghost sm" disabled={processNow.isPending} onClick={() => processNow.mutate(e.id)}>重试</button>
              </li>
            ))}
          </ul>
        </div>
      )}
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
          {inbox.length > 0 && (
            <div className="batch-bar">
              <span className="muted small">待处理 {inbox.length} 篇</span>
              <div className="spacer" />
              <button className="ghost sm" disabled={bulkProcess.isPending} onClick={() => bulkProcess.mutate(inbox.map((p) => p.id))}>
                <Check size={14} /> 全部标记已处理
              </button>
              <button className="ghost sm" disabled={bulkIgnore.isPending} onClick={() => bulkIgnore.mutate(inbox.map((p) => p.id))}>
                <X size={14} /> 全部忽略
              </button>
            </div>
          )}
          {inboxLoading && <div className="muted small">加载中…</div>}
          {!inboxLoading && inbox.length === 0 && (
            <EmptyState icon={<Layers size={36} />} title="收件箱为空" hint="新建或编辑笔记后会自动进入 LLM 处理队列，处理完成后将生成主题与建议。" />
          )}
          {inbox.map((p) => {
            const done = doneIds.has(p.id);
            return (
              <div className={`wiki-row inbox-row${done ? ' done' : ''}`} key={p.id}>
                <div className="wiki-row-main">
                  <b>{p.title || '未命名笔记'}</b>
                  <span className="muted small inbox-meta">
                    {p.updatedAt ? `修改于 ${new Date(p.updatedAt).toLocaleString()}` : '修改时间未知'}
                    <span className={`inbox-status status-${p.llmProcessStatus}`}>{INBOX_STATUS_LABEL[p.llmProcessStatus] ?? p.llmProcessStatus}</span>
                  </span>
                </div>
                <div className="wiki-row-actions">
                  {done
                    ? <span className="accept-check static"><Check size={14} /> {p.llmProcessStatus === 'ignored' ? '已忽略' : '已处理'}</span>
                    : (
                      <>
                        <button className="ghost" onClick={() => onOpenPage(p.id)}>打开</button>
                        <button className="ghost" disabled={skipOne.isPending} onClick={() => skipOne.mutate(p.id)}><X size={14} /> 忽略</button>
                        <button className="ghost ok" disabled={processNow.isPending} onClick={() => processNow.mutate(p.id)}><Zap size={14} /> 立即处理</button>
                      </>
                    )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {tab === 'suggestions' && (
        <div className="wiki-pane">
          <div className="batch-bar">
            <label className="check-all">
              <input type="checkbox" checked={selected.size === visibleSuggestions.length && visibleSuggestions.length > 0}
                onChange={(e) => setSelected(e.target.checked ? new Set(visibleSuggestions.map((s) => s.id)) : new Set())} />
              全选
            </label>
            <span className="muted small">已选 {selected.size} / {visibleSuggestions.length}</span>
            <div className="spacer" />
            <button className="ghost sm" disabled={lowRiskIds.length === 0 || bulkAccept.isPending} onClick={() => bulkAccept.mutate(lowRiskIds)} title="一次性接受所有低风险建议">
              <Check size={14} /> 批量接受低风险（{lowRiskIds.length}）
            </button>
            <button className="primary sm" disabled={selected.size === 0 || bulkAccept.isPending} onClick={() => bulkAccept.mutate([...selected])}>
              <Check size={14} /> 批量接受
            </button>
          </div>
          {visibleSuggestions.length === 0 && recentlyAccepted.length === 0 && (
            <EmptyState icon={<Brain size={36} />} title="暂无待审阅建议" hint="处理笔记后会由 AI 生成主题提案与关联建议。" />
          )}
          {visibleSuggestions.map((s) => (
            <SuggestionCard
              key={s.id}
              s={s}
              onAccept={(x) => accept.mutate(x.id)}
              onIgnore={(x) => ignore.mutate(x.id)}
              onSnooze={(x) => setSnoozed((p) => new Set(p).add(x.id))}
              onAcceptHigh={(x) => setHighSugg(x)}
            />
          ))}
          {recentlyAccepted.map((a) => (
            <SuggestionAccepted key={a.id} label={a.label} onUndo={() => undo.mutate(a.id)} />
          ))}
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
                {t.status === 'stale' && (
                  <button
                    className="stale-updated"
                    title="来源页面已更新，点击重新生成"
                    onClick={(e) => { e.stopPropagation(); refreshTopic.mutate(t.id); }}
                  >
                    <RefreshCw size={11} /> 来源已更新
                  </button>
                )}
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
                  {activeTopic.status === 'accepted' && (
                    <button className="ghost" disabled={undoTopicM.isPending} onClick={() => undoTopicM.mutate(activeTopic.id)}><RotateCcw size={14} /> 撤销采纳</button>
                  )}
                  {activeTopic.status === 'stale' && (
                    <button className="ghost stale-updated-btn" disabled={refreshTopic.isPending} onClick={() => refreshTopic.mutate(activeTopic.id)}>
                      <RefreshCw size={14} /> 来源已更新 · 重新生成
                    </button>
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

      {highSugg && (
        <HighRiskModal
          suggestion={highSugg}
          onClose={() => setHighSugg(null)}
          onConfirm={() => { accept.mutate(highSugg.id); setHighSugg(null); }}
        />
      )}
    </div>
  );
}
