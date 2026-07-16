import { Node, mergeAttributes, ReactNodeViewRenderer } from '@tiptap/react';
import { DrawioView } from './DrawioView';

export const Drawio = Node.create({
  name: 'drawio',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      xml: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-xml') ?? '',
        renderHTML: (attrs) => ({ 'data-xml': attrs.xml ?? '' })
      },
      preview: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-preview') ?? '',
        renderHTML: (attrs) => ({ 'data-preview': attrs.preview ?? '' })
      }
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="drawio"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'drawio' })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(DrawioView);
  }
});
