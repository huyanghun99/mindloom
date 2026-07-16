import { useState } from 'react';
import { Node, mergeAttributes, NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react';
import { Link2, ExternalLink } from 'lucide-react';

function providerOf(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    if (host.includes('youtube')) return 'YouTube';
    if (host.includes('figma')) return 'Figma';
    if (host.includes('bilibili')) return 'Bilibili';
    if (host.includes('vimeo')) return 'Vimeo';
    if (host.includes('notion')) return 'Notion';
    return host || '网页';
  } catch {
    return '网页';
  }
}

function EmbedView({ node, updateAttributes }: NodeViewProps) {
  const url = (node.attrs.url as string) || '';
  const [editing, setEditing] = useState(!url);
  const [draft, setDraft] = useState(url);
  const provider = providerOf(url);
  const valid = /^https?:\/\/.+/i.test(url);

  const save = () => {
    updateAttributes({ url: draft.trim(), title: providerOf(draft.trim()) });
    setEditing(false);
  };

  return (
    <NodeViewWrapper className="embed-block" data-drag-handle>
      <div className="embed-bar" contentEditable={false}>
        <span className="embed-badge"><Link2 size={13} /> {provider}</span>
        <button type="button" className="embed-act" onMouseDown={(e) => { e.preventDefault(); setDraft(url); setEditing((v) => !v); }}>{editing ? '完成' : '编辑'}</button>
        {valid && (
          <a className="embed-act" href={url} target="_blank" rel="noopener noreferrer" onMouseDown={(e) => e.stopPropagation()}>
            <ExternalLink size={13} /> 打开
          </a>
        )}
      </div>
      {editing ? (
        <div className="embed-edit" onMouseDown={(e) => e.stopPropagation()}>
          <input className="embed-input" value={draft} placeholder="https://…"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false); }} autoFocus />
          <button className="primary sm" onMouseDown={(e) => { e.preventDefault(); save(); }}>嵌入</button>
        </div>
      ) : valid ? (
        <iframe className="embed-frame" src={url} title={provider}
          sandbox="allow-scripts allow-same-origin allow-popups allow-forms" loading="lazy" />
      ) : (
        <div className="embed-invalid">无效的嵌入地址</div>
      )}
    </NodeViewWrapper>
  );
}

export const Embed = Node.create({
  name: 'embed',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,
  addAttributes() {
    return {
      url: { default: '' },
      title: { default: '' }
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-type="embed"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'embed' })];
  },
  addNodeView() {
    return ReactNodeViewRenderer(EmbedView);
  }
});
