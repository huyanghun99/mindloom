import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BookOpen, Brain, Check, ChevronDown, ChevronRight, FileText, Layers, Link2, Loader2,
  LogOut, Network, Pause, Pencil, Play, Plus, RefreshCw, Save, Search, Send, Sparkles, Trash2, X, Zap
} from 'lucide-react';
import { api, post, put, patch, del } from './api';
import { GraphView } from './GraphView';
import { RichEditor } from './editor/RichEditor';
import { countWords, emptyDoc, extractText, type PMNode } from './editor/prosemirror';

type User = { id: string; email: string; name: string; isInstanceOwner: boolean };
type Workspace = { id: string; name: string; role?: string };
type Space = { id: string; name: string; workspaceId: string; role?: string };
type Page = {
  id: string; title: string; textContent: string; contentJson: PMNode;
  contentVersion: number; llmProcessStatus: string; parentPageId?: string | null; updatedAt?: string;
};

const STATUS_LABEL: Record<string, string> = {
  pending: '待处理', processing: '处理中', done: '已同步', processed: '已同步', failed: '失败', skipped: '已跳过', ignored: '已忽略'
};

/* ----------------------------------------------------------------- Auth ---- */
function AuthPanel() {
  const qc = useQueryClient();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const mutation = useMutation({
    mutationFn: () => post('/api/auth/' + mode, mode === 'register' ? { name, email, password } : { email, password }),
    onSuccess: () => qc.invalidateQueries()
  });
  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="brand">
          <div className="brand-mark"><Sparkles size={22} /></div>
          <div>
            <h1>MindLoom 知织</h1>
            <p>个人与小团队的 LLM-first 知识创作系统</p>
          </div>
        </div>
        <div className="auth-tabs">
          <button className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')}>登录</button>
          <button className={mode === 'register' ? 'active' : ''} onClick={() => setMode('register')}>注册</button>
        </div>
        <form onSubmit={(e) => { e.preventDefault(); mutation.mutate(); }} className="auth-form">
          {mode === 'register' && (
            <label>姓名<input value={name} onChange={(e) => setName(e.target.value)} placeholder="你的名字" required /></label>
          )}
          <label>邮箱<input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" type="email" required /></label>
          <label>密码<input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="至少 8 位" type="password" required /></label>
          <button className="primary block" type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? <Loader2 className="spin" size={16} /> : null}
            {mode === 'register' ? '创建账号' : '登录'}
          </button>
        </form>
        {mutation.error && <p className="error">{String((mutation.error as Error).message)}</p>}
        <p className="auth-hint">首个注册用户将成为实例 Owner。</p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- Empty state -- */
function EmptyState({ icon, title, hint }: { icon: React.ReactNode; title: string; hint?: string }) {
  return (
    <div className="empty-state">
      <div className="empty-icon">{icon}</div>
      <p className="empty-title">{title}</p>
      {hint && <p className="empty-hint">{hint}</p>}
    </div>
  );
}

/* --------------------------------------------------- Space switcher (top) -- */
function SpaceSwitcher({ workspace, space, onPickWorkspace, onPickSpace }: {
  workspace: Workspace | null; space: Space | null;
  onPickWorkspace: (w: Workspace | null) => void; onPickSpace: (s: Space | null) => void;
}) {
  const qc = useQueryClient();
  const { data: ws } = useQuery<{ workspaces: Workspace[] }>({ queryKey: ['workspaces'], queryFn: () => api('/api/workspaces') });
  const { data: sp } = useQuery<{ spaces: Space[] }>({
    queryKey: ['spaces', workspace?.id], enabled: !!workspace,
    queryFn: () => api(`/api/spaces?workspaceId=${workspace!.id}`)
  });
  const [wsName, setWsName] = useState('');
  const [spName, setSpName] = useState('');
  const [openWs, setOpenWs] = useState(false);
  const [openSp, setOpenSp] = useState(false);
  const [editingWs, setEditingWs] = useState<string | null>(null);
  const [editingSp, setEditingSp] = useState<string | null>(null);

  /* ----- workspace actions ----- */
  const renameWorkspace = useMutation({
    mutationFn: (name: string) => patch(`/api/workspaces/${workspace!.id}`, { name }),
    onSuccess: async (_r, name) => {
      await qc.invalidateQueries({ queryKey: ['workspaces'] });
      onPickWorkspace({ ...workspace!, name });
    }
  });
  const deleteWorkspace = useMutation({
    mutationFn: () => del(`/api/workspaces/${workspace!.id}`),
    onSuccess: async () => { await qc.invalidateQueries({ queryKey: ['workspaces'] }); onPickWorkspace(null); onPickSpace(null); }
  });

  /* ----- space actions ----- */
  const renameSpace = useMutation({
    mutationFn: (name: string) => patch(`/api/spaces/${space!.id}`, { name }),
    onSuccess: async (_r, name) => {
      await qc.invalidateQueries({ queryKey: ['spaces', workspace!.id] });
      onPickSpace({ ...space!, name });
    }
  });
  const deleteSpace = useMutation({
    mutationFn: () => del(`/api/spaces/${space!.id}`),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['spaces', workspace!.id] });
      // Pick the first remaining space if any
      const remaining = (sp?.spaces ?? []).filter((s) => s.id !== space!.id);
      onPickSpace(remaining[0] ?? null);
    }
  });

  const createWs = useMutation({
    mutationFn: () => post<{ workspace: Workspace }>('/api/workspaces', { name: wsName || '我的知识库' }),
    onSuccess: async (r) => { setWsName(''); setOpenWs(false); await qc.invalidateQueries({ queryKey: ['workspaces'] }); onPickWorkspace(r.workspace); }
  });
  const createSp = useMutation({
    mutationFn: () => post<{ space: Space }>('/api/spaces', { workspaceId: workspace!.id, name: spName || '默认 Space', aiPrivacyPolicy: 'inherit_workspace' }),
    onSuccess: async (r) => { setSpName(''); setOpenSp(false); await qc.invalidateQueries({ queryKey: ['spaces', workspace!.id] }); onPickSpace(r.space); }
  });

  return (
    <div className="space-switcher">
      <div className="ss-group">
        <button className="ss-trigger" onClick={() => { setOpenWs((o) => !o); setOpenSp(false); }}>
          <Sparkles size={15} /> {workspace?.name ?? '选择知识库'} <ChevronDown size={14} />
        </button>
        {openWs && (
          <>
            <div className="ss-backdrop" onClick={() => setOpenWs(false)} />
            <div className="ss-menu">
              {(ws?.workspaces ?? []).map((w) => {
                const isActive = workspace?.id === w.id;
                const isEditing = editingWs === w.id;
                return (
                  <div key={w.id} className={`ss-item-row${isActive ? ' active' : ''}`}>
                    {isEditing ? (
                      <input
                        className="ss-rename"
                        autoFocus
                        defaultValue={w.name}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') { const v = e.currentTarget.value.trim(); if (v && v !== w.name) renameWorkspace.mutate(v); setEditingWs(null); }
                          else if (e.key === 'Escape') setEditingWs(null);
                        }}
                        onBlur={(e) => { const v = e.currentTarget.value.trim(); if (v && v !== w.name) renameWorkspace.mutate(v); setEditingWs(null); }}
                      />
                    ) : (
                      <button className="ss-item" onClick={() => { onPickWorkspace(w); onPickSpace(null); setOpenWs(false); }}>{w.name}</button>
                    )}
                    {isActive && !isEditing && (
                      <>
                        <button className="icon-btn" title="重命名" onClick={(ev) => { ev.stopPropagation(); setEditingWs(w.id); }}><Pencil size={12} /></button>
                        <button className="icon-btn danger" title="删除知识库"
                          onClick={(ev) => { ev.stopPropagation(); if (confirm(`确定删除「${w.name}」及其所有内容？此操作不可撤销。`)) deleteWorkspace.mutate(); }}>
                          <Trash2 size={12} />
                        </button>
                      </>
                    )}
                  </div>
                );
              })}
              <div className="ss-new">
                <input value={wsName} placeholder="新 Workspace" onChange={(e) => setWsName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && createWs.mutate()} />
                <button className="icon-btn" onClick={() => createWs.mutate()}><Plus size={14} /></button>
              </div>
            </div>
          </>
        )}
      </div>

      {workspace && (
        <ChevronRight className="ss-arrow" size={15} />
      )}

      {workspace && (
        <div className="ss-group">
          <button className="ss-trigger" disabled={!workspace} onClick={() => { setOpenSp((o) => !o); setOpenWs(false); }}>
            {space?.name ?? '选择 Space'} <ChevronDown size={14} />
          </button>
          {openSp && (
            <>
              <div className="ss-backdrop" onClick={() => setOpenSp(false)} />
              <div className="ss-menu">
                {(sp?.spaces ?? []).map((s) => {
                  const isActive = space?.id === s.id;
                  const isEditing = editingSp === s.id;
                  return (
                    <div key={s.id} className={`ss-item-row${isActive ? ' active' : ''}`}>
                      {isEditing ? (
                        <input
                          className="ss-rename"
                          autoFocus
                          defaultValue={s.name}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') { const v = e.currentTarget.value.trim(); if (v && v !== s.name) renameSpace.mutate(v); setEditingSp(null); }
                            else if (e.key === 'Escape') setEditingSp(null);
                          }}
                          onBlur={(e) => { const v = e.currentTarget.value.trim(); if (v && v !== s.name) renameSpace.mutate(v); setEditingSp(null); }}
                        />
                      ) : (
                        <button className="ss-item" onClick={() => { onPickSpace(s); setOpenSp(false); }}>{s.name}</button>
                      )}
                      {isActive && !isEditing && (
                        <>
                          <button className="icon-btn" title="重命名" onClick={(ev) => { ev.stopPropagation(); setEditingSp(s.id); }}><Pencil size={12} /></button>
                          <button className="icon-btn danger" title="删除 Space"
                            onClick={(ev) => { ev.stopPropagation(); if (confirm(`确定删除「${s.name}」及其所有笔记？此操作不可撤销。`)) deleteSpace.mutate(); }}>
                            <Trash2 size={12} />
                          </button>
                        </>
                      )}
                    </div>
                  );
                })}
                <div className="ss-new">
                  <input value={spName} placeholder="新 Space" onChange={(e) => setSpName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && createSp.mutate()} />
                  <button className="icon-btn" onClick={() => createSp.mutate()}><Plus size={14} /></button>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/* --------------------------------------------------------------- Notes ------ */
type TreeNode = Page & { children: TreeNode[] };
function buildTree(pages: Page[]): TreeNode[] {
  const byParent = new Map<string, Page[]>();
  for (const p of pages) {
    const key = p.parentPageId ?? 'root';
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key)!.push(p);
  }
  const make = (parentId: string): TreeNode[] =>
    (byParent.get(parentId) ?? []).map((p) => ({ ...p, children: make(p.id) }));
  return make('root');
}

function PageTreeNode({ node, depth, selectedId, onSelect }: {
  node: TreeNode; depth: number; selectedId: string | null; onSelect: (id: string) => void;
}) {
  return (
    <>
      <button className={`tree-item${selectedId === node.id ? ' active' : ''}`} style={{ paddingLeft: 10 + depth * 14 }}
        onClick={() => onSelect(node.id)}>
        <FileText size={14} />
        <span className="tree-title">{node.title || '未命名笔记'}</span>
        <span className={`dot status-${node.llmProcessStatus}`} title={STATUS_LABEL[node.llmProcessStatus] ?? node.llmProcessStatus} />
      </button>
      {node.children.map((c) => (
        <PageTreeNode key={c.id} node={c} depth={depth + 1} selectedId={selectedId} onSelect={onSelect} />
      ))}
    </>
  );
}

function NotesView({ workspace, space, selectedPageId, onSelectPage }: {
  workspace: Workspace; space: Space; selectedPageId: string | null; onSelectPage: (id: string) => void;
}) {
  const qc = useQueryClient();

  /* Sidebar: lightweight page list (title + metadata only — no full contentJson). */
  const { data: pagesData, isLoading: pagesLoading } = useQuery<{ pages: Page[] }>({
    queryKey: ['pages', space.id], queryFn: () => api(`/api/pages?spaceId=${space.id}`)
  });
  const pages = pagesData?.pages ?? [];
  const tree = useMemo(() => buildTree(pages), [pages]);

  /* Active page detail: always fetched fresh from /api/pages/:id so the
     editor never shows stale or cached-wrong content. */
  const { data: pageDetail, isLoading: detailLoading } = useQuery<{ page: Page }>({
    queryKey: ['page-detail', selectedPageId],
    enabled: !!selectedPageId,
    staleTime: 0,
    refetchOnWindowFocus: false,
    queryFn: () => api(`/api/pages/${selectedPageId!}`),
  });

  const [title, setTitle] = useState('');
  const [doc, setDoc] = useState<PMNode>(emptyDoc);
  const [dirty, setDirty] = useState(false);

  /* When the fresh page detail arrives, sync editor state. This is the
     single source of truth — no more relying on the list cache. */
  useEffect(() => {
    if (!pageDetail?.page) return;
    const p = pageDetail.page;
    setTitle(p.title ?? '');
    setDoc(p.contentJson && Object.keys(p.contentJson).length > 0 ? p.contentJson : emptyDoc);
    setDirty(false);
  }, [pageDetail?.page?.id, pageDetail?.page?.contentVersion]);

  // First-run: open the first page automatically.
  const didAutoOpen = useRef(false);
  useEffect(() => {
    if (didAutoOpen.current || selectedPageId || pages.length === 0) return;
    didAutoOpen.current = true;
    onSelectPage(pages[0].id);
  }, [pages.length, selectedPageId, onSelectPage]);

  /* After a save, invalidate both queries so sidebar stays in sync and
     next re-open gets fresh data. */

  const createPage = useMutation({
    mutationFn: () => post<{ page: Page }>('/api/pages', {
      workspaceId: workspace.id, spaceId: space.id, title: '未命名笔记', contentJson: emptyDoc, textContent: ''
    }),
    onSuccess: async (res) => { await qc.invalidateQueries({ queryKey: ['pages', space.id] }); onSelectPage(res.page.id); }
  });

  const activePage = pageDetail?.page ?? null;

  const updatePage = useMutation({
    mutationFn: () => activePage
      ? put<{ page: Page }>(`/api/pages/${activePage.id}`, {
        title: title || '未命名笔记', contentJson: doc, textContent: extractText(doc), contentVersion: activePage.contentVersion
      })
      : Promise.reject(new Error('未选择页面')),
    onSuccess: async () => {
      setDirty(false);
      // Invalidate both list and detail so sidebar + editor stay in sync.
      await qc.invalidateQueries({ queryKey: ['pages', space.id] });
      await qc.invalidateQueries({ queryKey: ['page-detail', selectedPageId] });
    }
  });

  // Debounced auto-save: any edit is persisted ~1.2s after the last change,
  // without creating a page revision (autosave flag). Manual save still
  // creates a revision as an explicit checkpoint.
  const autoSave = useMutation({
    mutationFn: () => activePage
      ? put<{ page: Page }>(`/api/pages/${activePage.id}`, {
        title: title || '未命名笔记', contentJson: doc, textContent: extractText(doc), contentVersion: activePage.contentVersion, autosave: true
      })
      : Promise.reject(new Error('未选择页面')),
    onSuccess: async () => {
      setDirty(false);
      await qc.invalidateQueries({ queryKey: ['pages', space.id] });
      await qc.invalidateQueries({ queryKey: ['page-detail', selectedPageId] });
    }
  });

  const savingRef = useRef(false);
  useEffect(() => { savingRef.current = autoSave.isPending || updatePage.isPending; }, [autoSave.isPending, updatePage.isPending]);
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!dirty || !activePage) return;
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(() => {
      if (!savingRef.current) autoSave.mutate();
    }, 1200);
    return () => { if (autosaveTimer.current) clearTimeout(autosaveTimer.current); };
  }, [dirty, title, doc, activePage?.id]);

  const deletePage = useMutation({
    mutationFn: (id: string) => del(`/api/pages/${id}`),
    onSuccess: async () => { onSelectPage(''); await qc.invalidateQueries({ queryKey: ['pages', space.id] }); }
  });

  const wordCount = useMemo(() => countWords(extractText(doc)), [doc]);
  const saving = updatePage.isPending || autoSave.isPending;

  return (
    <div className="notes-layout">
      <aside className="pages-pane">
        <div className="pane-head">
          <span>页面 {pages.length > 0 && <em>{pages.length}</em>}</span>
          <button className="icon-btn" title="新建笔记" onClick={() => createPage.mutate()}><Plus size={16} /></button>
        </div>
        <div className="pages-list">
          {pagesLoading && <div className="muted small">加载中…</div>}
          {!pagesLoading && pages.length === 0 && <div className="muted small empty-hint">还没有笔记，点击 + 新建</div>}
          {tree.map((n) => (
            <PageTreeNode key={n.id} node={n} depth={0} selectedId={selectedPageId} onSelect={onSelectPage} />
          ))}
        </div>
      </aside>

      <main className="editor-pane">
        {!selectedPageId && !createPage.isPending && (
          <EmptyState icon={<FileText size={40} />} title="选择或新建一篇笔记" hint="Page 是 source of truth，保存后会自动进入 LLM Wiki 处理队列。" />
        )}
        {selectedPageId && detailLoading && !pageDetail && (
          <div className="editor-loading-skeleton">
            <div className="skel-head"><div className="skel-line skel-lg" /><div className="skel-line skel-sm" /></div>
            <div className="skel-body">
              {Array.from({ length: 6 }).map((_, i) => <div key={i} className={`skel-line ${i === 0 ? 'skel-md' : ''}`} />)}
            </div>
          </div>
        )}
        {selectedPageId && pageDetail && (
          <>
            <div className="editor-head">
              <div className="crumb">
                <span>{workspace.name}</span><ChevronRight size={13} />
                <span>{space.name}</span><ChevronRight size={13} />
                <span className="crumb-current">{title || '未命名笔记'}</span>
              </div>
              <div className="editor-actions">
                <span className="meta">{wordCount} 字 · v{pageDetail.page.contentVersion} · {STATUS_LABEL[pageDetail.page.llmProcessStatus] ?? pageDetail.page.llmProcessStatus}</span>
                {!dirty && !saving && <span className="meta autosaved">已自动保存</span>}
                <button className="ghost danger" title="删除" onClick={() => { if (confirm('确定删除这篇笔记？')) deletePage.mutate(pageDetail.page.id); }}><Trash2 size={15} /></button>
                <button className="primary" disabled={!dirty && !saving} onClick={() => updatePage.mutate()}>
                  {saving ? <Loader2 className="spin" size={15} /> : <Save size={15} />}
                  {saving ? '保存中…' : dirty ? '保存' : '已保存'}
                </button>
              </div>
            </div>
            <input className="title-input" value={title} placeholder="无标题"
              onChange={(e) => { setTitle(e.target.value); setDirty(true); }} />
            <RichEditor
              key={activePage.id}
              content={activePage.contentJson && Object.keys(activePage.contentJson).length > 0 ? activePage.contentJson : emptyDoc}
              workspaceId={workspace.id}
              spaceId={space.id}
              pageId={activePage.id}
              onChange={({ contentJson }) => { setDoc(contentJson); setDirty(true); }}
            />
          </>
        )}
      </main>
    </div>
  );
}

/* ------------------------------------------------------------- LLM Wiki ---- */
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

function LlmWikiView({ space, onOpenPage }: { space: Space; onOpenPage: (id: string) => void }) {
  const qc = useQueryClient();
  const [tab, setTab] = useState<'inbox' | 'suggestions' | 'topics'>('inbox');

  /* ----- Inbox ----- */
  const { data: inboxData, isLoading: inboxLoading } = useQuery<{ inbox: Page[] }>({
    queryKey: ['inbox', space.id], queryFn: () => api(`/api/llm-wiki/inbox?spaceId=${space.id}`), refetchInterval: 5000
  });
  const inbox = inboxData?.inbox ?? [];
  const processNow = useMutation({
    mutationFn: (pageId: string) => post(`/api/llm-wiki/pages/${pageId}/process-now`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['inbox', space.id] })
  });

  const { data: spaceData } = useQuery<{ space: Space & { autoLlmProcessing: boolean } }>({
    queryKey: ['wiki-space', space.id], queryFn: () => api(`/api/spaces/${space.id}`)
  });
  const autoOn = spaceData?.space?.autoLlmProcessing ?? true;
  const toggleAuto = useMutation({
    mutationFn: () => post(`/api/llm-wiki/spaces/${space.id}/${autoOn ? 'pause' : 'resume'}`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['wiki-space', space.id] })
  });
  const reprocess = useMutation({
    mutationFn: () => post(`/api/llm-wiki/spaces/${space.id}/reprocess`, {}),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['inbox', space.id] }); qc.invalidateQueries({ queryKey: ['suggestions', space.id] }); qc.invalidateQueries({ queryKey: ['topics', space.id] }); }
  });

  /* ----- Suggestions (batch review) ----- */
  const { data: suggData } = useQuery<{ suggestions: WikiSuggestion[] }>({
    queryKey: ['suggestions', space.id], queryFn: () => api(`/api/llm-wiki/suggestions?spaceId=${space.id}`), refetchInterval: 8000
  });
  const suggestions = suggData?.suggestions ?? [];
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const toggleSel = (id: string) =>
    setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
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

  /* ----- Topics (Topic Center) ----- */
  const { data: topicData } = useQuery<{ topics: WikiTopic[] }>({
    queryKey: ['topics', space.id], queryFn: () => api(`/api/llm-wiki/topics?spaceId=${space.id}`), refetchInterval: 8000
  });
  const topics = topicData?.topics ?? [];
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

      {/* ---------------- Inbox ---------------- */}
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
                <span className="muted small">{STATUS_LABEL[p.llmProcessStatus] ?? p.llmProcessStatus}</span>
              </div>
              <div className="wiki-row-actions">
                <button className="ghost" onClick={() => onOpenPage(p.id)}>打开</button>
                <button className="ghost" disabled={processNow.isPending} onClick={() => processNow.mutate(p.id)}><Zap size={14} /> 立即处理</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ---------------- Suggestions (batch review) ---------------- */}
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

      {/* ---------------- Topic Center ---------------- */}
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
                    <button key={src.id} className="src-chip" onClick={() => onOpenPage(src.id)}><FileText size={13} /> {src.title}</button>
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

/* --------------------------------------------------------------- Search ---- */
type SearchResult = {
  id: string; pageId?: string; spaceId?: string; title: string; content: string;
  excerpt?: string; snippet?: string; score?: number; source?: string;
};

// Split a query into highlightable terms: ASCII words + maximal Chinese runs.
// (Backend tokenizes into ngrams for matching; for display we highlight the
// original phrases the user actually typed, which reads far more naturally.)
function extractTerms(q: string): string[] {
  const terms: string[] = [];
  const ascii = q.toLowerCase().match(/[a-z0-9_]+/g);
  if (ascii) terms.push(...ascii);
  const cn = q.match(/[一-鿿]+/g);
  if (cn) terms.push(...cn);
  return [...new Set(terms)].sort((a, b) => b.length - a.length);
}
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
function highlight(text: string, terms: string[]): React.ReactNode {
  if (!terms.length) return text;
  const re = new RegExp(`(${terms.map(escapeRe).join('|')})`, 'gi');
  const out: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(<mark key={k++}>{m[0]}</mark>);
    last = m.index + m[0].length;
    if (m[0].length === 0) re.lastIndex++;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function SearchView({ workspace, space, spaces, onOpenPage }: {
  workspace: Workspace; space: Space; spaces: Space[]; onOpenPage: (id: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<'keyword' | 'hybrid' | 'vector'>('hybrid');
  const [scope, setScope] = useState<'space' | 'workspace'>('space');
  const terms = useMemo(() => extractTerms(query), [query]);
  const spaceName = useMemo(() => {
    const map = new Map(spaces.map((s) => [s.id, s.name]));
    return (id?: string) => (id ? map.get(id) ?? '其他 Space' : '');
  }, [spaces]);

  const mutation = useMutation({
    mutationFn: () => post<{ results: SearchResult[] }>('/api/search', {
      workspaceId: workspace.id,
      ...(scope === 'space' ? { spaceId: space.id } : {}),
      query, limit: 20, mode
    })
  });
  const { mutate } = mutation;
  const run = () => { if (query.trim()) mutate(); };

  // Debounced live search: results refresh ~350ms after the last keystroke.
  // IMPORTANT: depend on the *stable* `mutate` fn, not the whole `mutation`
  // object (which gets a new identity on every render). Depending on the
  // object would reset the timer on every re-render and spin an infinite
  // re-search loop (button flicker, no stable results).
  useEffect(() => {
    if (!query.trim()) return;
    const t = setTimeout(() => mutate(), 350);
    return () => clearTimeout(t);
  }, [query, scope, mode, mutate]);

  const results = mutation.data?.results ?? [];
  return (
    <div className="single-pane search-pane">
      <div className="search-bar">
        <Search size={18} />
        <input autoFocus value={query} placeholder="搜索笔记（支持中文分词）…"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') run(); }} />
        {mutation.isPending && <Loader2 className="spin search-spin" size={15} />}
        <div className="seg">
          <button className={scope === 'space' ? 'active' : ''} onClick={() => setScope('space')}>本 Space</button>
          <button className={scope === 'workspace' ? 'active' : ''} onClick={() => setScope('workspace')}>全部</button>
        </div>
        <div className="seg">
          {(['keyword', 'hybrid', 'vector'] as const).map((m) => (
            <button key={m} className={mode === m ? 'active' : ''} onClick={() => setMode(m)}>{m === 'keyword' ? '关键词' : m === 'hybrid' ? '混合' : '语义'}</button>
          ))}
        </div>
        <button className="primary" disabled={!query.trim()} onClick={run}>
          搜索
        </button>
      </div>
      <div className="search-hint">
        <span>提示：</span>
        <kbd>⌘/Ctrl</kbd> + <kbd>K</kbd> 随时唤起搜索 · 输入即实时检索 · 「全部」跨所有可读 Space
      </div>
      {mutation.error && <p className="error">{String((mutation.error as Error).message)}</p>}
      <div className="results">
        {query.trim() && !mutation.isPending && results.length === 0 && (
          <EmptyState icon={<Search size={32} />} title="没有匹配的结果" hint="试试更换关键词，或切换到「语义」模式，或选择「全部」范围。" />
        )}
        {results.map((r, i) => (
          <button className="result-card" key={r.pageId ?? r.id ?? i} onClick={() => r.pageId && onOpenPage(r.pageId)}>
            <div className="result-head">
              <b>{highlight(r.title, terms)}</b>
              {scope === 'workspace' && r.spaceId && <span className="tag space">{spaceName(r.spaceId)}</span>}
              {r.source && <span className="tag">{r.source === 'both' ? '关键词+语义' : r.source === 'bm25' ? '关键词' : '语义'}</span>}
              {typeof r.score === 'number' && <span className="muted small">score {r.score.toFixed(3)}</span>}
            </div>
            {(r.excerpt || r.content || r.snippet) && <p className="muted">{highlight(r.excerpt ?? r.snippet ?? r.content, terms)}</p>}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- Ask ----- */
type Citation = { chunkId?: string; pageId?: string; title: string; excerpt: string };

// Render the answer while turning inline [n] citation markers into clickable
// badges that jump to the referenced source page (strict-citation UX).
function renderAnswer(answer: string, citations: Citation[], onOpen: (pageId: string) => void) {
  const parts = answer.split(/(\[\d+\])/g);
  return parts.map((part, i) => {
    const m = part.match(/^\[(\d+)\]$/);
    if (m) {
      const c = citations[Number(m[1]) - 1];
      const pid = c?.pageId;
      return (
        <button
          key={i}
          className="cite-badge"
          title={c?.title ?? `引用 ${m[1]}`}
          onClick={() => pid && onOpen(pid)}
        >
          {m[1]}
        </button>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

function AskView({ workspace, space, onOpenPage }: { workspace: Workspace; space: Space; onOpenPage: (id: string) => void }) {
  const [query, setQuery] = useState('');
  const [extended, setExtended] = useState(false);
  const mutation = useMutation({
    mutationFn: () => post<{ answer: string; citations: Citation[] }>('/api/rag/ask', {
      workspaceId: workspace.id, spaceId: space.id, query, limit: 5, extendedThinking: extended
    })
  });
  return (
    <div className="single-pane">
      <div className="ask-head">
        <h3><Brain size={18} /> 带引用的问答 <span className="tag">strict citation</span></h3>
        <label className="switch">
          <input type="checkbox" checked={extended} onChange={(e) => setExtended(e.target.checked)} />
          扩展思考
        </label>
      </div>
      <div className="search-bar">
        <input autoFocus value={query} placeholder="向你的知识库提问…"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && query.trim()) mutation.mutate(); }} />
        <button className="primary" disabled={!query.trim() || mutation.isPending} onClick={() => mutation.mutate()}>
          {mutation.isPending ? <Loader2 className="spin" size={15} /> : <Send size={15} />} 提问
        </button>
      </div>
      {mutation.error && <p className="error">{String((mutation.error as Error).message)}</p>}
      {mutation.data && (
        <div className="answer-card">
          <p className="answer-text">{renderAnswer(mutation.data.answer, mutation.data.citations ?? [], onOpenPage)}</p>
          {mutation.data.citations?.length > 0 && (
            <>
              <h4>引用来源（点击跳转原文）</h4>
              {mutation.data.citations.map((c, i) => (
                <blockquote
                  key={c.chunkId ?? i}
                  className="citation"
                  onClick={() => c.pageId && onOpenPage(c.pageId)}
                >
                  <b>{c.title}</b> <span className="muted small">[{i + 1}]</span>
                  <span>{c.excerpt}</span>
                </blockquote>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/* ----------------------------------------------------------------- Shell ---- */
export function App() {
  const qc = useQueryClient();
  const { data: me, isLoading } = useQuery<{ user: User }>({ queryKey: ['me'], queryFn: () => api('/api/auth/me'), retry: false });
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [space, setSpace] = useState<Space | null>(null);
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null);
  const [view, setView] = useState<'notes' | 'wiki' | 'search' | 'ask' | 'graph'>('notes');
  const logout = useMutation({ mutationFn: () => post('/api/auth/logout', {}), onSuccess: () => { setWorkspace(null); setSpace(null); setSelectedPageId(null); qc.clear(); } });

  const { data: wsData } = useQuery<{ workspaces: Workspace[] }>({ queryKey: ['workspaces'], queryFn: () => api('/api/workspaces'), enabled: !!me?.user });
  const { data: spData } = useQuery<{ spaces: Space[] }>({
    queryKey: ['spaces', workspace?.id], enabled: !!workspace,
    queryFn: () => api(`/api/spaces?workspaceId=${workspace!.id}`)
  });

  // On-demand provisioning: accounts created before auto-provisioning existed
  // have no workspace. If none is found, create a default one so the user
  // still lands directly in content.
  const provision = useMutation({
    mutationFn: () => post<{ workspace: Workspace; space: Space }>('/api/workspaces/provision-default', {}),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['workspaces'] }); }
  });
  const provisionedRef = useRef(false);
  useEffect(() => {
    if (!wsData || workspace || provisionedRef.current) return;
    if (wsData.workspaces.length > 0) { provisionedRef.current = true; return; }
    provisionedRef.current = true;
    provision.mutate();
  }, [wsData, workspace, provision]);

  // First-run friendly: auto-select the first available workspace + space so
  // the user lands directly in their content instead of an empty picker.
  useEffect(() => {
    if (workspace || !wsData?.workspaces?.length) return;
    setWorkspace(wsData.workspaces[0]);
  }, [wsData, workspace]);
  useEffect(() => {
    if (space || !workspace || !spData?.spaces?.length) return;
    setSpace(spData.spaces[0]);
  }, [spData, space, workspace]);

  // Global shortcut: Cmd/Ctrl+K focuses search (application-level lookup).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (workspace && space) setView('search');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [workspace, space]);

  if (isLoading) return <div className="center"><Loader2 className="spin" size={28} /></div>;
  if (!me?.user) return <AuthPanel />;

  const NAV: { key: typeof view; label: string; icon: React.ReactNode }[] = [
    { key: 'notes', label: 'Notes', icon: <BookOpen size={18} /> },
    { key: 'wiki', label: 'LLM Wiki', icon: <Sparkles size={18} /> },
    { key: 'graph', label: '图谱', icon: <Network size={18} /> },
    { key: 'search', label: '搜索', icon: <Search size={18} /> },
    { key: 'ask', label: 'Ask', icon: <Brain size={18} /> }
  ];

  return (
    <div className="app-shell">
      <aside className="rail">
        <div className="rail-brand"><Sparkles size={20} /></div>
        {NAV.map((n) => (
          <button key={n.key} className={`rail-btn${view === n.key ? ' active' : ''}`} title={n.label} onClick={() => setView(n.key)}>
            {n.icon}<span>{n.label}</span>
          </button>
        ))}
        <div className="rail-spacer" />
        <button className="rail-btn" title="退出登录" onClick={() => logout.mutate()}><LogOut size={18} /><span>退出</span></button>
      </aside>

      <div className="main-col">
        <header className="topbar">
          <SpaceSwitcher workspace={workspace} space={space}
            onPickWorkspace={setWorkspace} onPickSpace={setSpace} />
          <div className="user-chip">{me.user.name}{me.user.isInstanceOwner && <span className="tag">Owner</span>}</div>
        </header>

        <div className="content">
          {!space && <EmptyState icon={<BookOpen size={40} />} title="选择一个 Space 开始" hint="在上方选择或创建 Workspace 与 Space。" />}
          {space && workspace && view === 'notes' && (
            <NotesView workspace={workspace} space={space} selectedPageId={selectedPageId} onSelectPage={setSelectedPageId} />
          )}
          {space && view === 'wiki' && <LlmWikiView space={space} onOpenPage={(id) => { setSelectedPageId(id); setView('notes'); }} />}
          {space && view === 'graph' && <GraphView space={space} onOpenPage={(id) => { setSelectedPageId(id); setView('notes'); }} />}
          {space && workspace && view === 'search' && <SearchView workspace={workspace} space={space} spaces={spData?.spaces ?? []} onOpenPage={(id) => { setSelectedPageId(id); setView('notes'); }} />}
          {space && workspace && view === 'ask' && <AskView workspace={workspace} space={space} onOpenPage={(id) => { setSelectedPageId(id); setView('notes'); }} />}
        </div>
      </div>
    </div>
  );
}
