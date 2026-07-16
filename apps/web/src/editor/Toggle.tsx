import { useState } from 'react';
import { Node, mergeAttributes, NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react';
import { ChevronDown, ChevronRight } from 'lucide-react';

function ToggleView({ node, updateAttributes }: NodeViewProps) {
  const [open, setOpen] = useState(true);
  const summary = (node.attrs.summary as string) || '';
  return (
    <NodeViewWrapper className="toggle-block">
      <div className="toggle-head" contentEditable={false}>
        <button type="button" className="toggle-chevron" onMouseDown={(e) => { e.preventDefault(); setOpen((v) => !v); }}>
          {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </button>
        <input
          className="toggle-summary"
          value={summary}
          placeholder="折叠标题…"
          onMouseDown={(e) => e.stopPropagation()}
          onChange={(e) => updateAttributes({ summary: e.target.value })}
        />
      </div>
      {open && (
        <div className="toggle-content">
          <NodeViewContent className="toggle-editable" />
        </div>
      )}
    </NodeViewWrapper>
  );
}

export const Toggle = Node.create({
  name: 'toggle',
  group: 'block',
  content: 'block+',
  defining: true,
  addAttributes() {
    return { summary: { default: '' } };
  },
  parseHTML() {
    return [{ tag: 'div[data-type="toggle"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'toggle' })];
  },
  addNodeView() {
    return ReactNodeViewRenderer(ToggleView);
  }
});
