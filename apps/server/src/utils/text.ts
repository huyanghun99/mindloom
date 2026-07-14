const asciiWord = /[a-zA-Z0-9_]+/g;

export function tokenizeChineseFriendly(input: string): string {
  const text = input.normalize('NFKC').toLowerCase();
  const tokens: string[] = [];
  for (const match of text.matchAll(asciiWord)) tokens.push(match[0]);
  const chars = [...text].filter((c) => /[\u4e00-\u9fff]/u.test(c));
  for (let i = 0; i < chars.length; i++) {
    tokens.push(chars[i]);
    if (i + 1 < chars.length) tokens.push(chars[i] + chars[i + 1]);
    if (i + 2 < chars.length) tokens.push(chars[i] + chars[i + 1] + chars[i + 2]);
  }
  return [...new Set(tokens)].join(' ');
}

export function extractTextFromProseMirrorJson(content: unknown): string {
  const chunks: string[] = [];
  function visit(node: any) {
    if (!node || typeof node !== 'object') return;
    if (typeof node.text === 'string') chunks.push(node.text);
    if (node.attrs?.text) chunks.push(String(node.attrs.text));
    if (Array.isArray(node.content)) node.content.forEach(visit);
  }
  visit(content);
  return chunks.join('\n').trim();
}

export function chunkText(text: string, maxSize = 800, overlap = 150): string[] {
  const clean = text.trim();
  if (!clean) return [];
  const chunks: string[] = [];
  let i = 0;
  while (i < clean.length) {
    const part = clean.slice(i, i + maxSize).trim();
    if (part) chunks.push(part);
    i += Math.max(1, maxSize - overlap);
  }
  return chunks;
}
