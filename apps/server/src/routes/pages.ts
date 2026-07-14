import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { and, eq, sql } from 'drizzle-orm';
import { createPageSchema, updatePageSchema } from '@mindloom/shared';
import { db } from '../db/client';
import { pages, pageRevisions } from '../db/schema';
import { authMiddleware } from '../middleware/auth';
import { canEditPage, canEditSpace, canViewPage, canViewSpace } from '../services/permission.service';
import { enqueueJob } from '../services/job-runner';
import { extractTextFromProseMirrorJson, tokenizeChineseFriendly } from '../utils/text';

export const pageRoutes = new Hono();
pageRoutes.use('*', authMiddleware);

pageRoutes.get('/', async (c) => {
  const user = c.get('user');
  const spaceId = c.req.query('spaceId');
  if (!spaceId) return c.json({ error: 'spaceId is required' }, 400);
  if (!(await canViewSpace(user.id, spaceId))) return c.json({ error: 'Forbidden' }, 403);
  const rows = await db.select().from(pages).where(and(eq(pages.spaceId, spaceId), eq(pages.status, 'normal'))).orderBy(pages.updatedAt);
  return c.json({ pages: rows });
});

pageRoutes.post('/', zValidator('json', createPageSchema), async (c) => {
  const user = c.get('user');
  const input = c.req.valid('json');
  if (!(await canEditSpace(user.id, input.spaceId))) return c.json({ error: 'Forbidden' }, 403);
  const textContent = input.textContent || extractTextFromProseMirrorJson(input.contentJson ?? {});
  const [page] = await db.insert(pages).values({
    workspaceId: input.workspaceId,
    spaceId: input.spaceId,
    parentPageId: input.parentPageId ?? null,
    title: input.title,
    contentJson: input.contentJson ?? { type: 'doc', content: [] },
    textContent,
    ftsTokens: tokenizeChineseFriendly(`${input.title}\n${textContent}`),
    createdById: user.id,
    updatedById: user.id,
    llmProcessStatus: 'pending',
    llmDirtyReason: 'page_created'
  }).returning();
  await enqueueJob({ workspaceId: page.workspaceId, spaceId: page.spaceId, entityType: 'page', entityId: page.id, type: 'page.process_llm', runAfterSeconds: 30 });
  return c.json({ page }, 201);
});

pageRoutes.get('/:pageId', async (c) => {
  const user = c.get('user');
  const pageId = c.req.param('pageId');
  if (!(await canViewPage(user.id, pageId))) return c.json({ error: 'Forbidden' }, 403);
  const [page] = await db.select().from(pages).where(eq(pages.id, pageId)).limit(1);
  return c.json({ page });
});

pageRoutes.put('/:pageId', zValidator('json', updatePageSchema), async (c) => {
  const user = c.get('user');
  const pageId = c.req.param('pageId');
  const input = c.req.valid('json');
  if (!(await canEditPage(user.id, pageId))) return c.json({ error: 'Forbidden' }, 403);
  const [current] = await db.select().from(pages).where(eq(pages.id, pageId)).limit(1);
  if (!current) return c.json({ error: 'Not found' }, 404);
  if (current.contentVersion !== input.contentVersion) {
    return c.json({ error: 'Version conflict', serverVersion: current.contentVersion }, 409);
  }
  await db.insert(pageRevisions).values({
    pageId: current.id,
    contentVersion: current.contentVersion,
    title: current.title,
    contentJson: current.contentJson,
    textContent: current.textContent,
    createdById: user.id
  });
  const nextContentJson = input.contentJson ?? current.contentJson;
  const nextText = input.textContent ?? extractTextFromProseMirrorJson(nextContentJson);
  const [updated] = await db.update(pages).set({
    title: input.title ?? current.title,
    contentJson: nextContentJson,
    textContent: nextText,
    ftsTokens: tokenizeChineseFriendly(`${input.title ?? current.title}\n${nextText}`),
    contentVersion: current.contentVersion + 1,
    llmProcessStatus: 'pending',
    llmDirtyReason: 'page_updated',
    updatedById: user.id,
    updatedAt: sql`now()`
  }).where(eq(pages.id, pageId)).returning();
  await enqueueJob({ workspaceId: updated.workspaceId, spaceId: updated.spaceId, entityType: 'page', entityId: updated.id, type: 'page.process_llm', runAfterSeconds: 45 });
  return c.json({ page: updated });
});
