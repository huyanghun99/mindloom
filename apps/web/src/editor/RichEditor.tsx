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
import type { PMNode } from './prosemirror';
import { emptyDoc, extractText } from './prosemirror';
import { SlashCommand, type MediaKind } from './slash-command';
import { Mermaid } from './Mermaid';
import { Video, Audio, Pdf, FileCard } from './Media';
import { Callout } from './Callout';
import { Toggle } from './Toggle';
import { MathBlock, MathInline } from './Math';
import { Embed } from './Embed';
import { Drawio } from './Drawio';
import { Excalidraw } from './Excalidraw';
import { MarkdownShortcuts } from './MarkdownShortcuts';
import { BubbleMenu } from './BubbleMenu';
import { BlockHandle } from './BlockHandle';
import { useUploads, inferKind } from './useUploads';
import { UploadOverlay } from './UploadOverlay';
import { classifyUrl, isSingleUrl } from './url';
import { useToast } from '../components/Toast';

type RichEditorProps = {
  content: PMNode;
  editable?: boolean;
  workspaceId?: string;
  spaceId?: string;
  pageId?: string | null;
  onChange?: (payload: { contentJson: PMNode; textContent: string }) => void;
};

export function RichEditor({ content, editable = true, workspaceId, spaceId, pageId, onChange }: RichEditorProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<Editor | null>(null);
  const [pendingKind, setPendingKind] = useState<MediaKind>('image');
  const toast = useToast();

  const uploads = useUploads({
    getEditor: () => editorRef.current,
    workspaceId,
    spaceId,
    pageId: pageId ?? undefined,
    onError: (m) => toast.error(m)
  });
  const uploadsRef = useRef(uploads);
  uploadsRef.current = uploads;

  const openFilePicker = (kind: MediaKind) => {
    setPendingKind(kind);
    if (fileRef.current) {
      fileRef.current.accept =
        kind === 'image' ? 'image/*'
          : kind === 'video' ? 'video/*'
          : kind === 'audio' ? 'audio/*'
          : kind === 'pdf' ? 'application/pdf'
          : '*';
      fileRef.current.value = '';
      fileRef.current.click();
    }
  };

  const insertByUrl = (kind: ReturnType<typeof classifyUrl>, url: string) => {
    const ed = editorRef.current;
    if (!ed) return;
    if (kind === 'image') {
      ed.chain().focus().setImage({ src: url, alt: '' }).run();
    } else if (kind === 'video') {
      ed.chain().focus().insertContent({ type: 'video', attrs: { src: url, fileName: url, mimeType: '', size: null } }).run();
    } else if (kind === 'audio') {
      ed.chain().focus().insertContent({ type: 'audio', attrs: { src: url, fileName: url, mimeType: '', size: null } }).run();
    } else if (kind === 'embed') {
      ed.chain().focus().insertContent({ type: 'embed', attrs: { url } }).run();
    } else {
      ed.chain().focus().insertContent([
        { type: 'text', text: url, marks: [{ type: 'link', attrs: { href: url } }] }
      ]).run();
    }
  };

  const editor = useEditor({
    editable,
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Placeholder.configure({
        placeholder: '输入 “/” 唤起命令菜单，可插入标题、表格、流程图、图片等；支持 Markdown 快捷输入（#、>、-、1.、```）'
      }),
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
      SlashCommand.configure({ onPickFile: (kind) => openFilePicker(kind) }),
      MarkdownShortcuts
    ],
    content: content ?? emptyDoc,
    editorProps: {
      attributes: { class: 'prosemirror-host' },
      handlePaste: (_view, event) => {
        const cdata = (event as ClipboardEvent).clipboardData;
        const files = Array.from(cdata?.files ?? []);
        if (files.length) {
          files.forEach((f) => uploadsRef.current.start(f));
          return true;
        }
        const text = (cdata?.getData('text/plain') ?? '').trim();
        if (isSingleUrl(text)) {
          insertByUrl(classifyUrl(text), text);
          return true;
        }
        return false;
      },
      handleDrop: (_view, event) => {
        const files = Array.from(((event as DragEvent).dataTransfer?.files ?? []));
        if (files.length === 0) return false;
        event.preventDefault();
        files.forEach((f) => uploadsRef.current.start(f, inferKind(f)));
        return true;
      }
    },
    onUpdate: ({ editor: ed }) => {
      const json = ed.getJSON() as PMNode;
      onChange?.({ contentJson: json, textContent: extractText(json) });
    }
  });

  editorRef.current = editor;

  // Keep the editor in sync when the external `content` prop changes (e.g.
  // after switching pages, receiving fresh server data, or restoring a draft).
  // Compare JSON so we don't clobber the user's in-progress edits.
  useEffect(() => {
    if (!editor) return;
    const target = (content ?? emptyDoc) as PMNode;
    const current = editor.getJSON() as PMNode;
    if (JSON.stringify(current) !== JSON.stringify(target)) {
      editor.commands.setContent(target, false);
    }
  }, [content, editor]);

  if (!editor) return <div className="editor-loading">编辑器加载中…</div>;

  return (
    <div className="rich-editor">
      <EditorContent editor={editor} className="editor-content" />

      <BubbleMenu editor={editor} />
      <BlockHandle editor={editor} />

      <UploadOverlay
        items={uploads.items}
        onCancel={uploads.cancel}
        onRetry={uploads.retry}
        onDismiss={uploads.cancel}
      />

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const f = e.target.files && e.target.files[0];
          if (f) uploadsRef.current.start(f, pendingKind);
          e.target.value = '';
        }}
      />
    </div>
  );
}
