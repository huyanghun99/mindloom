import { and, eq, or, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { documentChunks, jobs } from '@mindloom/db';
import { env } from '../env';
import { createAiProviderForContext, isAiDisabledError, vectorToSqlLiteral, type AiProvider } from './ai.service';
import * as metrics from './job-metrics';
import { chunkText, tokenizeChineseFriendly } from '../utils/text';
import { generateWikiArtifacts } from './wiki.service';

export interface EnqueueInput {
  workspaceId?: string;
  spaceId?: string;
  entityType: string;
  entityId?: string;
  type: string;
  payload?: Record<string, unknown>;
  runAfterSeconds?: number;
  priority?: number;
  /** Page/content version captured at enqueue time. Lets the worker skip stale jobs. */
  sourceVersion?: number;
  /** Optional explicit dedupe key. Defaults to `${entityType}:${entityId}:${type}`. */
  dedupeKey?: string;
}

// The transaction client (PgTransaction) and the top-level `db` share the
// same query-builder surface, so we treat them interchangeably here.
type Executor = any;

/**
 * Enqueue a job. When `exec` (a transaction client) is supplied the insert
 * happens inside that transaction; otherwise a fresh transaction is opened.
 *
 * Dedupe: if a `dedupeKey` resolves (default = entity+type), any existing
 * *active* (pending/running) job with the same key is cancelled first, so only
 * the latest version of a page/topic stays queued. No Redis / BullMQ involved.
 */
export async function enqueueJob(input: EnqueueInput, exec: Executor = db): Promise<void> {
  const dedupeKey =
    input.dedupeKey ?? (input.entityId ? `${input.entityType}:${input.entityId}:${input.type}` : undefined);

  const doEnqueue = async (tx: Executor) => {
    if (dedupeKey) {
      await tx
        .update(jobs)
        .set({ status: 'cancelled', updatedAt: sql`now()` })
        .where(and(eq(jobs.dedupeKey, dedupeKey), or(eq(jobs.status, 'pending'), eq(jobs.status, 'running'))));
    }
    const payload: Record<string, unknown> = {
      ...(input.payload ?? {}),
      ...(input.sourceVersion != null ? { sourceVersion: input.sourceVersion } : {})
    };
    await tx.insert(jobs).values({
      workspaceId: input.workspaceId ?? null,
      spaceId: input.spaceId ?? null,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      type: input.type,
      payload,
      sourceVersion: input.sourceVersion ?? null,
      dedupeKey: dedupeKey ?? null,
      runAfter: sql`now() + (${input.runAfterSeconds ?? 0} || ' seconds')::interval`,
      priority: input.priority ?? 100
    });
  };

  if (exec === db) {
    await db.transaction(async (tx) => {
      await doEnqueue(tx);
    });
  } else {
    await doEnqueue(exec);
  }
}

async function processPageLlm(job: any) {
  const rows = await db.execute<any>(sql`SELECT * FROM pages WHERE id = ${job.entity_id} LIMIT 1`);
  const page = rows.rows[0];
  if (!page) return;

  // Stale-version guard: if the page has been updated beyond the version this
  // job captured, skip it — a newer job with the correct version will run.
  const sourceVersion: number | undefined =
    job.source_version ?? (job.payload?.sourceVersion as number | undefined);
  if (sourceVersion != null && page.content_version > sourceVersion) {
    await db.execute(
      sql`UPDATE jobs SET status='cancelled', error_message='stale version', updated_at=now() WHERE id=${job.id}`
    );
    metrics.recordSkipped(`page ${page.id} stale version (job captured ${sourceVersion}, page at ${page.content_version})`);
    return;
  }

  let ai: AiProvider;
  try {
    ai = await createAiProviderForContext({ workspaceId: page.workspace_id, spaceId: page.space_id });
  } catch (err) {
    if (isAiDisabledError(err)) {
      // disabled space: never run AI / Embedding / Wiki. Mark the page ignored
      // and the job succeeded (nothing to do) so it is not retried.
      await db.execute(
        sql`UPDATE pages SET llm_process_status='ignored', llm_processed_at=now() WHERE id=${page.id}`
      );
      await db.execute(sql`UPDATE jobs SET status='succeeded', updated_at=now() WHERE id=${job.id}`);
      metrics.recordSuccess(job.type);
      return;
    }
    throw err;
  }

  await db.execute(sql`UPDATE pages SET llm_process_status = 'processing' WHERE id = ${page.id}`);
  await db.execute(sql`DELETE FROM document_chunks WHERE page_id = ${page.id}`);

  const chunks = chunkText(page.text_content || '', 800, 150);

  // ---- Batch embedding (Phase 2 perf) ----
  // One network round-trip for the whole page instead of one-per-chunk.
  // Falls back to best-effort per-chunk embedding if the batch call fails.
  let embeddings: (number[] | null)[];
  try {
    embeddings = await ai.embedBatch(chunks);
  } catch (err) {
    console.error(
      `[index] batch embedding failed for page ${page.id}, falling back to per-chunk:`,
      err instanceof Error ? err.message : err
    );
    embeddings = await Promise.all(
      chunks.map(async (c): Promise<number[] | null> => {
        try {
          return await ai.embed(c);
        } catch (e) {
          console.error(`[index] embedding failed for chunk:`, e instanceof Error ? e.message : e);
          return null;
        }
      })
    );
  }

  const embeddingModel: string | null = env.AI_EMBEDDING_MODEL;
  const embeddingDim: number | null = env.EMBEDDING_DIMENSION;

  // ---- Batch INSERT (Phase 2 perf) ----
  // All chunks land in ONE insert statement, not N sequential writes.
  if (chunks.length > 0) {
    const values: any[] = chunks.map((content, i) => {
      const emb = embeddings[i];
      return {
        workspaceId: page.workspace_id,
        spaceId: page.space_id,
        pageId: page.id,
        chunkIndex: i,
        title: page.title,
        content,
        ftsTokens: tokenizeChineseFriendly(content),
        embedding: emb ? sql`${vectorToSqlLiteral(emb)}::vector` : null,
        embeddingModel,
        embeddingDimension: embeddingDim
      };
    });
    await db.insert(documentChunks).values(values);
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

  metrics.recordSuccess(job.type);
}

// Exponential backoff: 5s, 10s, 20s, 40s, ... capped at 5 minutes.
const BACKOFF_BASE_SECONDS = 5;
const BACKOFF_MAX_SECONDS = 300;
function backoffSeconds(attempts: number): number {
  const exp = BACKOFF_BASE_SECONDS * 2 ** Math.max(0, attempts - 1);
  return Math.min(exp, BACKOFF_MAX_SECONDS);
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

  metrics.recordProcessed();
  try {
    if (job.type === 'page.process_llm') await processPageLlm(job);
    await db.execute(sql`UPDATE jobs SET status = 'succeeded', updated_at = now() WHERE id = ${job.id}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    metrics.recordFailure({ id: job.id, type: job.type, attempts: job.attempts }, err);
    await db.execute(sql`
      UPDATE jobs
      SET status = CASE WHEN attempts >= max_attempts THEN 'failed'::job_status ELSE 'pending'::job_status END,
          error_message = ${message},
          run_after = now() + (${backoffSeconds(job.attempts)} || ' seconds')::interval,
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
