import { Node, ReactNodeViewRenderer } from '@tiptap/react';
import { VideoView, AudioView, PdfView, FileCardView } from './MediaViews';

function mediaNode(name: string, kind: 'video' | 'audio' | 'pdf' | 'file', View: typeof VideoView) {
  return Node.create({
    name,
    group: 'block',
    atom: true,
    draggable: true,
    selectable: true,
    addAttributes() {
      return {
        src: { default: '' },
        attachmentId: { default: null },
        fileName: { default: '' },
        mimeType: { default: '' },
        size: { default: null }
      };
    },
    parseHTML() {
      return [{ tag: `div[data-type="${kind}"]` }];
    },
    renderHTML({ HTMLAttributes }) {
      return ['div', { 'data-type': kind, ...HTMLAttributes }];
    },
    addNodeView() {
      return ReactNodeViewRenderer(View);
    }
  });
}

export const Video = mediaNode('video', 'video', VideoView);
export const Audio = mediaNode('audio', 'audio', AudioView);
export const Pdf = mediaNode('pdf', 'pdf', PdfView);
export const FileCard = mediaNode('file', 'file', FileCardView);
