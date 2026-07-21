import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, FileText, MoreHorizontal } from 'lucide-react';
import type { TreeNode } from '../../types';

const ROW_H = 30;

interface FlatRow { node: TreeNode; depth: number; parentPageId: string | null }

function flatten(tree: TreeNode[], expanded: Set<string>, parentId: string | null = null): FlatRow[] {
  const out: FlatRow[] = [];
  const walk = (nodes: TreeNode[], depth: number, pid: string | null) => {
    for (const n of nodes) {
      out.push({ node: n, depth, parentPageId: pid });
      if (n.children.length > 0 && expanded.has(n.id)) walk(n.children, depth + 1, n.id);
    }
  };
  walk(tree, 0, parentId);
  return out;
}

/**
 * Virtualised page tree with drag-to-reorder + a per-row "⋯" / right-click
 * action menu (Phase 6 — tasks 3 & 4).
 *
 * The flat visible list is windowed (only rows in the viewport are mounted).
 * Each row is draggable; dropping onto another row inserts the dragged page as
 * a sibling right after it (same parent). A footer drop zone moves it to root.
 */
export function PageTree({
  tree,
  selectedId,
  onSelect,
  statusLabel,
  onContextMenu,
  onMore,
  onReorder
}: {
  tree: TreeNode[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  statusLabel: (s: string) => string;
  onContextMenu?: (node: TreeNode, x: number, y: number) => void;
  onMore?: (node: TreeNode, x: number, y: number) => void;
  onReorder?: (dragId: string, targetId: string | null, position: number) => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(tree.map((n) => n.id)));
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(400);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setExpanded((prev) => {
      const next = new Set(prev);
      for (const n of tree) if (!next.has(n.id)) next.add(n.id);
      return next;
    });
  }, [tree]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setViewport(el.clientHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const flat = useMemo(() => flatten(tree, expanded), [tree, expanded]);
  const total = flat.length * ROW_H;
  const start = Math.max(0, Math.floor(scrollTop / ROW_H) - 6);
  const end = Math.min(flat.length, Math.ceil((scrollTop + viewport) / ROW_H) + 6);
  const slice = flat.slice(start, end);

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  const doReorder = (targetId: string | null, position: number) => {
    if (dragId && dragId !== targetId) onReorder?.(dragId, targetId, position);
    setDragId(null);
    setOverId(null);
  };

  return (
    <div className="pages-list" ref={ref} onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}>
      <div style={{ height: total, position: 'relative' }}>
        {slice.map(({ node, depth }, i) => {
          const idx = start + i;
          const selected = node.id === selectedId;
          const open = expanded.has(node.id);
          const dragging = dragId === node.id;
          const over = overId === node.id;
          const guides = depth > 0
            ? Array.from({ length: depth }, () => 'linear-gradient(var(--border), var(--border))')
            : [];
          return (
            <div
              key={node.id}
              role="button"
              tabIndex={0}
              className={`tree-item${selected ? ' active' : ''}${dragging ? ' dragging' : ''}${over ? ' drop-over' : ''}`}
              style={{
                position: 'absolute',
                top: idx * ROW_H,
                left: 0,
                right: 0,
                height: ROW_H,
                paddingLeft: 10 + depth * 14,
                ...(guides.length
                  ? {
                      backgroundImage: guides.join(', '),
                      backgroundPosition: guides.map((_, k) => `${10 + (k + 1) * 14 - 7}px 0`).join(', '),
                      backgroundSize: '1px 100%',
                      backgroundRepeat: 'no-repeat'
                    }
                  : {})
              }}
              draggable
              onClick={() => onSelect(node.id)}
              onKeyDown={(e) => { if (e.key === 'Enter') onSelect(node.id); }}
              onContextMenu={(e) => { e.preventDefault(); onContextMenu?.(node, e.clientX, e.clientY); }}
              onDragStart={(e) => {
                setDragId(node.id);
                e.dataTransfer.effectAllowed = 'move';
                try { e.dataTransfer.setData('text/plain', node.id); } catch { /* ignore */ }
              }}
              onDragEnd={() => { setDragId(null); setOverId(null); }}
              onDragOver={(e) => {
                if (dragId && dragId !== node.id) { e.preventDefault(); setOverId(node.id); }
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (dragId && dragId !== node.id) doReorder(node.id, (node.position ?? 0) + 1);
              }}
            >
              {node.hasChildren ? (
                <span
                  className={`tree-caret${open ? ' open' : ''}`}
                  onClick={(e) => { e.stopPropagation(); toggle(node.id); }}
                >
                  <ChevronRight size={13} />
                </span>
              ) : (
                <span className="tree-caret" />
              )}
              <FileText size={14} />
              <span className="tree-title">{node.title || '未命名笔记'}</span>
              <span className={`dot status-${node.llmProcessStatus}`} title={statusLabel(node.llmProcessStatus)} />
              {onMore && (
                <button
                  className="tree-more"
                  title="更多操作"
                  onClick={(e) => {
                    e.stopPropagation();
                    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                    onMore(node, r.right, r.bottom);
                  }}
                >
                  <MoreHorizontal size={14} />
                </button>
              )}
            </div>
          );
        })}
      </div>
      {dragId && (
        <div
          className="tree-drop-root"
          onDragOver={(e) => { if (dragId) e.preventDefault(); }}
          onDrop={(e) => { e.preventDefault(); doReorder(null, 1e9); }}
        >
          拖到此处移动到根级
        </div>
      )}
    </div>
  );
}
