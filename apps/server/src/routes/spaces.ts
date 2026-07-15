import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { eq, sql } from 'drizzle-orm';
import { createSpaceSchema, updateSpaceSchema } from '@mindloom/shared';
import { db } from '../db/client';
import { spaces, spaceMembers } from '@mindloom/db';
import { authMiddleware, type AppEnv } from '../middleware/auth';
import { canManageSpace, canManageWorkspace } from '../services/permission.service';

export const spaceRoutes = new Hono<AppEnv>();
spaceRoutes.use('*', authMiddleware);

spaceRoutes.get('/', async (c) => {
  const user = c.get('user');
  const workspaceId = c.req.query('workspaceId');
  if (!workspaceId) return c.json({ error: 'workspaceId is required' }, 400);
  const result = await db.execute(sql`
    SELECT s.*, sm.role
    FROM spaces s
    JOIN space_members sm ON sm.space_id = s.id
    WHERE s.workspace_id = ${workspaceId} AND sm.user_id = ${user.id}
    ORDER BY s.created_at DESC
  `);
  return c.json({ spaces: result.rows });
});

spaceRoutes.post('/', zValidator('json', createSpaceSchema), async (c) => {
  const user = c.get('user');
  const input = c.req.valid('json');
  if (!(await canManageWorkspace(user.id, input.workspaceId))) return c.json({ error: 'Forbidden' }, 403);
  const [space] = await db.insert(spaces).values({
    workspaceId: input.workspaceId,
    name: input.name,
    aiPrivacyPolicy: input.aiPrivacyPolicy
  }).returning();
  await db.insert(spaceMembers).values({ spaceId: space.id, userId: user.id, role: 'admin' });
  return c.json({ space }, 201);
});

spaceRoutes.patch('/:id', zValidator('json', updateSpaceSchema), async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const input = c.req.valid('json');
  if (!(await canManageSpace(user.id, id))) return c.json({ error: 'Forbidden' }, 403);
  const [updated] = await db.update(spaces).set({
    ...(input.name ? { name: input.name } : {}),
    ...(input.description !== undefined ? { description: input.description } : {}),
    ...(input.aiPrivacyPolicy ? { aiPrivacyPolicy: input.aiPrivacyPolicy } : {}),
    ...(input.autoLlmProcessing !== undefined ? { autoLlmProcessing: input.autoLlmProcessing } : {}),
    updatedAt: sql`now()`
  }).where(eq(spaces.id, id)).returning();
  if (!updated) return c.json({ error: 'Not found' }, 404);
  return c.json({ space: updated });
});

spaceRoutes.delete('/:id', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  if (!(await canManageWorkspace(user.id, (await db.select().from(spaces).where(eq(spaces.id, id)).limit(1))[0]?.workspaceId ?? ''))) return c.json({ error: 'Forbidden' }, 403);
  await db.delete(spaces).where(eq(spaces.id, id));
  return c.json({ ok: true });
});
