import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { sql } from 'drizzle-orm';
import { createWorkspaceSchema } from '@mindloom/shared';
import { db } from '../db/client';
import { workspaces, workspaceMembers } from '@mindloom/db';
import { authMiddleware } from '../middleware/auth';
import { env } from '../env';
export const workspaceRoutes = new Hono();
workspaceRoutes.use('*', authMiddleware);
workspaceRoutes.get('/', async (c) => {
    const user = c.get('user');
    const result = await db.execute(sql `
    SELECT w.*, wm.role
    FROM workspaces w
    JOIN workspace_members wm ON wm.workspace_id = w.id
    WHERE wm.user_id = ${user.id}
    ORDER BY w.created_at DESC
  `);
    return c.json({ workspaces: result.rows });
});
workspaceRoutes.post('/', zValidator('json', createWorkspaceSchema), async (c) => {
    const user = c.get('user');
    const input = c.req.valid('json');
    const [workspace] = await db.insert(workspaces).values({
        name: input.name,
        embeddingDimension: env.EMBEDDING_DIMENSION,
        embeddingModel: env.AI_EMBEDDING_MODEL
    }).returning();
    await db.insert(workspaceMembers).values({ workspaceId: workspace.id, userId: user.id, role: 'owner' });
    return c.json({ workspace }, 201);
});
