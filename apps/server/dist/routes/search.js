import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { searchSchema } from '@mindloom/shared';
import { authMiddleware } from '../middleware/auth';
import { hybridSearch } from '../services/search.service';
export const searchRoutes = new Hono();
searchRoutes.use('*', authMiddleware);
searchRoutes.post('/', zValidator('json', searchSchema), async (c) => {
    const user = c.get('user');
    const input = c.req.valid('json');
    const results = await hybridSearch({ userId: user.id, ...input });
    return c.json({ results });
});
