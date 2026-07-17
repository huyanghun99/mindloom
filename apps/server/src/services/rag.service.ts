import { Citation, RagAnswer } from '@mindloom/shared';
import { createAiProviderForContext } from './ai.service';
import { hybridSearch } from './search.service';

export async function askRag(params: {
  userId: string;
  workspaceId: string;
  spaceId?: string;
  query: string;
  limit: number;
  extendedThinking: boolean;
}): Promise<RagAnswer> {
  const results = await hybridSearch(params);
  if (results.length === 0) {
    return { answer: '知识库中未找到相关信息。', citations: [], usedExtendedThinking: false };
  }

  const context = results.map((r, i) => `[${i + 1}] ${r.title}\n${r.content}`).join('\n\n');
  // Every RAG call goes through the context-aware provider so the Space AI
  // policy (local_only / disabled) is always honoured.
  const ai = await createAiProviderForContext({
    workspaceId: params.workspaceId,
    spaceId: params.spaceId,
    userId: params.userId
  });
  const answer = await ai.generateText([
    { role: 'system', content: 'You answer strictly from the provided knowledge base context. Cite sources using [1], [2]. If context is insufficient, say so clearly.' },
    { role: 'user', content: `Context:\n${context}\n\nQuestion:\n${params.query}` }
  ]);

  const citations: Citation[] = results.map((r) => ({
    pageId: r.pageId,
    chunkId: r.id,
    title: r.title,
    excerpt: r.content.slice(0, 260),
    score: r.score
  }));

  return { answer, citations, usedExtendedThinking: params.extendedThinking };
}
