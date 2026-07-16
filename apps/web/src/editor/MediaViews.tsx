import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import { FileText, Film, Music, File as FileIcon, Download, Trash2 } from 'lucide-react';

function fmtSize(bytes?: number) {
  if (bytes == null) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function MediaFrame({ icon, title, src, kind, onRemove, children }: {
  icon: React.ReactNode; title: string; src: string; kind: string; onRemove: () => void; children?: React.ReactNode;
}) {
  return (
    <NodeViewWrapper className={`media-block media-${kind}`} data-drag-handle>
      <div className="media-toolbar" contentEditable={false}>
        <span className="media-badge">{icon}</span>
        <span className="media-name" title={title}>{title}</span>
        <a className="media-act" href={src} target="_blank" rel="noopener noreferrer" onMouseDown={(e) => e.stopPropagation()}>
          <Download size={13} /> 下载
        </a>
        <button type="button" className="media-act danger" onMouseDown={(e) => { e.preventDefault(); onRemove(); }}>
          <Trash2 size={13} /> 删除
        </button>
      </div>
      {children}
    </NodeViewWrapper>
  );
}

export function VideoView({ node, deleteNode }: NodeViewProps) {
  const src = node.attrs.src as string;
  const fileName = (node.attrs.fileName as string) || '视频';
  return (
    <MediaFrame icon={<Film size={14} />} title={fileName} src={src} kind="video" onRemove={() => deleteNode()}>
      <video className="media-video" src={src} controls preload="metadata" />
    </MediaFrame>
  );
}

export function AudioView({ node, deleteNode }: NodeViewProps) {
  const src = node.attrs.src as string;
  const fileName = (node.attrs.fileName as string) || '音频';
  return (
    <MediaFrame icon={<Music size={14} />} title={fileName} src={src} kind="audio" onRemove={() => deleteNode()}>
      <audio className="media-audio" src={src} controls preload="metadata" />
    </MediaFrame>
  );
}

export function PdfView({ node, deleteNode }: NodeViewProps) {
  const src = node.attrs.src as string;
  const fileName = (node.attrs.fileName as string) || 'PDF';
  const size = node.attrs.size as number | undefined;
  return (
    <MediaFrame icon={<FileText size={14} />} title={fileName} src={src} kind="pdf" onRemove={() => deleteNode()}>
      <div className="pdf-preview">
        <iframe className="pdf-frame" src={src} title={fileName} />
        <span className="muted small">{fmtSize(size)}</span>
      </div>
    </MediaFrame>
  );
}

export function FileCardView({ node, deleteNode }: NodeViewProps) {
  const src = node.attrs.src as string;
  const fileName = (node.attrs.fileName as string) || '文件';
  const size = node.attrs.size as number | undefined;
  const mime = (node.attrs.mimeType as string) || '';
  return (
    <MediaFrame icon={<FileIcon size={14} />} title={fileName} src={src} kind="file" onRemove={() => deleteNode()}>
      <div className="file-card">
        <div className="file-meta">
          <span className="file-mime">{mime || '未知类型'}</span>
          {size != null && <span className="muted small">{fmtSize(size)}</span>}
        </div>
      </div>
    </MediaFrame>
  );
}
