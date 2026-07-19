import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { eq, sql } from 'drizzle-orm';
import { createTopicSchema, updateTopicSchema } from '@mindloom/shared';
import { authMiddleware, type AppEnv } from '../middleware/auth';
import { db } from '../db/client';
import { pages, wikiTopics, llmSuggestions, spaces } from '@mindloom/db';
import { canEditSpace, canViewSpace, canEditPage } from '../services/permission.service';
import { getSpacePolicy } from '../services/ai.service';
import { enqueueJob } from '../services/job-runner';
import { confirmEdgesForSuggestion } from '../services/graph.service';
import { undoSuggestion } from '../services/wiki.service';

export const llmWikiRoutes = new Hono<AppEnv>();
llmWikiRoutes.use('*', authMiddleware);

llmWikiRoutes.get('/inbox', async (c) => {
  const user = c.get('user');
  const spaceId = c.req.query('spaceId');
  if (!spaceId) return c.json({ error: 'spaceId is required' }, 400);
  if (!(await canViewSpace(user.id, spaceId))) return c.json({ error: 'Forbidden' }, 403);
  const rows = await db.select().from(pages).where(sql`space_id = ${spaceId} AND llm_process_status = 'pending' AND status = 'normal'`).limit(100);
  return c.json({ inbox: rows });
});

llmWikiRoutes.post('/pages/:pageId/process-now', async (c) => {
  const user = c.get('user');
  const pageId = c.req.param('pageId');
  if (!(await canEditPage(user.id, pageId))) return c.json({ error: 'Forbidden' }, 403);
  const [page] = await db.select().from(pages).where(eq(pages.id, pageId)).limit(1);
  if (!page) return c.json({ error: 'Not found' }, 404);
  if ((await getSpacePolicy(page.spaceId)) === 'disabled') {
    return c.json({ error: 'AI is disabled for this space' }, 400);
  }
  await db.update(pages).set({ llmProcessStatus: 'pending', llmDirtyReason: 'manual_trigger', updatedAt: sql`now()` }).where(eq(pages.id, pageId));
  await enqueueJob({ workspaceId: page.workspaceId, spaceId: page.spaceId, entityType: 'page', entityId: page.id, type: 'page.process_llm', runAfterSeconds: 0, priority: 10 });
  return c.json({ ok: true });
});

// Re-process every normal page in a space: re-indexes AND regenerates Topics /
// Suggestions. Useful to backfill the LLM Wiki after the generator ships, or to
// refresh artifacts for an existing corpus.
llmWikiRoutes.post('/spaces/:spaceId/reprocess', async (c) => {
  const user = c.get('user');
  const spaceId = c.req.param('spaceId');
  if (!(await canEditSpace(user.id, spaceId))) return c.json({ error: 'Forbidden' }, 403);
  if ((await getSpacePolicy(spaceId)) === 'disabled') {
    return c.json({ error: 'AI is disabled for this space' }, 400);
  }
  const rows = await db.execute<any>(sql`
    SELECT id, workspace_id, space_id FROM pages WHERE space_id = ${spaceId} AND status = 'normal'
  `);
  for (const p of rows.rows) {
    await db.update(pages).set({ llmProcessStatus: 'pending', llmDirtyReason: 'bulk_reprocess', updatedAt: sql`now()` }).where(eq(pages.id, p.id));
    await enqueueJob({ workspaceId: p.workspace_id, spaceId: p.space_id, entityType: 'page', entityId: p.id, type: 'page.process_llm', runAfterSeconds: 0, priority: 10 });
  }
  return c.json({ ok: true, enqueued: rows.rows.length });
});

llmWikiRoutes.post('/spaces/:spaceId/pause', async (c) => {
  const user = c.get('user');
  const spaceId = c.req.param('spaceId');
  if (!(await canEditSpace(user.id, spaceId))) return c.json({ error: 'Forbidden' }, 403);
  const [updated] = await db.update(spaces).set({ autoLlmProcessing: false, updatedAt: sql`now()` }).where(eq(spaces.id, spaceId)).returning();
  if (!updated) return c.json({ error: 'Not found' }, 404);
  return c.json({ space: updated });
});

llmWikiRoutes.post('/spaces/:spaceId/resume', async (c) => {
  const user = c.get('user');
  const spaceId = c.req.param('spaceId');
  if (!(await canEditSpace(user.id, spaceId))) return c.json({ error: 'Forbidden' }, 403);
  const [updated] = await db.update(spaces).set({ autoLlmProcessing: true, updatedAt: sql`now()` }).where(eq(spaces.id, spaceId)).returning();
  if (!updated) return c.json({ error: 'Not found' }, 404);
  return c.json({ space: updated });
});

llmWikiRoutes.get('/topics', async (c) => {
  const user = c.get('user');
  const spaceId = c.req.query('spaceId');
  if (!spaceId) return c.json({ error: 'spaceId is required' }, 400);
  if (!(await canViewSpace(user.id, spaceId))) return c.json({ error: 'Forbidden' }, 403);
  const rows = await db.select().from(wikiTopics).where(eq(wikiTopics.spaceId, spaceId)).limit(100);
  return c.json({ topics: rows });
});

llmWikiRoutes.post('/topics', zValidator('json', createTopicSchema), async (c) => {
  const user = c.get('user');
  const input = c.req.valid('json');
  if (!(await canEditSpace(user.id, input.spaceId))) return c.json({ error: 'Forbidden' }, 403);
  const [topic] = await db.insert(wikiTopics).values({
    workspaceId: input.workspaceId, spaceId: input.spaceId, title: input.title,
    contentJson: input.contentJson ?? { type: 'doc', content: [] }, aiSummary: input.aiSummary ?? '',
    status: 'accepted', source: 'user_created', createdById: user.id
  }).returning();
  return c.json({ topic }, 201);
});

llmWikiRoutes.get('/topics/:topicId', async (c) => {
  const user = c.get('user');
  const [topic] = await db.select().from(wikiTopics).where(eq(wikiTopics.id, c.req.param('topicId'))).limit(1);
  if (!topic) return c.json({ error: 'Not found' }, 404);
  if (!(await canViewSpace(user.id, topic.spaceId))) return c.json({ error: 'Forbidden' }, 403);
  return c.json({ topic });
});

llmWikiRoutes.patch('/topics/:topicId', zValidator('json', updateTopicSchema), async (c) => {
  const user = c.get('user');
  const input = c.req.valid('json');
  const [topic] = await db.select().from(wikiTopics).where(eq(wikiTopics.id, c.req.param('topicId'))).limit(1);
  if (!topic) return c.json({ error: 'Not found' }, 404);
  if (!(await canEditSpace(user.id, topic.spaceId))) return c.json({ error: 'Forbidden' }, 403);
  const [updated] = await db.update(wikiTopics).set({
    ...(input.title ? { title: input.title } : {}),
    ...(input.contentJson !== undefined ? { contentJson: input.contentJson } : {}),
    ...(input.status ? { status: input.status, userEditedAt: sql`now()` } : {}),
    ...(input.updatePolicy ? { updatePolicy: input.updatePolicy } : {}),
    updatedAt: sql`now()`
  }).where(eq(wikiTopics.id, c.req.param('topicId'))).returning();
  return c.json({ topic: updated });
});

llmWikiRoutes.post('/topics/:topicId/accept', async (c) => {
  const user = c.get('user');
  const [topic] = await db.select().from(wikiTopics).where(eq(wikiTopics.id, c.req.param('topicId'))).limit(1);
  if (!topic) return c.json({ error: 'Not found' }, 404);
  if (!(await canEditSpace(user.id, topic.spaceId))) return c.json({ error: 'Forbidden' }, 403);
  const [updated] = await db.update(wikiTopics).set({ status: 'accepted', updatedAt: sql`now()` }).where(eq(wikiTopics.id, c.req.param('topicId'))).returning();
  return c.json({ topic: updated });
});

// Revert an accepted topic back to `suggested` (undo of the accept action).
llmWikiRoutes.post('/topics/:topicId/undo', async (c) => {
  const user = c.get('user');
  const [topic] = await db.select().from(wikiTopics).where(eq(wikiTopics.id, c.req.param('topicId'))).limit(1);
  if (!topic) return c.json({ error: 'Not found' }, 404);
  if (!(await canEditSpace(user.id, topic.spaceId))) return c.json({ error: 'Forbidden' }, 403);
  const [updated] = await db.update(wikiTopics).set({ status: 'suggested', updatedAt: sql`now()` }).where(eq(wikiTopics.id, c.req.param('topicId'))).returning();
  return c.json({ topic: updated });
});

// Spec §22.4: trigger refresh suggestions for a (stale) topic.
llmWikiRoutes.post('/topics/:topicId/refresh-suggestions', async (c) => {
  const user = c.get('user');
  const [topic] = await db.select().from(wikiTopics).where(eq(wikiTopics.id, c.req.param('topicId'))).limit(1);
  if (!topic) return c.json({ error: 'Not found' }, 404);
  if (!(await canEditSpace(user.id, topic.spaceId))) return c.json({ error: 'Forbidden' }, 403);
  await enqueueJob({
    workspaceId: topic.workspaceId,
    spaceId: topic.spaceId,
    entityType: 'topic',
    entityId: topic.id,
    type: 'topic.refresh_suggestions',
    runAfterSeconds: 0
  });
  return c.json({ ok: true, topicId: topic.id });
});

// Source pages that back a topic (drives the Topic Center detail view).
llmWikiRoutes.get('/topics/:topicId/sources', async (c) => {
  const user = c.get('user');
  const [topic] = await db.select().from(wikiTopics).where(eq(wikiTopics.id, c.req.param('topicId'))).limit(1);
  if (!topic) return c.json({ error: 'Not found' }, 404);
  if (!(await canViewSpace(user.id, topic.spaceId))) return c.json({ error: 'Forbidden' }, 403);
  const rows = await db.execute<any>(sql`
    SELECT p.id, p.title FROM topic_sources ts
    JOIN pages p ON p.id = ts.page_id
    WHERE ts.topic_id = ${topic.id}
    ORDER BY p.updated_at DESC LIMIT 50
  `);
  return c.json({ sources: rows.rows });
});

llmWikiRoutes.get('/suggestions', async (c) => {
  const user = c.get('user');
  const spaceId = c.req.query('spaceId');
  if (!spaceId) return c.json({ error: 'spaceId is required' }, 400);
  if (!(await canViewSpace(user.id, spaceId))) return c.json({ error: 'Forbidden' }, 403);
  const pageId = c.req.query('pageId');
  const where = pageId
    ? sql`space_id = ${spaceId} AND status = 'pending' AND page_id = ${pageId}::uuid`
    : sql`space_id = ${spaceId} AND status = 'pending'`;
  const rows = await db.select().from(llmSuggestions).where(where).limit(200);
  return c.json({ suggestions: rows });
});

llmWikiRoutes.post('/suggestions/:id/accept', async (c) => {
  const user = c.get('user');
  const [suggestion] = await db.select().from(llmSuggestions).where(eq(llmSuggestions.id, c.req.param('id'))).limit(1);
  if (!suggestion) return c.json({ error: 'Not found' }, 404);
  if (!(await canEditSpace(user.id, suggestion.spaceId))) return c.json({ error: 'Forbidden' }, 403);
  const [updated] = await db.update(llmSuggestions).set({ status: 'accepted', updatedAt: sql`now()` }).where(eq(llmSuggestions.id, c.req.param('id'))).returning();
  // M6: accepting a cross-link / topic proposal confirms the implied graph edge.
  try { await confirmEdgesForSuggestion(updated as unknown as { type: string; payload: Record<string, unknown> }); } catch { /* non-fatal */ }
  return c.json({ suggestion: updated });
});

llmWikiRoutes.post('/suggestions/:id/ignore', async (c) => {
  const user = c.get('user');
  const [suggestion] = await db.select().from(llmSuggestions).where(eq(llmSuggestions.id, c.req.param('id'))).limit(1);
  if (!suggestion) return c.json({ error: 'Not found' }, 404);
  if (!(await canEditSpace(user.id, suggestion.spaceId))) return c.json({ error: 'Forbidden' }, 403);
  const [updated] = await db.update(llmSuggestions).set({ status: 'ignored', updatedAt: sql`now()` }).where(eq(llmSuggestions.id, c.req.param('id'))).returning();
  return c.json({ suggestion: updated });
});

// Revert a previously accepted suggestion. Restores the suggestion to
// `pending` and undoes the side-effect it caused (topic / edge). Keeps
// every AI-driven change reversible (trustworthy-AI acceptance criterion).
llmWikiRoutes.post('/suggestions/:id/undo', async (c) => {
  const user = c.get('user');
  const [suggestion] = await db.select().from(llmSuggestions).where(eq(llmSuggestions.id, c.req.param('id'))).limit(1);
  if (!suggestion) return c.json({ error: 'Not found' }, 404);
  if (!(await canEditSpace(user.id, suggestion.spaceId))) return c.json({ error: 'Forbidden' }, 403);
  await undoSuggestion(c.req.param('id'));
  const [updated] = await db.select().from(llmSuggestions).where(eq(llmSuggestions.id, c.req.param('id'))).limit(1);
  return c.json({ suggestion: updated });
});

llmWikiRoutes.post('/suggestions/bulk-accept', async (c) => {
  const user = c.get('user');
  const body = await c.req.json<{ spaceId: string; ids: string[] }>();
  if (!(await canEditSpace(user.id, body.spaceId))) return c.json({ error: 'Forbidden' }, 403);
  const rows = await db.execute<any>(sql`SELECT type, payload FROM llm_suggestions WHERE space_id = ${body.spaceId} AND id = ANY(${body.ids}::uuid[])`);
  await db.execute(sql`UPDATE llm_suggestions SET status = 'accepted', updated_at = now() WHERE space_id = ${body.spaceId} AND id = ANY(${body.ids}::uuid[])`);
  // M6: confirm the implied graph edges for each accepted suggestion.
  for (const r of rows.rows) {
    try { await confirmEdgesForSuggestion(r as { type: string; payload: Record<string, unknown> }); } catch { /* non-fatal */ }
  }
  return c.json({ ok: true });
});
