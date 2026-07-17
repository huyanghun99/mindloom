import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { createPageSchema, updatePageSchema, restoreRevisionSchema } from '@mindloom/shared';
import { authMiddleware, type AppEnv } from '../middleware/auth';
import { canEditPage, canEditSpace, canViewPage, canViewSpace } from '../services/permission.service';
import {
  createPage,
  deletePage,
  getPageDetail,
  getPageTree,
  listPagesLight,
  listRevisions,
  restoreRevision,
  updatePage
} from '../services/page.service';

export const pageRoutes = new Hono<AppEnv>();
pageRoutes.use('*', authMiddleware);

// Lightweight list: NO contentJson / textContent. Full body only via GET /:id.
pageRoutes.get('/', async (c) => {
  const user = c.get('user');
  const spaceId = c.req.query('spaceId');
  if (!spaceId) return c.json({ error: 'spaceId is required' }, 400);
  if (!(await canViewSpace(user.id, spaceId))) return c.json({ error: 'Forbidden' }, 403);
  const pages = await listPagesLight(spaceId);
  return c.json({ pages });
});

pageRoutes.post('/', zValidator('json', createPageSchema), async (c) => {
  const user = c.get('user');
  const input = c.req.valid('json');

  // Space write permission is checked up-front so we can return 403 (the
  // service throws a generic error for missing space / bad parent).
  if (!(await canEditSpace(user.id, input.spaceId))) return c.json({ error: 'Forbidden' }, 403);

  try {
    const { page } = await createPage(user, input);
    return c.json({ page }, 201);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('does not belong to this space')) return c.json({ error: msg }, 400);
    if (msg.includes('Space not found')) return c.json({ error: msg }, 404);
    throw err;
  }
});

// Lightweight tree: NO contentJson / textContent; includes parentPageId,
// position and hasChildren so the UI can render and order without the body.
pageRoutes.get('/tree', async (c) => {
  const user = c.get('user');
  const spaceId = c.req.query('spaceId');
  if (!spaceId) return c.json({ error: 'spaceId is required' }, 400);
  if (!(await canViewSpace(user.id, spaceId))) return c.json({ error: 'Forbidden' }, 403);
  const tree = await getPageTree(spaceId);
  return c.json({ tree });
});

pageRoutes.get('/:pageId', async (c) => {
  const user = c.get('user');
  const pageId = c.req.param('pageId');
  if (!(await canViewPage(user.id, pageId))) return c.json({ error: 'Forbidden' }, 403);
  const page = await getPageDetail(pageId);
  if (!page) return c.json({ error: 'Not found' }, 404);
  return c.json({ page });
});

pageRoutes.put('/:pageId', zValidator('json', updatePageSchema), async (c) => {
  const user = c.get('user');
  const pageId = c.req.param('pageId');
  const input = c.req.valid('json');
  if (!(await canEditPage(user.id, pageId))) return c.json({ error: 'Forbidden' }, 403);

  const result = await updatePage(user, pageId, input);
  if (!result.ok) {
    if (result.reason === 'notfound') return c.json({ error: 'Not found' }, 404);
    if (result.reason === 'conflict') {
      const cur = await getPageDetail(pageId);
      return c.json({ error: 'Version conflict', serverVersion: cur?.contentVersion }, 409);
    }
  }
  return c.json({ page: (result as { page: unknown }).page });
});

pageRoutes.delete('/:pageId', async (c) => {
  const user = c.get('user');
  const pageId = c.req.param('pageId');
  if (!(await canEditPage(user.id, pageId))) return c.json({ error: 'Forbidden' }, 403);
  await deletePage(pageId);
  return c.json({ ok: true });
});

pageRoutes.get('/:pageId/revisions', async (c) => {
  const user = c.get('user');
  const pageId = c.req.param('pageId');
  if (!(await canViewPage(user.id, pageId))) return c.json({ error: 'Forbidden' }, 403);
  const revisions = await listRevisions(pageId);
  return c.json({ revisions });
});

pageRoutes.post('/:pageId/restore-revision', zValidator('json', restoreRevisionSchema), async (c) => {
  const user = c.get('user');
  const pageId = c.req.param('pageId');
  const input = c.req.valid('json');
  if (!(await canEditPage(user.id, pageId))) return c.json({ error: 'Forbidden' }, 403);
  const result = await restoreRevision(user, pageId, input.revisionId);
  if (!('page' in result)) return c.json({ error: 'Revision not found' }, 404);
  return c.json({ page: result.page });
});
