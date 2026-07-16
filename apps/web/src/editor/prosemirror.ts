// Derive the searchable/LLM-facing plain text from a ProseMirror document.
// The editor's source of truth is `contentJson`; `textContent` is derived.
export type PMNode = {
  type?: string;
  text?: string;
  attrs?: Record<string, unknown>;
  content?: PMNode[];
};

// Block-level nodes that should be separated by newlines in the plain text.
const BLOCK_TYPES = new Set([
  'paragraph',
  'heading',
  'blockquote',
  'listItem',
  'taskItem',
  'bulletList',
  'orderedList',
  'taskList',
  'codeBlock',
  'table',
  'tableRow',
  'tableHeader',
  'tableCell',
  'horizontalRule',
  'callout',
  'toggle'
]);

export function extractText(node: PMNode | null | undefined): string {
  if (!node) return '';
  const out: string[] = [];
  const walk = (n: PMNode) => {
    if (n.type === 'image' && n.attrs) {
      const alt = String(n.attrs.alt ?? n.attrs.title ?? '');
      if (alt) out.push(alt);
    }
    if (n.type === 'mermaid' && n.attrs) {
      const code = String(n.attrs.code ?? '');
      if (code) out.push(code);
    }
    if ((n.type === 'video' || n.type === 'audio' || n.type === 'pdf' || n.type === 'file') && n.attrs) {
      const name = String(n.attrs.fileName ?? '');
      if (name) out.push(`[附件:${name}]`);
    }
    if ((n.type === 'mathBlock' || n.type === 'mathInline') && n.attrs) {
      const latex = String(n.attrs.latex ?? '');
      if (latex) out.push(latex);
    }
    if (n.type === 'drawio') out.push('[Draw.io 流程图]');
    if (n.type === 'excalidraw') out.push('[Excalidraw 白板]');
    if (n.type === 'toggle' && n.attrs?.summary) {
      out.push(String(n.attrs.summary));
    }
    if (typeof n.text === 'string') {
      // Inline code / links keep their text; marks don't change extraction.
      out.push(n.text);
    }
    if (Array.isArray(n.content)) {
      n.content.forEach((child) => {
        walk(child);
        if (BLOCK_TYPES.has(child.type ?? '')) {
          out.push('\n');
        } else if (child.type === 'tableCell' || child.type === 'tableHeader') {
          out.push('  ');
        }
      });
    }
  };
  walk(node);
  return out.join('').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function countWords(text: string): number {
  if (!text) return 0;
  // Count CJK characters individually and latin words by whitespace groups.
  const cjk = (text.match(/[一-鿿]/g) ?? []).length;
  const latin = (text.replace(/[一-鿿]/g, ' ').match(/[A-Za-z0-9]+/g) ?? []).length;
  return cjk + latin;
}

export const emptyDoc: PMNode = { type: 'doc', content: [{ type: 'paragraph' }] };
