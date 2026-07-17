import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, FileText } from 'lucide-react';
import type { TreeNode } from '../../types';

const ROW_H = 30;

interface FlatRow { node: TreeNode; depth: number }

function flatten(tree: TreeNode[], expanded: Set<string>): FlatRow[] {
  const out: FlatRow[] = [];
  const walk = (nodes: TreeNode[], depth: number) => {
    for (const n of nodes) {
      out.push({ node: n, depth });
      if (n.children.length > 0 && expanded.has(n.id)) walk(n.children, depth + 1);
    }
  };
  walk(tree, 0);
  return out;
}

/**
 * Virtualised page tree.
 *
 * The flat visible list is rendered with a windowing technique: only the rows
 * inside the current scroll viewport (plus a small overscan) are mounted, inside
 * a spacer div sized to the full list. This keeps 10k+ nodes smooth — the
 * DOM holds a few dozen rows, not the whole forest.
 */
export function PageTree({
  tree,
  selectedId,
  onSelect,
  statusLabel
}: {
  tree: TreeNode[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  statusLabel: (s: string) => string;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(tree.map((n) => n.id)));
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(400);
  const ref = useRef<HTMLDivElement | null>(null);

  // Keep expansion in sync when a brand-new tree arrives (e.g. after create).
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

  return (
    <div className="pages-list" ref={ref} onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}>
      <div style={{ height: total, position: 'relative' }}>
        {slice.map(({ node, depth }, i) => {
          const idx = start + i;
          const selected = node.id === selectedId;
          return (
            <button
              key={node.id}
              className={`tree-item${selected ? ' active' : ''}`}
              style={{
                position: 'absolute',
                top: idx * ROW_H,
                left: 0,
                right: 0,
                height: ROW_H,
                paddingLeft: 10 + depth * 14
              }}
              onClick={() => onSelect(node.id)}
            >
              {node.hasChildren ? (
                <span
                  className="tree-caret"
                  onClick={(e) => { e.stopPropagation(); toggle(node.id); }}
                >
                  {expanded.has(node.id) ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                </span>
              ) : (
                <span className="tree-caret" />
              )}
              <FileText size={14} />
              <span className="tree-title">{node.title || '未命名笔记'}</span>
              <span className={`dot status-${node.llmProcessStatus}`} title={statusLabel(node.llmProcessStatus)} />
            </button>
          );
        })}
      </div>
    </div>
  );
}
