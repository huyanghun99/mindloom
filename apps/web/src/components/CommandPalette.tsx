import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Brain, CornerDownLeft, FileText, Home, LayoutGrid, PenLine, Search, Wand2
} from 'lucide-react';
import type { MainRoute, TreeNode } from '../types';

function flatten(tree: TreeNode[]): TreeNode[] {
  const out: TreeNode[] = [];
  const walk = (nodes: TreeNode[]) => { for (const n of nodes) { out.push(n); walk(n.children); } };
  walk(tree);
  return out;
}

type Item =
  | { kind: 'page'; id: string; title: string }
  | { kind: 'command'; id: string; title: string; icon: React.ReactNode; run: () => void }
  | { kind: 'search'; id: string; title: string };

/**
 * Command Palette (Phase 3) — the unified "search or run a command" surface,
 * opened with ⌘/Ctrl+K. Ties notes, organize, search and ask together so they
 * feel like one product rather than separate screens.
 */
export function CommandPalette({
  open, onClose, tree, onSelectPage, onNavigate, onNewNote, onRunSearch
}: {
  open: boolean;
  onClose: () => void;
  tree: TreeNode[];
  onSelectPage: (id: string) => void;
  onNavigate: (r: MainRoute) => void;
  onNewNote: () => void;
  onRunSearch: (q: string) => void;
}) {
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) { setQ(''); setActive(0); setTimeout(() => inputRef.current?.focus(), 20); }
  }, [open]);

  const flat = useMemo(() => flatten(tree), [tree]);

  const commands = useMemo<Item[]>(() => [
    { kind: 'command', id: 'new', title: '新建笔记', icon: <PenLine size={15} />, run: onNewNote },
    { kind: 'command', id: 'home', title: '前往首页', icon: <Home size={15} />, run: () => onNavigate('home') },
    { kind: 'command', id: 'organize', title: '前往智能整理', icon: <Wand2 size={15} />, run: () => onNavigate('organize') },
    { kind: 'command', id: 'ask', title: '前往知识问答', icon: <Brain size={15} />, run: () => onNavigate('ask') },
    { kind: 'command', id: 'map', title: '前往关系图', icon: <LayoutGrid size={15} />, run: () => onNavigate('map') }
  ], [onNavigate, onNewNote]);

  const items = useMemo<Item[]>(() => {
    const query = q.trim().toLowerCase();
    if (!query) return commands;
    const pageHits: Item[] = flat
      .filter((n) => (n.title || '').toLowerCase().includes(query))
      .slice(0, 8)
      .map((n) => ({ kind: 'page', id: n.id, title: n.title || '未命名笔记' }));
    const cmdHits = commands.filter((c) => c.title.toLowerCase().includes(query));
    return [
      ...pageHits,
      ...cmdHits,
      { kind: 'search', id: 'search', title: `在全部笔记中搜索「${q.trim()}」` }
    ];
  }, [q, flat, commands]);

  useEffect(() => { setActive(0); }, [q]);

  if (!open) return null;

  const choose = (item: Item) => {
    if (item.kind === 'page') onSelectPage(item.id);
    else if (item.kind === 'command') item.run();
    else onRunSearch(q.trim());
    onClose();
  };

  return (
    <div className="cmdk-backdrop" onClick={onClose}>
      <div className="cmdk" onClick={(e) => e.stopPropagation()}>
        <div className="cmdk-input">
          <Search size={17} />
          <input
            ref={inputRef}
            value={q}
            placeholder="搜索笔记，或输入命令…"
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, items.length - 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
              else if (e.key === 'Enter') { e.preventDefault(); if (items[active]) choose(items[active]); }
              else if (e.key === 'Escape') onClose();
            }}
          />
          <kbd>Esc</kbd>
        </div>
        <div className="cmdk-list">
          {items.length === 0 && <div className="cmdk-empty">没有匹配项</div>}
          {items.map((item, i) => (
            <button
              key={`${item.kind}-${item.id}`}
              className={`cmdk-item${i === active ? ' active' : ''}`}
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(item)}
            >
              <span className="cmdk-item-icon">
                {item.kind === 'page' ? <FileText size={15} />
                  : item.kind === 'search' ? <Search size={15} />
                  : (item as { icon: React.ReactNode }).icon}
              </span>
              <span className="cmdk-item-title">{item.title}</span>
              {i === active && <CornerDownLeft size={13} className="cmdk-enter" />}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
