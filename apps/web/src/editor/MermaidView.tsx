import { useEffect, useRef, useState } from 'react';
import { type NodeViewProps } from '@tiptap/react';
import mermaid from 'mermaid';
import { Pencil } from 'lucide-react';
import { BlockFrame } from './BlockFrame';

mermaid.initialize({ startOnLoad: false, theme: 'default', securityLevel: 'loose', fontFamily: 'inherit' });

let idSeq = 0;

export function MermaidView({ node, updateAttributes, selected, deleteNode }: NodeViewProps) {
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

  const actions = (
    <button type="button" className="ml-block-action" onMouseDown={(e) => { e.preventDefault(); setDraft(code); setEditing((v) => !v); }}>
      <Pencil size={13} /> {editing ? '完成' : '编辑'}
    </button>
  );

  return (
    <BlockFrame label="流程图" kind="mermaid" id={node.attrs.id} selected={selected} onDelete={() => deleteNode?.()} actions={actions}>
      {editing ? (
        <textarea
          className="mermaid-editor"
          value={draft}
          spellCheck={false}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => { updateAttributes({ code: draft }); setEditing(false); }}
        />
      ) : (
        <div
          className="mermaid-render"
          contentEditable={false}
          onDoubleClick={() => { setDraft(code); setEditing(true); }}
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
    </BlockFrame>
  );
}
