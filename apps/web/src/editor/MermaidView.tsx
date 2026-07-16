import { useEffect, useRef, useState } from 'react';
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import mermaid from 'mermaid';

mermaid.initialize({ startOnLoad: false, theme: 'default', securityLevel: 'loose', fontFamily: 'inherit' });

let idSeq = 0;

export function MermaidView({ node, updateAttributes, selected }: NodeViewProps) {
  const code = (node.attrs.code as string) || '';
  const [svg, setSvg] = useState('');
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(code);
  const renderId = useRef(`mmd-${Date.now()}-${idSeq++}`);

  useEffect(() => {
    let cancelled = false;
    const src = code;
    if (!src.trim()) {
      setSvg('');
      setError('');
      return;
    }
    mermaid
      .render(renderId.current, src)
      .then(
        (res) => {
          if (!cancelled) {
            setSvg(res.svg);
            setError('');
          }
        },
        (err) => {
          if (!cancelled) {
            const msg = typeof err === 'string' ? err : String(err?.message ?? err);
            setError(msg);
            setSvg('');
          }
        }
      );
    return () => {
      cancelled = true;
    };
  }, [code]);

  return (
    <NodeViewWrapper
      className={`mermaid-block${selected ? ' ProseMirror-selectednode' : ''}`}
      data-drag-handle
    >
      <div className="mermaid-toolbar" contentEditable={false}>
        <span className="mermaid-badge">Mermaid</span>
        <button
          type="button"
          className="mermaid-act"
          onMouseDown={(e) => {
            e.preventDefault();
            setDraft(code);
            setEditing((v) => !v);
          }}
        >
          {editing ? '完成' : '编辑'}
        </button>
      </div>
      {editing ? (
        <textarea
          className="mermaid-editor"
          value={draft}
          spellCheck={false}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            updateAttributes({ code: draft });
            setEditing(false);
          }}
        />
      ) : (
        <div
          className="mermaid-render"
          contentEditable={false}
          onDoubleClick={() => {
            setDraft(code);
            setEditing(true);
          }}
        >
          {error ? (
            <pre className="mermaid-error">{error}</pre>
          ) : svg ? (
            <div dangerouslySetInnerHTML={{ __html: svg }} />
          ) : (
            <div className="mermaid-placeholder">渲染中…</div>
          )}
        </div>
      )}
    </NodeViewWrapper>
  );
}
