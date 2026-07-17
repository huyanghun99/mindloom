import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookOpen, Loader2, PanelRight } from 'lucide-react';
import { api, post } from './api';
import { GraphView } from './GraphView';
import { ShareView } from './ShareView';
import { AuthPanel } from './features/auth/AuthPanel';
import { LeftSidebar } from './features/shell/LeftSidebar';
import { TopBar } from './features/shell/TopBar';
import { RightPanel } from './features/shell/RightPanel';
import { HomeView } from './features/home/HomeView';
import { PageEditor } from './features/notes/PageEditor';
import { WikiView } from './features/wiki/WikiView';
import { SearchView } from './features/search/SearchView';
import { AskView } from './features/ask/AskView';
import { CommandPalette } from './components/CommandPalette';
import { EmptyState } from './components/EmptyState';
import { emptyDoc } from './editor/prosemirror';
import type { MainRoute, PageDetail, Space, TreeNode, User, Workspace } from './types';

export function App() {
  // Public share pages are reachable without auth (standalone route).
  const shareMatch = typeof window !== 'undefined' ? window.location.pathname.match(/^\/share\/(.+)$/) : null;
  if (shareMatch) return <ShareView token={shareMatch[1]} />;

  const qc = useQueryClient();
  const { data: me, isLoading } = useQuery<{ user: User }>({ queryKey: ['me'], queryFn: () => api('/api/auth/me'), retry: false });

  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [space, setSpace] = useState<Space | null>(null);
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null);
  const [route, setRoute] = useState<MainRoute>('home');
  const [rightOpen, setRightOpen] = useState(true);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const logout = useMutation({
    mutationFn: () => post('/api/auth/logout', {}),
    onSuccess: () => { setWorkspace(null); setSpace(null); setSelectedPageId(null); setRoute('home'); qc.clear(); }
  });

  const { data: wsData } = useQuery<{ workspaces: Workspace[] }>({ queryKey: ['workspaces'], queryFn: () => api('/api/workspaces'), enabled: !!me?.user });
  const { data: spData } = useQuery<{ spaces: Space[] }>({
    queryKey: ['spaces', workspace?.id], enabled: !!workspace,
    queryFn: () => api(`/api/spaces?workspaceId=${workspace!.id}`)
  });

  // On-demand provisioning for accounts with no workspace yet.
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

  useEffect(() => {
    if (workspace || !wsData?.workspaces?.length) return;
    setWorkspace(wsData.workspaces[0]);
  }, [wsData, workspace]);
  useEffect(() => {
    if (space || !workspace || !spData?.spaces?.length) return;
    setSpace(spData.spaces[0]);
  }, [spData, space, workspace]);

  // Cmd/Ctrl+K opens the command palette (unified search + commands).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const openPage = useCallback((id: string) => {
    if (!id) { setSelectedPageId(null); setRoute('home'); return; }
    setSelectedPageId(id);
    setRoute('page');
    setRightOpen(true);
  }, []);

  const navigate = useCallback((r: MainRoute) => {
    setRoute(r);
    if (r !== 'page') setSelectedPageId(null);
  }, []);

  const createPage = useMutation({
    mutationFn: () => post<{ page: PageDetail }>('/api/pages', { spaceId: space!.id, title: '未命名笔记', contentJson: emptyDoc, textContent: '' }),
    onSuccess: async (res) => { await qc.invalidateQueries({ queryKey: ['page-tree', space!.id] }); openPage(res.page.id); }
  });

  const runSearch = useCallback((q: string) => { setSearchQuery(q); setRoute('search'); setSelectedPageId(null); }, []);

  // Current-space tree used by the command palette for instant title search.
  const { data: treeData } = useQuery<{ tree: TreeNode[] }>({
    queryKey: ['page-tree', space?.id], enabled: !!space,
    queryFn: () => api(`/api/pages/tree?spaceId=${space!.id}`)
  });

  if (isLoading) return <div className="loading-screen"><Loader2 className="spin" size={28} /></div>;
  if (!me?.user) return <AuthPanel />;

  const spaces = spData?.spaces ?? [];
  const workspaces = wsData?.workspaces ?? [];

  return (
    <div className="app-shell-3">
      <LeftSidebar
        me={me.user}
        workspace={workspace}
        workspaces={workspaces}
        space={space}
        spaces={spaces}
        route={route}
        selectedPageId={selectedPageId}
        onPickWorkspace={(w) => { setWorkspace(w); setRoute('home'); }}
        onPickSpace={(s) => { setSpace(s); setRoute('home'); setSelectedPageId(null); }}
        onSelectPage={openPage}
        onNavigate={navigate}
        onNewNote={() => space && createPage.mutate()}
        onLogout={() => logout.mutate()}
      />

      <div className="main-col">
        <TopBar
          workspace={workspace}
          space={space}
          route={route}
          pageTitle={null}
          onOpenPalette={() => setPaletteOpen(true)}
          onNavigateHome={() => navigate('home')}
        />

        <div className="center-and-right">
          <div className="center">
            {!space && (
              <EmptyState icon={<BookOpen size={40} />} title="选择一个空间开始" hint="在左侧选择或创建知识库与空间。" />
            )}
            {space && workspace && route === 'home' && (
              <HomeView workspace={workspace} space={space} onSelectPage={openPage} onNavigate={navigate} onNewNote={() => createPage.mutate()} />
            )}
            {space && workspace && route === 'page' && selectedPageId && (
              <PageEditor workspace={workspace} space={space} pageId={selectedPageId} onSelectPage={openPage} />
            )}
            {space && workspace && route === 'page' && !selectedPageId && (
              <EmptyState icon={<BookOpen size={40} />} title="选择或新建一篇笔记" hint="从左侧页面列表选择，或点击 + 新建。" />
            )}
            {space && route === 'organize' && (
              <WikiView space={space} onOpenPage={openPage} />
            )}
            {space && workspace && route === 'search' && (
              <SearchView workspace={workspace} space={space} spaces={spaces} initialQuery={searchQuery} onOpenPage={openPage} />
            )}
            {space && workspace && route === 'ask' && (
              <AskView workspace={workspace} space={space} onOpenPage={openPage} />
            )}
            {space && route === 'map' && (
              <GraphView space={space} onOpenPage={openPage} />
            )}
          </div>

          {space && workspace && route === 'page' && selectedPageId && rightOpen && (
            <RightPanel workspace={workspace} space={space} pageId={selectedPageId} onOpenPage={openPage} onClose={() => setRightOpen(false)} />
          )}
          {space && route === 'page' && selectedPageId && !rightOpen && (
            <button className="right-reopen" title="展开侧栏" onClick={() => setRightOpen(true)}><PanelRight size={16} /></button>
          )}
        </div>
      </div>

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        tree={treeData?.tree ?? []}
        onSelectPage={openPage}
        onNavigate={navigate}
        onNewNote={() => space && createPage.mutate()}
        onRunSearch={runSearch}
      />
    </div>
  );
}
