import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BookOpen, Brain, ChevronDown, Clock, Download, FileText, Home, LayoutGrid,
  LogOut, Pencil, Plus, Search, Sparkles, Star, Trash2, Wand2
} from 'lucide-react';
import { api, del, patch, post } from '../../api';
import { useToast } from '../../components/Toast';
import { useDialog } from '../../components/Dialog';
import { useFavorites } from '../../hooks/useFavorites';
import { useAdaptivePolling } from '../../hooks/useAdaptivePolling';
import { PageTree } from '../notes/PageTree';
import type { MainRoute, Space, TreeNode, User, Workspace } from '../../types';

const STATUS_LABEL: Record<string, string> = {
  pending: '待整理', processing: '整理中', done: '已整理', processed: '已整理',
  failed: '整理失败', skipped: '已跳过', ignored: '未整理'
};

function flatten(tree: TreeNode[]): TreeNode[] {
  const out: TreeNode[] = [];
  const walk = (nodes: TreeNode[]) => { for (const n of nodes) { out.push(n); walk(n.children); } };
  walk(tree);
  return out;
}

export function LeftSidebar({
  me, workspace, workspaces, space, spaces, route, selectedPageId,
  onPickWorkspace, onPickSpace, onSelectPage, onNavigate, onNewNote, onLogout
}: {
  me: User;
  workspace: Workspace | null;
  workspaces: Workspace[];
  space: Space | null;
  spaces: Space[];
  route: MainRoute;
  selectedPageId: string | null;
  onPickWorkspace: (w: Workspace | null) => void;
  onPickSpace: (s: Space | null) => void;
  onSelectPage: (id: string) => void;
  onNavigate: (r: MainRoute) => void;
  onNewNote: () => void;
  onLogout: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const dialog = useDialog();
  const { favorites } = useFavorites();

  const [wsOpen, setWsOpen] = useState(false);
  const [wsName, setWsName] = useState('');
  const [spName, setSpName] = useState('');
  const [addingSpace, setAddingSpace] = useState(false);

  const { data: treeData, isLoading: treeLoading } = useQuery<{ tree: TreeNode[] }>({
    queryKey: ['page-tree', space?.id], enabled: !!space,
    queryFn: () => api(`/api/pages/tree?spaceId=${space!.id}`)
  });
  const tree = treeData?.tree ?? [];
  const flat = useMemo(() => flatten(tree), [tree]);

  // "待整理" badge count with adaptive polling (jargon-free label for the inbox).
  const { data: inboxData } = useQuery<{ inbox: unknown[] }>({
    queryKey: ['inbox', space?.id], enabled: !!space,
    queryFn: () => api(`/api/llm-wiki/inbox?spaceId=${space!.id}`),
    refetchInterval: useAdaptivePolling({ enabled: !!space, hasActivity: false })
  });
  const inboxCount = inboxData?.inbox?.length ?? 0;

  const recent = useMemo(
    () => [...flat].sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '')).slice(0, 5),
    [flat]
  );
  const favPages = useMemo(() => flat.filter((n) => favorites.has(n.id)).slice(0, 8), [flat, favorites]);

  /* ---- workspace / space CRUD (no native confirm) ---- */
  const createWs = useMutation({
    mutationFn: () => post<{ workspace: Workspace }>('/api/workspaces', { name: wsName || '我的知识库' }),
    onSuccess: async (r) => { setWsName(''); setWsOpen(false); await qc.invalidateQueries({ queryKey: ['workspaces'] }); onPickWorkspace(r.workspace); onPickSpace(null); toast.success('已创建知识库'); }
  });
  const renameWs = useMutation({
    mutationFn: (name: string) => patch(`/api/workspaces/${workspace!.id}`, { name }),
    onSuccess: async (_r, name) => { await qc.invalidateQueries({ queryKey: ['workspaces'] }); onPickWorkspace({ ...workspace!, name }); }
  });
  const deleteWs = useMutation({
    mutationFn: () => del(`/api/workspaces/${workspace!.id}`),
    onSuccess: async () => { await qc.invalidateQueries({ queryKey: ['workspaces'] }); onPickWorkspace(null); onPickSpace(null); toast.success('已删除知识库'); }
  });
  const createSp = useMutation({
    mutationFn: () => post<{ space: Space }>('/api/spaces', { workspaceId: workspace!.id, name: spName || '新空间', aiPrivacyPolicy: 'inherit_workspace' }),
    onSuccess: async (r) => { setSpName(''); setAddingSpace(false); await qc.invalidateQueries({ queryKey: ['spaces', workspace!.id] }); onPickSpace(r.space); toast.success('已创建空间'); }
  });
  const renameSp = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => patch(`/api/spaces/${id}`, { name }),
    onSuccess: async () => { await qc.invalidateQueries({ queryKey: ['spaces', workspace!.id] }); }
  });
  const deleteSp = useMutation({
    mutationFn: (id: string) => del(`/api/spaces/${id}`),
    onSuccess: async (_r, id) => {
      await qc.invalidateQueries({ queryKey: ['spaces', workspace!.id] });
      if (space?.id === id) onPickSpace(spaces.find((s) => s.id !== id) ?? null);
      toast.success('已删除空间');
    }
  });

  const askRename = async (kind: 'ws' | 'sp', cur: { id: string; name: string }) => {
    const next = await dialog.prompt({
      title: kind === 'ws' ? '重命名知识库' : '重命名空间',
      defaultValue: cur.name,
      placeholder: '输入新名称',
      confirmText: '保存'
    });
    if (next && next !== cur.name) {
      if (kind === 'ws') renameWs.mutate(next);
      else renameSp.mutate({ id: cur.id, name: next });
    }
  };

  const askDeleteWs = async () => {
    if (!workspace) return;
    const ok = await dialog.confirm({ title: `删除知识库「${workspace.name}」？`, message: '其中所有空间与笔记都会被删除，此操作不可撤销。', confirmText: '删除', danger: true });
    if (ok) deleteWs.mutate();
  };
  const askDeleteSp = async (s: Space) => {
    const ok = await dialog.confirm({ title: `删除空间「${s.name}」？`, message: '其中所有笔记都会被删除，此操作不可撤销。', confirmText: '删除', danger: true });
    if (ok) deleteSp.mutate(s.id);
  };
  const exportSpace = async (s: Space) => {
    try {
      const res = await post<{ markdown: string }>(`/api/export/space/${s.id}`, {});
      const blob = new Blob([res.markdown], { type: 'text/markdown;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `${s.name || 'space'}.md`; a.click();
      URL.revokeObjectURL(url);
    } catch (e) { toast.error(`导出失败：${(e as Error).message}`); }
  };

  const NAV: { key: MainRoute; label: string; icon: React.ReactNode; badge?: number }[] = [
    { key: 'home', label: '首页', icon: <Home size={16} /> },
    { key: 'organize', label: '智能整理', icon: <Wand2 size={16} />, badge: inboxCount },
    { key: 'search', label: '搜索', icon: <Search size={16} /> },
    { key: 'ask', label: '知识问答', icon: <Brain size={16} /> },
    { key: 'map', label: '关系图', icon: <LayoutGrid size={16} /> }
  ];

  return (
    <aside className="sidebar">
      {/* Knowledge base (workspace) */}
      <div className="sb-brand">
        <div className="sb-brand-mark"><Sparkles size={18} /></div>
        <div className="sb-ws">
          <button className="sb-ws-trigger" onClick={() => setWsOpen((o) => !o)}>
            <span className="sb-ws-name">{workspace?.name ?? '选择知识库'}</span>
            <ChevronDown size={14} />
          </button>
          {wsOpen && (
            <>
              <div className="sb-backdrop" onClick={() => setWsOpen(false)} />
              <div className="sb-menu">
                {workspaces.map((w) => (
                  <button key={w.id} className={`sb-menu-item${workspace?.id === w.id ? ' active' : ''}`}
                    onClick={() => { onPickWorkspace(w); onPickSpace(null); setWsOpen(false); }}>
                    <BookOpen size={14} /> {w.name}
                  </button>
                ))}
                {workspace && (
                  <div className="sb-menu-row">
                    <button className="sb-mini" onClick={() => askRename('ws', workspace)}><Pencil size={12} /> 重命名</button>
                    <button className="sb-mini danger" onClick={askDeleteWs}><Trash2 size={12} /> 删除</button>
                  </div>
                )}
                <div className="sb-new">
                  <input value={wsName} placeholder="新建知识库" onChange={(e) => setWsName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && createWs.mutate()} />
                  <button className="icon-btn" onClick={() => createWs.mutate()}><Plus size={14} /></button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="sb-scroll">
        {/* Primary navigation */}
        <nav className="sb-nav">
          {NAV.map((n) => (
            <button key={n.key} className={`sb-nav-item${route === n.key ? ' active' : ''}`} onClick={() => onNavigate(n.key)}>
              {n.icon}<span>{n.label}</span>
              {n.badge ? <span className="sb-badge">{n.badge}</span> : null}
            </button>
          ))}
        </nav>

        {/* Recent */}
        {recent.length > 0 && (
          <div className="sb-section">
            <div className="sb-section-head"><Clock size={13} /> 最近</div>
            {recent.map((n) => (
              <button key={n.id} className={`sb-link${selectedPageId === n.id && route === 'page' ? ' active' : ''}`} onClick={() => onSelectPage(n.id)}>
                <FileText size={14} /> <span className="sb-link-title">{n.title || '未命名笔记'}</span>
              </button>
            ))}
          </div>
        )}

        {/* Favorites */}
        {favPages.length > 0 && (
          <div className="sb-section">
            <div className="sb-section-head"><Star size={13} /> 收藏</div>
            {favPages.map((n) => (
              <button key={n.id} className={`sb-link${selectedPageId === n.id && route === 'page' ? ' active' : ''}`} onClick={() => onSelectPage(n.id)}>
                <Star size={13} fill="currentColor" /> <span className="sb-link-title">{n.title || '未命名笔记'}</span>
              </button>
            ))}
          </div>
        )}

        {/* Spaces */}
        <div className="sb-section">
          <div className="sb-section-head">
            <span><LayoutGrid size={13} /> 空间</span>
            <button className="icon-btn sb-section-add" title="新建空间" onClick={() => setAddingSpace((v) => !v)}><Plus size={13} /></button>
          </div>
          {addingSpace && (
            <div className="sb-new">
              <input autoFocus value={spName} placeholder="新空间名称" onChange={(e) => setSpName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && createSp.mutate()} />
              <button className="icon-btn" onClick={() => createSp.mutate()}><Plus size={14} /></button>
            </div>
          )}
          {spaces.map((s) => (
            <div key={s.id} className={`sb-space-row${space?.id === s.id ? ' active' : ''}`}>
              <button className="sb-link sb-space-btn" onClick={() => { onPickSpace(s); }}>
                <BookOpen size={14} /> <span className="sb-link-title">{s.name}</span>
              </button>
              <div className="sb-space-actions">
                <button className="icon-btn" title="导出" onClick={() => exportSpace(s)}><Download size={12} /></button>
                <button className="icon-btn" title="重命名" onClick={() => askRename('sp', s)}><Pencil size={12} /></button>
                <button className="icon-btn danger" title="删除" onClick={() => askDeleteSp(s)}><Trash2 size={12} /></button>
              </div>
            </div>
          ))}
        </div>

        {/* Page tree for the current space */}
        {space && (
          <div className="sb-section sb-tree-section">
            <div className="sb-section-head">
              <span><FileText size={13} /> 页面 {tree.length > 0 && <em>{flat.length}</em>}</span>
              <button className="icon-btn sb-section-add" title="新建笔记" onClick={onNewNote}><Plus size={13} /></button>
            </div>
            {treeLoading && <div className="muted small sb-pad">加载中…</div>}
            {!treeLoading && tree.length === 0 && <div className="muted small sb-pad">还没有笔记，点击 + 新建</div>}
            {!treeLoading && tree.length > 0 && (
              <div className="sb-tree">
                <PageTree
                  tree={tree}
                  selectedId={route === 'page' ? selectedPageId : null}
                  onSelect={onSelectPage}
                  statusLabel={(s) => STATUS_LABEL[s] ?? s}
                />
              </div>
            )}
          </div>
        )}
      </div>

      <div className="sb-foot">
        <span className="sb-user">{me.name}{me.isInstanceOwner && <span className="tag">Owner</span>}</span>
        <button className="icon-btn" title="退出登录" onClick={onLogout}><LogOut size={15} /></button>
      </div>
    </aside>
  );
}
