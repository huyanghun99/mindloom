import { sql } from 'drizzle-orm';
import { db } from '../db/client';
import { env } from '../env';
import { createAiProvider, vectorToSqlLiteral } from './ai.service';
import { chunkText, tokenizeChineseFriendly } from '../utils/text';
import { generateWikiArtifacts } from './wiki.service';

export async function enqueueJob(input: {
  workspaceId?: string;
  spaceId?: string;
  entityType: string;
  entityId?: string;
  type: string;
  payload?: Record<string, unknown>;
  runAfterSeconds?: number;
  priority?: number;
}) {
  await db.execute(sql`
    INSERT INTO jobs(workspace_id, space_id, entity_type, entity_id, type, payload, run_after, priority)
    VALUES (${input.workspaceId ?? null}, ${input.spaceId ?? null}, ${input.entityType}, ${input.entityId ?? null}, ${input.type}, ${JSON.stringify(input.payload ?? {})}::jsonb, now() + (${input.runAfterSeconds ?? 0} || ' seconds')::interval, ${input.priority ?? 100})
  `);
}

async function processPageLlm(job: any) {
  const rows = await db.execute<any>(sql`SELECT * FROM pages WHERE id = ${job.entity_id} LIMIT 1`);
  const page = rows.rows[0];
  if (!page) return;

  await db.execute(sql`UPDATE pages SET llm_process_status = 'processing' WHERE id = ${page.id}`);
  await db.execute(sql`DELETE FROM document_chunks WHERE page_id = ${page.id}`);

  const ai = createAiProvider();
  const chunks = chunkText(page.text_content || '', 800, 150);
  let embeddedCount = 0;
  for (let i = 0; i < chunks.length; i++) {
    const content = chunks[i];
    // Embedding is best-effort: if the vectorization endpoint is unreachable
    // or errors, we still index the chunk with BM25 tokens so keyword/FTS
    // search keeps working. Semantic (vector) search simply skips it.
    let embeddingExpr: unknown = null;
    // Always record the intended model/dimension (NOT NULL columns); the
    // vector itself stays NULL when embedding fails, and vector search simply
    // skips those rows via `embedding IS NOT NULL`.
    let embeddingModel: string | null = env.AI_EMBEDDING_MODEL;
    let embeddingDim: number | null = env.EMBEDDING_DIMENSION;
    try {
      const embedding = await ai.embed(content);
      embeddingExpr = sql`${vectorToSqlLiteral(embedding)}::vector`;
      embeddedCount++;
    } catch (err) {
      console.error(
        `[index] embedding failed for page ${page.id} chunk ${i}:`,
        err instanceof Error ? err.message : err
      );
    }
    await db.execute(sql`
      INSERT INTO document_chunks(workspace_id, space_id, page_id, chunk_index, title, content, fts_tokens, embedding, embedding_model, embedding_dimension)
      VALUES (${page.workspace_id}, ${page.space_id}, ${page.id}, ${i}, ${page.title}, ${content}, ${tokenizeChineseFriendly(content)}, ${embeddingExpr}, ${embeddingModel}, ${embeddingDim})
    `);
  }

  const summary = page.text_content ? page.text_content.slice(0, 240) : '';
  await db.execute(sql`
    INSERT INTO page_ai_profiles(page_id, workspace_id, space_id, summary, tags, keywords, entities, model)
    VALUES (${page.id}, ${page.workspace_id}, ${page.space_id}, ${summary}, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, 'mock')
    ON CONFLICT(page_id) DO UPDATE SET summary = excluded.summary, updated_at = now()
  `);

  await db.execute(sql`UPDATE pages SET llm_process_status = 'processed', llm_processed_at = now() WHERE id = ${page.id}`);

  // M5: derive candidate Topics + Suggestions from the processed page. Best
  // effort — never let a wiki-generation failure break the indexing pipeline.
  try {
    await generateWikiArtifacts(page, ai);
  } catch (err) {
    console.error(
      `[wiki] artifact generation failed for page ${page.id}:`,
      err instanceof Error ? err.message : err
    );
  }
}

export async function runOneJob(workerId = `worker-${process.pid}`): Promise<boolean> {
  const locked = await db.execute<any>(sql`
    WITH next_job AS (
      SELECT id FROM jobs
      WHERE status = 'pending' AND run_after <= now()
      ORDER BY priority ASC, created_at ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    UPDATE jobs
    SET status = 'running', locked_by = ${workerId}, locked_at = now(), attempts = attempts + 1
    WHERE id IN (SELECT id FROM next_job)
    RETURNING *
  `);
  const job = locked.rows[0];
  if (!job) return false;

  try {
    if (job.type === 'page.process_llm') await processPageLlm(job);
    await db.execute(sql`UPDATE jobs SET status = 'succeeded', updated_at = now() WHERE id = ${job.id}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.execute(sql`
      UPDATE jobs
      SET status = CASE WHEN attempts >= max_attempts THEN 'failed'::job_status ELSE 'pending'::job_status END,
          error_message = ${message},
          run_after = now() + interval '60 seconds',
          updated_at = now()
      WHERE id = ${job.id}
    `);
  }
  return true;
}

export function startJobRunner() {
  if (process.env.NODE_ENV === 'test') return;
  setInterval(() => {
    runOneJob().catch((err) => console.error('job runner error', err));
  }, 3000).unref();
}
