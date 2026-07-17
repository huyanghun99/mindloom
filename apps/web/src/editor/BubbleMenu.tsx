import { useCallback, useEffect, useRef, useState } from 'react';
import { type Editor } from '@tiptap/react';
import {
  Bold, Italic, Underline as UnderlineIcon, Strikethrough, Code, Highlighter,
  Link as LinkIcon, Check
} from 'lucide-react';

const PRESET_COLORS = ['#1a2233', '#dc2626', '#ea580c', '#d97706', '#16a34a', '#0891b2'];

// Block / atom nodes that own their own UI — the bubble menu should not
// cover them with a text-formatting bar.
const NON_TEXT = new Set([
  'mermaid', 'embed', 'drawio', 'excalidraw', 'image', 'video',
  'audio', 'pdf', 'file', 'mathBlock', 'mathInline', 'callout', 'toggle'
]);

/**
 * Bubble Menu (Phase4 — task 3).
 *
 * Appears only while a range of *text* is selected (never on a single
 * collapsed cursor, never over an advanced block that has its own UI). Provides
 * the core inline formatting plus a link editor. All actions use
 * onMouseDown + preventDefault so the editor selection is preserved.
 */
export function BubbleMenu({ editor }: { editor: Editor }) {
  const ref = useRef<HTMLDivElement>(null);
  const [show, setShow] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [active, setActive] = useState({ bold: false, italic: false, underline: false, strike: false, code: false, highlight: false, link: false });

  const update = useCallback(() => {
    const { from, to, empty } = editor.state.selection;
    if (empty) {
      setShow(false);
      return;
    }
    const node = editor.state.doc.nodeAt(from);
    if (node && NON_TEXT.has(node.type.name)) {
      setShow(false);
      return;
    }
    try {
      const start = editor.view.coordsAtPos(from);
      const end = editor.view.coordsAtPos(to);
      const el = ref.current;
      if (!el) return;
      el.style.top = `${Math.min(start.top, end.top)}px`;
      el.style.left = `${(start.left + end.left) / 2}px`;
      setActive({
        bold: editor.isActive('bold'),
        italic: editor.isActive('italic'),
        underline: editor.isActive('underline'),
        strike: editor.isActive('strike'),
        code: editor.isActive('code'),
        highlight: editor.isActive('highlight'),
        link: editor.isActive('link')
      });
      setShow(true);
    } catch {
      setShow(false);
    }
  }, [editor]);

  useEffect(() => {
    editor.on('selectionUpdate', update);
    editor.on('transaction', update);
    return () => {
      editor.off('selectionUpdate', update);
      editor.off('transaction', update);
    };
  }, [editor, update]);

  useEffect(() => {
    const hide = () => setShow(false);
    window.addEventListener('scroll', hide, true);
    return () => window.removeEventListener('scroll', hide, true);
  }, []);

  if (!show) return null;

  const stop = (e: React.MouseEvent) => e.preventDefault();

  const applyLink = () => {
    const url = linkUrl.trim();
    if (!url) {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
    } else {
      editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
    }
    setLinkOpen(false);
    setLinkUrl('');
  };

  return (
    <div ref={ref} className="bubble-menu" style={{ display: 'flex' }}>
      <button type="button" className={`bub-btn${active.bold ? ' active' : ''}`} title="加粗" onMouseDown={stop} onClick={() => editor.chain().focus().toggleBold().run()}><Bold size={15} /></button>
      <button type="button" className={`bub-btn${active.italic ? ' active' : ''}`} title="斜体" onMouseDown={stop} onClick={() => editor.chain().focus().toggleItalic().run()}><Italic size={15} /></button>
      <button type="button" className={`bub-btn${active.underline ? ' active' : ''}`} title="下划线" onMouseDown={stop} onClick={() => editor.chain().focus().toggleUnderline().run()}><UnderlineIcon size={15} /></button>
      <button type="button" className={`bub-btn${active.strike ? ' active' : ''}`} title="删除线" onMouseDown={stop} onClick={() => editor.chain().focus().toggleStrike().run()}><Strikethrough size={15} /></button>
      <button type="button" className={`bub-btn${active.code ? ' active' : ''}`} title="行内代码" onMouseDown={stop} onClick={() => editor.chain().focus().toggleCode().run()}><Code size={15} /></button>
      <button type="button" className={`bub-btn${active.highlight ? ' active' : ''}`} title="高亮" onMouseDown={stop} onClick={() => editor.chain().focus().toggleHighlight().run()}><Highlighter size={15} /></button>
      <span className="bub-sep" />
      {PRESET_COLORS.slice(0, 6).map((c) => (
        <button key={c} type="button" className="bub-swatch" style={{ background: c }} title="文字颜色" onMouseDown={stop} onClick={() => editor.chain().focus().setColor(c).run()} />
      ))}
      <span className="bub-sep" />
      <button type="button" className={`bub-btn${active.link ? ' active' : ''}`} title="链接" onMouseDown={stop} onClick={() => { setLinkUrl(editor.getAttributes('link').href ?? ''); setLinkOpen((o) => !o); }}><LinkIcon size={15} /></button>

      {linkOpen && (
        <div className="bub-link-bar" onMouseDown={(e) => e.stopPropagation()}>
          <input
            autoFocus
            value={linkUrl}
            placeholder="https://…"
            onChange={(e) => setLinkUrl(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') applyLink(); if (e.key === 'Escape') { setLinkOpen(false); setLinkUrl(''); } }}
          />
          <button className="primary sm" onMouseDown={stop} onClick={applyLink}><Check size={13} /></button>
        </div>
      )}
    </div>
  );
}
