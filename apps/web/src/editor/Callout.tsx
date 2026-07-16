import { useState } from 'react';
import { Node, mergeAttributes, NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react';

const EMOJIS = ['💡', '📌', '⚠️', '✅', '❓', '🔥', '📚', '🧠', '🛠️', '📝'];
const COLORS = [
  { key: 'blue', label: '蓝', bg: '#eaf2ff', border: '#bcd4ff' },
  { key: 'green', label: '绿', bg: '#eafaf0', border: '#bce9cd' },
  { key: 'amber', label: '黄', bg: '#fff7e6', border: '#ffe0a3' },
  { key: 'red', label: '红', bg: '#fdecec', border: '#f7b8b8' },
  { key: 'purple', label: '紫', bg: '#f4ecff', border: '#d9c2ff' }
];

function CalloutView({ node, updateAttributes }: NodeViewProps) {
  const emoji = (node.attrs.emoji as string) || '💡';
  const color = (node.attrs.color as string) || 'blue';
  const palette = COLORS.find((c) => c.key === color) ?? COLORS[0];
  const [showEmoji, setShowEmoji] = useState(false);
  const [showColor, setShowColor] = useState(false);
  return (
    <NodeViewWrapper className="callout-block" data-color={color}
      style={{ background: palette.bg, borderColor: palette.border }}>
      <div className="callout-bar" contentEditable={false}>
        <button type="button" className="callout-emoji" onMouseDown={(e) => { e.preventDefault(); setShowEmoji((v) => !v); setShowColor(false); }}>
          {emoji}
        </button>
        {showEmoji && (
          <div className="callout-pop">
            {EMOJIS.map((em) => (
              <button key={em} type="button" onMouseDown={(e) => { e.preventDefault(); updateAttributes({ emoji: em }); setShowEmoji(false); }}>{em}</button>
            ))}
          </div>
        )}
        <button type="button" className="callout-color" style={{ background: palette.border }} title="配色"
          onMouseDown={(e) => { e.preventDefault(); setShowColor((v) => !v); setShowEmoji(false); }} />
        {showColor && (
          <div className="callout-pop">
            {COLORS.map((c) => (
              <button key={c.key} type="button" className="callout-swatch" style={{ background: c.bg, borderColor: c.border }}
                onMouseDown={(e) => { e.preventDefault(); updateAttributes({ color: c.key }); setShowColor(false); }} title={c.label} />
            ))}
          </div>
        )}
      </div>
      <div className="callout-content">
        <NodeViewContent className="callout-editable" />
      </div>
    </NodeViewWrapper>
  );
}

export const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,
  addAttributes() {
    return {
      emoji: { default: '💡' },
      color: { default: 'blue' }
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-type="callout"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'callout' })];
  },
  addNodeView() {
    return ReactNodeViewRenderer(CalloutView);
  }
});
