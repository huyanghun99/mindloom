import { useState } from 'react';
import { Node, mergeAttributes, NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react';
import katex from 'katex';

function renderLatex(latex: string, display: boolean): string {
  try {
    return katex.renderToString(latex || '', { displayMode: display, throwOnError: false, output: 'html' });
  } catch {
    return `<span class="math-error">${latex}</span>`;
  }
}

function MathBlockView({ node, updateAttributes }: NodeViewProps) {
  const latex = (node.attrs.latex as string) || '';
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(latex);
  const html = renderLatex(latex, true);
  return (
    <NodeViewWrapper className="math-block" data-drag-handle>
      <div className="math-toolbar" contentEditable={false}>
        <span className="math-badge">公式</span>
        <button type="button" className="math-act" onMouseDown={(e) => { e.preventDefault(); setDraft(latex); setEditing((v) => !v); }}>{editing ? '完成' : '编辑'}</button>
      </div>
      {editing ? (
        <textarea className="math-editor" value={draft} spellCheck={false}
          placeholder="E = mc^2"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => { updateAttributes({ latex: draft }); setEditing(false); }} />
      ) : (
        <div className="math-render" contentEditable={false}
          onDoubleClick={() => { setDraft(latex); setEditing(true); }}
          dangerouslySetInnerHTML={{ __html: html }} />
      )}
    </NodeViewWrapper>
  );
}

function MathInlineView({ node, updateAttributes }: NodeViewProps) {
  const latex = (node.attrs.latex as string) || '';
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(latex);
  const html = renderLatex(latex, false);
  return (
    <NodeViewWrapper className="math-inline" as="span" data-drag-handle>
      {editing ? (
        <input className="math-inline-editor" value={draft} spellCheck={false}
          onBlur={() => { updateAttributes({ latex: draft }); setEditing(false); }}
          onChange={(e) => setDraft(e.target.value)} autoFocus />
      ) : (
        <span className="math-inline-render" contentEditable={false} onDoubleClick={() => { setDraft(latex); setEditing(true); }}
          dangerouslySetInnerHTML={{ __html: html }} />
      )}
    </NodeViewWrapper>
  );
}

export const MathBlock = Node.create({
  name: 'mathBlock',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,
  addAttributes() {
    return { latex: { default: 'E = mc^2' } };
  },
  parseHTML() {
    return [{ tag: 'div[data-type="mathBlock"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'mathBlock' })];
  },
  addNodeView() {
    return ReactNodeViewRenderer(MathBlockView);
  }
});

export const MathInline = Node.create({
  name: 'mathInline',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return { latex: { default: '' } };
  },
  parseHTML() {
    return [{ tag: 'span[data-type="mathInline"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-type': 'mathInline' })];
  },
  addNodeView() {
    return ReactNodeViewRenderer(MathInlineView);
  }
});
