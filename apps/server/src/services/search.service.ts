import { sql } from 'drizzle-orm';
import { HybridSearchResult, RRF_K } from '@mindloom/shared';
import { db } from '../db/client';
import { createAiProvider, vectorToSqlLiteral } from './ai.service';
import { getReadableSpaceIds } from './permission.service';
import { tokenizeChineseFriendly } from '../utils/text';

interface RankedRow {
  id: string;
  page_id: string;
  space_id: string;
  title: string;
  content: string;
  score: number;
  [key: string]: unknown;
}

function rrfFuse(bm25: RankedRow[], vector: RankedRow[], limit: number): HybridSearchResult[] {
  const map = new Map<string, HybridSearchResult & { bm25Rank?: number; vectorRank?: number }>();
  for (let i = 0; i < bm25.length; i++) {
    const row = bm25[i];
    map.set(row.id, {
      id: row.id,
      pageId: row.page_id,
      spaceId: row.space_id,
      title: row.title,
      content: row.content,
      source: 'bm25',
      score: 0.4 / (RRF_K + i + 1),
      bm25Rank: i + 1
    });
  }
  for (let i = 0; i < vector.length; i++) {
    const row = vector[i];
    const existing = map.get(row.id);
    if (existing) {
      existing.source = 'both';
      existing.score += 0.6 / (RRF_K + i + 1);
      existing.vectorRank = i + 1;
    } else {
      map.set(row.id, {
        id: row.id,
        pageId: row.page_id,
        spaceId: row.space_id,
        title: row.title,
        content: row.content,
        source: 'vector',
        score: 0.6 / (RRF_K + i + 1),
        vectorRank: i + 1
      });
    }
  }
  return [...map.values()].sort((a, b) => b.score - a.score).slice(0, limit);
}

function buildExcerpt(content: string): string {
  const collapsed = content.replace(/\s+/g, ' ').trim();
  return collapsed.length > 220 ? collapsed.slice(0, 220) + '…' : collapsed;
}

export async function hybridSearch(params: {
  userId: string;
  workspaceId: string;
  spaceId?: string;
  query: string;
  limit: number;
  mode?: 'keyword' | 'vector' | 'hybrid';
}): Promise<HybridSearchResult[]> {
  const mode = params.mode ?? 'hybrid';
  const readable = params.spaceId ? [params.spaceId] : await getReadableSpaceIds(params.userId, params.workspaceId);
  if (readable.length === 0) return [];
  const ftsQuery = tokenizeChineseFriendly(params.query);

  const useKeyword = mode === 'keyword' || mode === 'hybrid';
  const useVector = mode === 'vector' || mode === 'hybrid';

  const bm25Promise: Promise<{ rows: RankedRow[] }> = useKeyword
    ? db.execute<RankedRow>(sql`
      SELECT id, page_id, space_id, title, content,
             ts_rank(to_tsvector('simple', fts_tokens), plainto_tsquery('simple', ${ftsQuery})) AS score
      FROM document_chunks
      WHERE workspace_id = ${params.workspaceId}
        AND space_id = ANY(ARRAY[${sql.join(readable.map((id) => sql`${id}::uuid`), sql`, `)}])
        AND to_tsvector('simple', fts_tokens) @@ plainto_tsquery('simple', ${ftsQuery})
      ORDER BY score DESC
      LIMIT ${params.limit * 3}
    `)
    : Promise.resolve({ rows: [] });

  const vectorPromise: Promise<{ rows: RankedRow[] }> = useVector
    ? (async () => {
        const ai = createAiProvider();
        const embedding = await ai.embed(params.query);
        const vectorLiteral = vectorToSqlLiteral(embedding);
        return db.execute<RankedRow>(sql`
          SELECT id, page_id, space_id, title, content,
                 1 - (embedding <=> ${vectorLiteral}::vector) AS score
          FROM document_chunks
          WHERE workspace_id = ${params.workspaceId}
            AND space_id = ANY(ARRAY[${sql.join(readable.map((id) => sql`${id}::uuid`), sql`, `)}])
            AND embedding IS NOT NULL
          ORDER BY embedding <=> ${vectorLiteral}::vector
          LIMIT ${params.limit * 3}
        `);
      })()
    : Promise.resolve({ rows: [] });

  const [bm25Res, vectorRes] = await Promise.allSettled([bm25Promise, vectorPromise]);
  const bm25Rows = bm25Res.status === 'fulfilled' ? bm25Res.value.rows : [];
  const vectorRows = vectorRes.status === 'fulfilled' ? vectorRes.value.rows : [];
  const fused = rrfFuse(bm25Rows, vectorRows, params.limit);
  return fused.map((r) => ({ ...r, excerpt: buildExcerpt(r.content) }));
}
