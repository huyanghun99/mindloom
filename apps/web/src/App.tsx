import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookOpen, Brain, Network, Search, Send, Sparkles } from 'lucide-react';
import { api, post, put } from './api';

type User = { id: string; email: string; name: string; isInstanceOwner: boolean };
type Workspace = { id: string; name: string; role?: string };
type Space = { id: string; name: string; workspaceId: string; role?: string };
type Page = { id: string; title: string; textContent: string; contentVersion: number; llmProcessStatus: string };

function AuthPanel() {
  const qc = useQueryClient();
  const [mode, setMode] = useState<'login' | 'register'>('register');
  const [name, setName] = useState('Mason');
  const [email, setEmail] = useState('mason@example.com');
  const [password, setPassword] = useState('mindloom123');
  const mutation = useMutation({
    mutationFn: () => post('/api/auth/' + mode, mode === 'register' ? { name, email, password } : { email, password }),
    onSuccess: () => qc.invalidateQueries()
  });
  return <section className="card auth-card">
    <h1>MindLoom 知织</h1>
    <p>个人笔记 + LLM Wiki 的知识创作系统。</p>
    {mode === 'register' && <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" />}
    <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" />
    <input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" type="password" />
    <button onClick={() => mutation.mutate()}>{mode === 'register' ? '创建账号' : '登录'}</button>
    <button className="link" onClick={() => setMode(mode === 'register' ? 'login' : 'register')}>{mode === 'register' ? '已有账号？登录' : '没有账号？注册'}</button>
    {mutation.error && <p className="error">{String(mutation.error.message)}</p>}
  </section>;
}

function WorkspaceSetup({ onSelect }: { onSelect: (w: Workspace) => void }) {
  const qc = useQueryClient();
  const { data } = useQuery<{ workspaces: Workspace[] }>({ queryKey: ['workspaces'], queryFn: () => api('/api/workspaces') });
  const [name, setName] = useState('我的知识库');
  const createWorkspace = useMutation({
    mutationFn: () => post<{ workspace: Workspace }>('/api/workspaces', { name }),
    onSuccess: async (res) => { await qc.invalidateQueries({ queryKey: ['workspaces'] }); onSelect(res.workspace); }
  });
  return <section className="card">
    <h2>Workspace</h2>
    <div className="row">
      <input value={name} onChange={(e) => setName(e.target.value)} />
      <button onClick={() => createWorkspace.mutate()}>新建 Workspace</button>
    </div>
    <div className="list">
      {(data?.workspaces ?? []).map((w) => <button key={w.id} onClick={() => onSelect(w)}>{w.name}</button>)}
    </div>
  </section>;
}

function SpaceSetup({ workspace, onSelect }: { workspace: Workspace; onSelect: (s: Space) => void }) {
  const qc = useQueryClient();
  const { data } = useQuery<{ spaces: Space[] }>({ queryKey: ['spaces', workspace.id], queryFn: () => api(`/api/spaces?workspaceId=${workspace.id}`) });
  const [name, setName] = useState('默认 Space');
  const createSpace = useMutation({
    mutationFn: () => post<{ space: Space }>('/api/spaces', { workspaceId: workspace.id, name, aiPrivacyPolicy: 'inherit_workspace' }),
    onSuccess: async (res) => { await qc.invalidateQueries({ queryKey: ['spaces', workspace.id] }); onSelect(res.space); }
  });
  return <section className="card">
    <h2>{workspace.name} / Space</h2>
    <div className="row">
      <input value={name} onChange={(e) => setName(e.target.value)} />
      <button onClick={() => createSpace.mutate()}>新建 Space</button>
    </div>
    <div className="list">
      {(data?.spaces ?? []).map((s) => <button key={s.id} onClick={() => onSelect(s)}>{s.name}</button>)}
    </div>
  </section>;
}

function NotesView({ workspace, space }: { workspace: Workspace; space: Space }) {
  const qc = useQueryClient();
  const { data } = useQuery<{ pages: Page[] }>({ queryKey: ['pages', space.id], queryFn: () => api(`/api/pages?spaceId=${space.id}`) });
  const [selected, setSelected] = useState<Page | null>(null);
  const [title, setTitle] = useState('新笔记');
  const [text, setText] = useState('这是第一条中文笔记。MindLoom 会提取文本、分块、向量化，并进入 LLM Inbox。');
  const createPage = useMutation({
    mutationFn: () => post<{ page: Page }>('/api/pages', { workspaceId: workspace.id, spaceId: space.id, title, textContent: text, contentJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] } }),
    onSuccess: async (res) => { setSelected(res.page); await qc.invalidateQueries({ queryKey: ['pages', space.id] }); }
  });
  const updatePage = useMutation({
    mutationFn: () => selected ? put<{ page: Page }>(`/api/pages/${selected.id}`, { title, textContent: text, contentJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] }, contentVersion: selected.contentVersion }) : Promise.reject(new Error('No page selected')),
    onSuccess: async (res) => { setSelected(res.page); await qc.invalidateQueries({ queryKey: ['pages', space.id] }); }
  });
  const load = (p: Page) => { setSelected(p); setTitle(p.title); setText(p.textContent); };
  return <div className="workspace-grid">
    <aside className="sidebar">
      <h3>Notes</h3>
      {(data?.pages ?? []).map((p) => <button key={p.id} onClick={() => load(p)} className={selected?.id === p.id ? 'active' : ''}>{p.title}<small>{p.llmProcessStatus}</small></button>)}
    </aside>
    <main className="editor card">
      <input className="title-input" value={title} onChange={(e) => setTitle(e.target.value)} />
      <textarea value={text} onChange={(e) => setText(e.target.value)} />
      <div className="row">
        <button onClick={() => createPage.mutate()}>创建页面</button>
        <button onClick={() => updatePage.mutate()} disabled={!selected}>保存当前页</button>
        <button onClick={() => window.print()}>打印 PDF</button>
      </div>
      <div className="hint">高级编辑器扩展合同已在 packages/editor 中定义。此 starter 用轻量 textarea 占位，便于先跑通数据、搜索、RAG 和 LLM Wiki。</div>
    </main>
  </div>;
}

function LlmWikiView({ space }: { space: Space }) {
  const { data: inbox } = useQuery<{ inbox: Page[] }>({ queryKey: ['inbox', space.id], queryFn: () => api(`/api/llm-wiki/inbox?spaceId=${space.id}`) });
  const { data: topics } = useQuery<{ topics: any[] }>({ queryKey: ['topics', space.id], queryFn: () => api(`/api/llm-wiki/topics?spaceId=${space.id}`) });
  return <div className="grid2">
    <section className="card">
      <h3><Sparkles size={18} /> LLM Inbox</h3>
      {(inbox?.inbox ?? []).map((p) => <div className="item" key={p.id}><b>{p.title}</b><span>{p.llmProcessStatus}</span></div>)}
    </section>
    <section className="card">
      <h3><Network size={18} /> Topics</h3>
      {(topics?.topics ?? []).map((t) => <div className="item" key={t.id}><b>{t.title}</b><span>{t.status}</span></div>)}
      {(topics?.topics ?? []).length === 0 && <p className="hint">Topic 生成逻辑留在 LLM Wiki milestone 中继续完善。</p>}
    </section>
  </div>;
}

function AskView({ workspace, space }: { workspace: Workspace; space: Space }) {
  const [query, setQuery] = useState('我的知识库里关于 MindLoom 的内容是什么？');
  const [answer, setAnswer] = useState<any>(null);
  const mutation = useMutation({
    mutationFn: () => post('/api/rag/ask', { workspaceId: workspace.id, spaceId: space.id, query, limit: 5, extendedThinking: false }),
    onSuccess: setAnswer
  });
  return <section className="card">
    <h3><Brain size={18} /> Ask with citations</h3>
    <div className="row">
      <input value={query} onChange={(e) => setQuery(e.target.value)} />
      <button onClick={() => mutation.mutate()}><Send size={16} /> 提问</button>
    </div>
    {answer && <div className="answer"><p>{answer.answer}</p><h4>Citations</h4>{answer.citations?.map((c: any) => <blockquote key={c.chunkId}>{c.title}: {c.excerpt}</blockquote>)}</div>}
  </section>;
}

export function App() {
  const { data: me, isLoading } = useQuery<{ user: User }>({ queryKey: ['me'], queryFn: () => api('/api/auth/me'), retry: false });
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [space, setSpace] = useState<Space | null>(null);
  const [view, setView] = useState<'notes' | 'wiki' | 'ask'>('notes');
  const title = useMemo(() => workspace && space ? `${workspace.name} / ${space.name}` : 'MindLoom 知织', [workspace, space]);
  if (isLoading) return <div className="center">Loading...</div>;
  if (!me?.user) return <AuthPanel />;
  return <div className="app-shell">
    <header>
      <div><strong>{title}</strong><span>Personal LLM Wiki</span></div>
      {space && <nav>
        <button onClick={() => setView('notes')} className={view === 'notes' ? 'active' : ''}><BookOpen size={16} /> Notes</button>
        <button onClick={() => setView('wiki')} className={view === 'wiki' ? 'active' : ''}><Sparkles size={16} /> LLM Wiki</button>
        <button onClick={() => setView('ask')} className={view === 'ask' ? 'active' : ''}><Search size={16} /> Ask</button>
      </nav>}
    </header>
    {!workspace && <WorkspaceSetup onSelect={setWorkspace} />}
    {workspace && !space && <SpaceSetup workspace={workspace} onSelect={setSpace} />}
    {workspace && space && view === 'notes' && <NotesView workspace={workspace} space={space} />}
    {workspace && space && view === 'wiki' && <LlmWikiView space={space} />}
    {workspace && space && view === 'ask' && <AskView workspace={workspace} space={space} />}
  </div>;
}
