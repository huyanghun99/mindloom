import { useRef, useState, useEffect } from 'react';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import TextStyle from '@tiptap/extension-text-style';
import Color from '@tiptap/extension-color';
import Highlight from '@tiptap/extension-highlight';
import Underline from '@tiptap/extension-underline';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableHeader from '@tiptap/extension-table-header';
import TableCell from '@tiptap/extension-table-cell';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import {
  Bold, Check, Code, Heading1, Heading2, Heading3, Highlighter, Image as ImageIcon, Italic, Link as LinkIcon,
  List, ListOrdered, ListChecks, Quote, Redo, Strikethrough, Table as TableIcon, Trash2, Underline as UnderlineIcon,
  Undo, Film, Music, FileText, File as FileIcon, Lightbulb, ChevronRight, Sigma, Link2, Network, PenTool
} from 'lucide-react';
import type { PMNode } from './prosemirror';
import { emptyDoc, extractText } from './prosemirror';
import { SlashCommand } from './slash-command';
import { Mermaid } from './Mermaid';
import { Video, Audio, Pdf, FileCard } from './Media';
import { Callout } from './Callout';
import { Toggle } from './Toggle';
import { MathBlock, MathInline } from './Math';
import { Embed } from './Embed';
import { Drawio } from './Drawio';
import { Excalidraw } from './Excalidraw';

type RichEditorProps = {
  content: PMNode;
  editable?: boolean;
  workspaceId?: string;
  spaceId?: string;
  pageId?: string | null;
  onChange?: (payload: { contentJson: PMNode; textContent: string }) => void;
};

const PRESET_COLORS = [
  '#1a2233', '#dc2626', '#ea580c', '#d97706', '#16a34a',
  '#0891b2', '#4f46e5', '#7c3aed', '#db2777', '#64748b'
];

const CELL_BG_COLORS = ['#ffffff', '#fef3c7', '#dcfce7', '#dbeafe', '#fce7f3', '#fee2e2', '#f1f5f9'];

function ToolbarButton({ active, disabled, onClick, title, children }: {
  active?: boolean; disabled?: boolean; onClick: () => void; title: string; children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={`tb-btn${active ? ' active' : ''}`}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      title={title}
    >
      {children}
    </button>
  );
}

function Dropdown({ label, icon, children }: { label: string; icon: React.ReactNode; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="tb-dropdown">
      <button type="button" className="tb-btn" onMouseDown={(e) => e.preventDefault()} onClick={() => setOpen((o) => !o)} title={label}>
        {icon}
      </button>
      {open && (
        <>
          <div className="tb-backdrop" onClick={() => setOpen(false)} />
          <div className="tb-menu" onMouseDown={(e) => e.preventDefault()}>{children}</div>
        </>
      )}
    </div>
  );
}

export function RichEditor({ content, editable = true, workspaceId, spaceId, pageId, onChange }: RichEditorProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<Editor | null>(null);
  const [pendingKind, setPendingKind] = useState<'image' | 'video' | 'audio' | 'pdf' | 'file'>('image');
  const [uploading, setUploading] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [selLinkOpen, setSelLinkOpen] = useState(false);
  const [selLinkUrl, setSelLinkUrl] = useState('');
  const [sel, setSel] = useState<{ top: number; left: number; show: boolean }>({ top: 0, left: 0, show: false });

  const inferKind = (file: File): 'image' | 'video' | 'audio' | 'pdf' | 'file' => {
    if (file.type.startsWith('image/')) return 'image';
    if (file.type.startsWith('video/')) return 'video';
    if (file.type.startsWith('audio/')) return 'audio';
    if (file.type === 'application/pdf') return 'pdf';
    return 'file';
  };

  const uploadAndInsert = async (file: File, kind?: 'image' | 'video' | 'audio' | 'pdf' | 'file') => {
    const ed = editorRef.current;
    if (!workspaceId || !spaceId || !pageId) {
      alert('请先保存页面，再插入附件。');
      return;
    }
    const resolved = kind ?? inferKind(file);
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('workspaceId', workspaceId);
      form.append('spaceId', spaceId);
      form.append('pageId', pageId);
      const res = await fetch('/api/attachments/upload', { method: 'POST', body: form, credentials: 'include' });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? '上传失败');
      const { attachment } = await res.json();
      const src = `/api/attachments/${attachment.id}/download`;
      if (resolved === 'image') {
        ed?.chain().focus().setImage({ src, alt: attachment.fileName }).run();
        return;
      }
      const typeMap: Record<string, string> = { video: 'video', audio: 'audio', pdf: 'pdf', file: 'file' };
      ed?.chain().focus().insertContent({
        type: typeMap[resolved],
        attrs: { src, attachmentId: attachment.id, fileName: attachment.fileName, mimeType: attachment.mimeType, size: attachment.sizeBytes }
      }).run();
    } catch (e) {
      alert('附件上传失败：' + (e as Error).message);
    } finally {
      setUploading(false);
    }
  };

  const openFilePicker = (kind: 'image' | 'video' | 'audio' | 'pdf' | 'file') => {
    setPendingKind(kind);
    if (fileRef.current) {
      fileRef.current.accept = kind === 'image' ? 'image/*' : kind === 'video' ? 'video/*' : kind === 'audio' ? 'audio/*' : kind === 'pdf' ? 'application/pdf' : '*';
      fileRef.current.value = '';
      fileRef.current.click();
    }
  };

  const uploadImage = (file: File) => uploadAndInsert(file, 'image');

  const applyLink = () => {
    const url = linkUrl.trim();
    if (!url) {
      editorRef.current?.chain().focus().extendMarkRange('link').unsetLink().run();
    } else {
      editorRef.current?.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
    }
    setLinkOpen(false);
    setLinkUrl('');
  };

  const applySelLink = () => {
    const url = selLinkUrl.trim();
    const ed = editorRef.current;
    if (!ed) return;
    if (!url) {
      ed.chain().focus().extendMarkRange('link').unsetLink().run();
    } else {
      ed.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
    }
    setSelLinkOpen(false);
    setSelLinkUrl('');
  };

  const updateSelToolbar = () => {
    const ed = editorRef.current;
    if (!ed) return;
    const { from, to, empty } = ed.state.selection;
    if (empty) { setSel((s) => ({ ...s, show: false })); return; }
    const node = ed.state.doc.nodeAt(from);
    if (node && node.type.name === 'mermaid') { setSel((s) => ({ ...s, show: false })); return; }
    try {
      const start = ed.view.coordsAtPos(from);
      const end = ed.view.coordsAtPos(to);
      setSel({ top: Math.min(start.top, end.top), left: (start.left + end.left) / 2, show: true });
    } catch {
      setSel((s) => ({ ...s, show: false }));
    }
  };

  const editor = useEditor({
    editable,
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Placeholder.configure({ placeholder: '开始输入…  输入 “/” 唤起命令菜单，可插入标题、表格、流程图、图片等' }),
      TextStyle,
      Color,
      Highlight.configure({ multicolor: true }),
      Underline,
      Link.configure({ openOnClick: false, autolink: true, HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' } }),
      Image.configure({ inline: false, allowBase64: false }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
      Mermaid,
      Video,
      Audio,
      Pdf,
      FileCard,
      Callout,
      Toggle,
      MathBlock,
      MathInline,
      Embed,
      Drawio,
      Excalidraw,
      SlashCommand.configure({ onPickFile: (kind) => openFilePicker(kind) })
    ],
    content: content ?? emptyDoc,
    editorProps: {
      attributes: { class: 'prosemirror-host' },
      handlePaste: (_view, event) => {
        const files = Array.from(event.clipboardData?.files ?? []);
        const images = files.filter((f) => f.type.startsWith('image/'));
        if (images.length === 0) return false;
        images.forEach((img) => uploadImage(img));
        return true;
      },
      handleDrop: (_view, event) => {
        const files = Array.from((event as DragEvent).dataTransfer?.files ?? []);
        const images = files.filter((f) => f.type.startsWith('image/'));
        if (images.length === 0) return false;
        event.preventDefault();
        images.forEach((img) => uploadImage(img));
        return true;
      }
    },
    onUpdate: ({ editor: ed }) => {
      const json = ed.getJSON() as PMNode;
      onChange?.({ contentJson: json, textContent: extractText(json) });
    },
    onSelectionUpdate: updateSelToolbar,
    onTransaction: updateSelToolbar
  });

  editorRef.current = editor;

  // Keep the editor in sync when the external `content` prop changes (e.g.
  // after switching pages or receiving fresh server data). Compare JSON so we
  // don't clobber the user's in-progress edits or cause cursor jumps.
  useEffect(() => {
    if (!editor) return;
    const target = (content ?? emptyDoc) as PMNode;
    const current = editor.getJSON() as PMNode;
    if (JSON.stringify(current) !== JSON.stringify(target)) {
      editor.commands.setContent(target, false);
    }
  }, [content, editor]);

  if (!editor) return <div className="editor-loading">编辑器加载中…</div>;

  const inTable = editor.isActive('table');

  return (
    <div className="rich-editor">
      <div className="editor-toolbar">
        <ToolbarButton title="撤销" onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()}><Undo size={16} /></ToolbarButton>
        <ToolbarButton title="重做" onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().redo()}><Redo size={16} /></ToolbarButton>
        <span className="tb-sep" />

        <ToolbarButton title="标题 1" active={editor.isActive('heading', { level: 1 })} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}><Heading1 size={16} /></ToolbarButton>
        <ToolbarButton title="标题 2" active={editor.isActive('heading', { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}><Heading2 size={16} /></ToolbarButton>
        <ToolbarButton title="标题 3" active={editor.isActive('heading', { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}><Heading3 size={16} /></ToolbarButton>
        <span className="tb-sep" />

        <ToolbarButton title="加粗" active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()}><Bold size={16} /></ToolbarButton>
        <ToolbarButton title="斜体" active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()}><Italic size={16} /></ToolbarButton>
        <ToolbarButton title="下划线" active={editor.isActive('underline')} onClick={() => editor.chain().focus().toggleUnderline().run()}><UnderlineIcon size={16} /></ToolbarButton>
        <ToolbarButton title="删除线" active={editor.isActive('strike')} onClick={() => editor.chain().focus().toggleStrike().run()}><Strikethrough size={16} /></ToolbarButton>
        <ToolbarButton title="行内代码" active={editor.isActive('code')} onClick={() => editor.chain().focus().toggleCode().run()}><Code size={16} /></ToolbarButton>
        <ToolbarButton title="高亮" active={editor.isActive('highlight')} onClick={() => editor.chain().focus().toggleHighlight().run()}><Highlighter size={16} /></ToolbarButton>
        <span className="tb-sep" />

        <Dropdown label="文字颜色" icon={<span className="tb-color-dot" style={{ background: editor.getAttributes('textStyle').color || 'currentColor' }} />}>
          <div className="tb-color-grid">
            {PRESET_COLORS.map((c) => (
              <button key={c} type="button" className="tb-swatch" style={{ background: c }} title={c}
                onClick={() => editor.chain().focus().setColor(c).run()} />
            ))}
          </div>
          <div className="tb-color-custom">
            <input type="color" value={editor.getAttributes('textStyle').color || '#1a2233'}
              onChange={(e) => editor.chain().focus().setColor(e.target.value).run()} />
            <button type="button" className="tb-clear" onClick={() => editor.chain().focus().unsetColor().run()}>清除颜色</button>
          </div>
        </Dropdown>
        <span className="tb-sep" />

        <ToolbarButton title="无序列表" active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()}><List size={16} /></ToolbarButton>
        <ToolbarButton title="有序列表" active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()}><ListOrdered size={16} /></ToolbarButton>
        <ToolbarButton title="任务列表" active={editor.isActive('taskList')} onClick={() => editor.chain().focus().toggleTaskList().run()}><ListChecks size={16} /></ToolbarButton>
        <ToolbarButton title="引用" active={editor.isActive('blockquote')} onClick={() => editor.chain().focus().toggleBlockquote().run()}><Quote size={16} /></ToolbarButton>
        <ToolbarButton title="代码块" active={editor.isActive('codeBlock')} onClick={() => editor.chain().focus().toggleCodeBlock().run()}><Code size={16} /></ToolbarButton>
        <span className="tb-sep" />

        <Dropdown label="表格" icon={<TableIcon size={16} />}>
          <button type="button" className="tb-menu-item" onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}>插入表格 (3×3)</button>
          <div className="tb-menu-divider" />
          <button type="button" className="tb-menu-item" disabled={!inTable} onClick={() => editor.chain().focus().addColumnBefore().run()}>在左侧加列</button>
          <button type="button" className="tb-menu-item" disabled={!inTable} onClick={() => editor.chain().focus().addColumnAfter().run()}>在右侧加列</button>
          <button type="button" className="tb-menu-item" disabled={!inTable} onClick={() => editor.chain().focus().deleteColumn().run()}>删除列</button>
          <button type="button" className="tb-menu-item" disabled={!inTable} onClick={() => editor.chain().focus().addRowBefore().run()}>在上方加行</button>
          <button type="button" className="tb-menu-item" disabled={!inTable} onClick={() => editor.chain().focus().addRowAfter().run()}>在下方加行</button>
          <button type="button" className="tb-menu-item" disabled={!inTable} onClick={() => editor.chain().focus().deleteRow().run()}>删除行</button>
          <div className="tb-menu-divider" />
          <button type="button" className="tb-menu-item" disabled={!inTable} onClick={() => editor.chain().focus().toggleHeaderRow().run()}>切换标题行</button>
          <button type="button" className="tb-menu-item" disabled={!inTable} onClick={() => editor.chain().focus().toggleHeaderColumn().run()}>切换标题列</button>
          <button type="button" className="tb-menu-item" disabled={!inTable} onClick={() => editor.chain().focus().mergeCells().run()}>合并单元格</button>
          <button type="button" className="tb-menu-item" disabled={!inTable} onClick={() => editor.chain().focus().splitCell().run()}>拆分单元格</button>
          <div className="tb-menu-divider" />
          <div className="tb-menu-label">单元格底色</div>
          <div className="tb-color-grid">
            {CELL_BG_COLORS.map((c) => (
              <button key={c} type="button" className="tb-swatch" style={{ background: c, border: c === '#ffffff' ? '1px solid #cbd5e1' : 'none' }} title={c}
                onClick={() => editor.chain().focus().setCellAttribute('background', c).run()} />
            ))}
          </div>
          <div className="tb-menu-divider" />
          <button type="button" className="tb-menu-item danger" disabled={!inTable} onClick={() => editor.chain().focus().deleteTable().run()}><Trash2 size={14} /> 删除表格</button>
        </Dropdown>

        <ToolbarButton title="链接" active={editor.isActive('link')} onClick={() => { setLinkUrl(editor.getAttributes('link').href ?? ''); setLinkOpen((o) => !o); }}><LinkIcon size={16} /></ToolbarButton>
        <ToolbarButton title={uploading ? '上传中…' : '插入图片（或粘贴/拖拽）'} onClick={() => openFilePicker('image')} disabled={uploading}><ImageIcon size={16} /></ToolbarButton>
        <Dropdown label="媒体" icon={<Film size={16} />}>
          <button type="button" className="tb-menu-item" onClick={() => openFilePicker('video')}><Film size={14} /> 视频</button>
          <button type="button" className="tb-menu-item" onClick={() => openFilePicker('audio')}><Music size={14} /> 音频</button>
          <button type="button" className="tb-menu-item" onClick={() => openFilePicker('pdf')}><FileText size={14} /> PDF</button>
          <button type="button" className="tb-menu-item" onClick={() => openFilePicker('file')}><FileIcon size={14} /> 文件</button>
        </Dropdown>
        <span className="tb-sep" />

        <ToolbarButton title="标注 Callout" onClick={() => editor.chain().focus().insertContent({ type: 'callout', content: [{ type: 'paragraph' }] }).run()}><Lightbulb size={16} /></ToolbarButton>
        <ToolbarButton title="折叠 Toggle" onClick={() => editor.chain().focus().insertContent({ type: 'toggle', attrs: { summary: '点击展开' }, content: [{ type: 'paragraph' }] }).run()}><ChevronRight size={16} /></ToolbarButton>
        <ToolbarButton title="行内公式" active={editor.isActive('mathInline')} onClick={() => editor.chain().focus().insertContent({ type: 'mathInline', attrs: { latex: 'x^2' } }).run()}><Sigma size={16} /></ToolbarButton>
        <ToolbarButton title="嵌入网页" onClick={() => editor.chain().focus().insertContent({ type: 'embed', attrs: { url: '' } }).run()}><Link2 size={16} /></ToolbarButton>
        <ToolbarButton title="Draw.io 流程图" onClick={() => editor.chain().focus().insertContent({ type: 'drawio', attrs: { xml: '', preview: '' } }).run()}><Network size={16} /></ToolbarButton>
        <ToolbarButton title="Excalidraw 白板" onClick={() => editor.chain().focus().insertContent({ type: 'excalidraw', attrs: { elements: [], appState: {}, files: {}, preview: '' } }).run()}><PenTool size={16} /></ToolbarButton>
        <ToolbarButton title="分割线" onClick={() => editor.chain().focus().setHorizontalRule().run()}><span className="tb-hr" /></ToolbarButton>

        <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadAndInsert(f, pendingKind); e.target.value = ''; }} />
      </div>

      {linkOpen && (
        <div className="link-bar">
          <input autoFocus value={linkUrl} placeholder="粘贴链接，例如 https://…"
            onChange={(e) => setLinkUrl(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') applyLink(); if (e.key === 'Escape') setLinkOpen(false); }} />
          <button className="primary" onClick={applyLink}><Check size={14} /> 应用</button>
          <button className="ghost" onClick={() => { setLinkOpen(false); setLinkUrl(''); }}>取消</button>
        </div>
      )}

      <EditorContent editor={editor} className="editor-content" />

      {sel.show && (
        <div className="sel-toolbar" style={{ top: sel.top, left: sel.left }}>
          <button type="button" className={`sel-btn${editor.isActive('bold') ? ' active' : ''}`} title="加粗" onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleBold().run(); }}><Bold size={15} /></button>
          <button type="button" className={`sel-btn${editor.isActive('italic') ? ' active' : ''}`} title="斜体" onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleItalic().run(); }}><Italic size={15} /></button>
          <button type="button" className={`sel-btn${editor.isActive('underline') ? ' active' : ''}`} title="下划线" onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleUnderline().run(); }}><UnderlineIcon size={15} /></button>
          <button type="button" className={`sel-btn${editor.isActive('strike') ? ' active' : ''}`} title="删除线" onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleStrike().run(); }}><Strikethrough size={15} /></button>
          <button type="button" className={`sel-btn${editor.isActive('code') ? ' active' : ''}`} title="行内代码" onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleCode().run(); }}><Code size={15} /></button>
          <button type="button" className={`sel-btn${editor.isActive('highlight') ? ' active' : ''}`} title="高亮" onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleHighlight().run(); }}><Highlighter size={15} /></button>
          <span className="sel-sep" />
          <button type="button" className={`sel-btn${editor.isActive('link') ? ' active' : ''}`} title="链接" onMouseDown={(e) => { e.preventDefault(); setSelLinkUrl(editor.getAttributes('link').href ?? ''); setSelLinkOpen((o) => !o); }}><LinkIcon size={15} /></button>
          {PRESET_COLORS.slice(0, 6).map((c) => (
            <button key={c} type="button" className="sel-swatch" style={{ background: c }} title="文字颜色"
              onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().setColor(c).run(); }} />
          ))}
          {selLinkOpen && (
            <div className="sel-link-bar" onMouseDown={(e) => e.stopPropagation()}>
              <input autoFocus value={selLinkUrl} placeholder="https://…"
                onChange={(e) => setSelLinkUrl(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') applySelLink(); if (e.key === 'Escape') setSelLinkOpen(false); }} />
              <button className="primary sm" onClick={applySelLink}><Check size={13} /></button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
