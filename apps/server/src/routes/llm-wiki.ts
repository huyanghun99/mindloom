import { Hono } from 'hono';
import { eq, sql } from 'drizzle-orm';
import { authMiddleware } from '../middleware/auth';
import { db } from '../db/client';
import { pages, wikiTopics, llmSuggestions } from '../db/schema';
import { canEditSpace, canViewSpace } from '../services/permission.service';
import { getEvidenceCard, getGraphForEntity } from '../services/graph.service';

export const llmWikiRoutes = new Hono();
llmWikiRoutes.use('*', authMiddleware);

llmWikiRoutes.get('/inbox', async (c) => {
  const user = c.get('user');
  const spaceId = c.req.query('spaceId');
  if (!spaceId) return c.json({ error: 'spaceId is required' }, 400);
  if (!(await canViewSpace(user.id, spaceId))) return c.json({ error: 'Forbidden' }, 403);
  const rows = await db.select().from(pages).where(sql`space_id = ${spaceId} AND llm_process_status = 'pending' AND status = 'normal'`).limit(100);
  return c.json({ inbox: rows });
});

llmWikiRoutes.get('/topics', async (c) => {
  const user = c.get('user');
  const spaceId = c.req.query('spaceId');
  if (!spaceId) return c.json({ error: 'spaceId is required' }, 400);
  if (!(await canViewSpace(user.id, spaceId))) return c.json({ error: 'Forbidden' }, 403);
  const rows = await db.select().from(wikiTopics).where(eq(wikiTopics.spaceId, spaceId)).limit(100);
  return c.json({ topics: rows });
});

llmWikiRoutes.post('/topics/:topicId/accept', async (c) => {
  const user = c.get('user');
  const topicId = c.req.param('topicId');
  const [topic] = await db.select().from(wikiTopics).where(eq(wikiTopics.id, topicId)).limit(1);
  if (!topic) return c.json({ error: 'Not found' }, 404);
  if (!(await canEditSpace(user.id, topic.spaceId))) return c.json({ error: 'Forbidden' }, 403);
  const [updated] = await db.update(wikiTopics).set({ status: 'accepted', updatedAt: sql`now()` }).where(eq(wikiTopics.id, topicId)).returning();
  return c.json({ topic: updated });
});

llmWikiRoutes.get('/suggestions', async (c) => {
  const user = c.get('user');
  const spaceId = c.req.query('spaceId');
  if (!spaceId) return c.json({ error: 'spaceId is required' }, 400);
  if (!(await canViewSpace(user.id, spaceId))) return c.json({ error: 'Forbidden' }, 403);
  const rows = await db.select().from(llmSuggestions).where(sql`space_id = ${spaceId} AND status = 'pending'`).limit(200);
  return c.json({ suggestions: rows });
});

llmWikiRoutes.post('/suggestions/bulk-accept', async (c) => {
  const user = c.get('user');
  const body = await c.req.json<{ spaceId: string; ids: string[] }>();
  if (!(await canEditSpace(user.id, body.spaceId))) return c.json({ error: 'Forbidden' }, 403);
  await db.execute(sql`UPDATE llm_suggestions SET status = 'accepted', updated_at = now() WHERE space_id = ${body.spaceId} AND id = ANY(${body.ids}::uuid[])`);
  return c.json({ ok: true });
});

llmWikiRoutes.get('/graph', async (c) => {
  const user = c.get('user');
  const workspaceId = c.req.query('workspaceId');
  const spaceId = c.req.query('spaceId');
  const sourceType = c.req.query('sourceType') ?? 'page';
  const sourceId = c.req.query('sourceId');
  if (!workspaceId || !spaceId || !sourceId) return c.json({ error: 'workspaceId, spaceId, sourceId are required' }, 400);
  if (!(await canViewSpace(user.id, spaceId))) return c.json({ error: 'Forbidden' }, 403);
  return c.json({ edges: await getGraphForEntity({ workspaceId, spaceId, sourceType, sourceId }) });
});

llmWikiRoutes.get('/edges/:edgeId/evidence', async (c) => {
  const edge = await getEvidenceCard(c.req.param('edgeId'));
  if (!edge) return c.json({ error: 'Not found' }, 404);
  return c.json({ edge });
});
