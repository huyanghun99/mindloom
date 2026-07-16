import { Node, mergeAttributes, ReactNodeViewRenderer } from '@tiptap/react';
import { ExcalidrawView } from './ExcalidrawView';

export const Excalidraw = Node.create({
  name: 'excalidraw',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      elements: {
        default: [],
        parseHTML: (el) => {
          try {
            return JSON.parse(el.getAttribute('data-elements') || '[]');
          } catch {
            return [];
          }
        },
        renderHTML: (attrs) => ({ 'data-elements': JSON.stringify(attrs.elements ?? []) })
      },
      appState: {
        default: {},
        parseHTML: (el) => {
          try {
            return JSON.parse(el.getAttribute('data-appstate') || '{}');
          } catch {
            return {};
          }
        },
        renderHTML: (attrs) => ({ 'data-appstate': JSON.stringify(attrs.appState ?? {}) })
      },
      files: {
        default: {},
        parseHTML: (el) => {
          try {
            return JSON.parse(el.getAttribute('data-files') || '{}');
          } catch {
            return {};
          }
        },
        renderHTML: (attrs) => ({ 'data-files': JSON.stringify(attrs.files ?? {}) })
      },
      preview: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-preview') ?? '',
        renderHTML: (attrs) => ({ 'data-preview': attrs.preview ?? '' })
      }
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="excalidraw"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'excalidraw' })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(ExcalidrawView);
  }
});
