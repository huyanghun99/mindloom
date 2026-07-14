import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { captureSchema } from '@mindloom/shared';
import { authMiddleware } from '../middleware/auth';
import { db } from '../db/client';
import { pages } from '../db/schema';
import { canEditSpace } from '../services/permission.service';
import { enqueueJob } from '../services/job-runner';
import { tokenizeChineseFriendly } from '../utils/text';

export const captureRoutes = new Hono();
captureRoutes.use('*', authMiddleware);

captureRoutes.post('/', zValidator('json', captureSchema), async (c) => {
  const user = c.get('user');
  const input = c.req.valid('json');
  if (!(await canEditSpace(user.id, input.spaceId))) return c.json({ error: 'Forbidden' }, 403);
  const [page] = await db.insert(pages).values({
    workspaceId: input.workspaceId,
    spaceId: input.spaceId,
    title: input.title,
    contentJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: input.content }] }] },
    textContent: input.content,
    ftsTokens: tokenizeChineseFriendly(`${input.title}\n${input.content}\n${input.tags.join(' ')}`),
    createdById: user.id,
    updatedById: user.id,
    llmDirtyReason: 'quick_capture'
  }).returning();
  await enqueueJob({ workspaceId: page.workspaceId, spaceId: page.spaceId, entityType: 'page', entityId: page.id, type: 'page.process_llm', runAfterSeconds: 30 });
  return c.json({ page }, 201);
});
