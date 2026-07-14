import { Hono } from 'hono';
import { mkdir, writeFile, readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { authMiddleware, type AppEnv } from '../middleware/auth';
import { env } from '../env';
import { db } from '../db/client';
import { attachments } from '@mindloom/db';
import { canEditPage, canViewPage } from '../services/permission.service';

export const attachmentRoutes = new Hono<AppEnv>();
attachmentRoutes.use('*', authMiddleware);

attachmentRoutes.post('/upload', async (c) => {
  const user = c.get('user');
  const form = await c.req.formData();
  const file = form.get('file');
  const workspaceId = String(form.get('workspaceId') ?? '');
  const spaceId = String(form.get('spaceId') ?? '');
  const pageId = String(form.get('pageId') ?? '');
  if (!(file instanceof File)) return c.json({ error: 'file is required' }, 400);
  if (!workspaceId || !spaceId || !pageId) return c.json({ error: 'workspaceId, spaceId, pageId are required' }, 400);
  if (!(await canEditPage(user.id, pageId))) return c.json({ error: 'Forbidden' }, 403);
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const storageKey = join(workspaceId, spaceId, `${Date.now()}-${file.name}`);
  const diskPath = join(env.UPLOAD_DIR, storageKey);
  await mkdir(join(env.UPLOAD_DIR, workspaceId, spaceId), { recursive: true });
  await writeFile(diskPath, buffer);
  const [row] = await db.insert(attachments).values({
    workspaceId,
    spaceId,
    pageId,
    uploaderId: user.id,
    fileName: file.name,
    mimeType: file.type || 'application/octet-stream',
    sizeBytes: buffer.length,
    storageDriver: 'local',
    storageKey
  }).returning();
  return c.json({ attachment: row }, 201);
});

attachmentRoutes.get('/', async (c) => {
  const user = c.get('user');
  const pageId = c.req.query('pageId');
  if (!pageId) return c.json({ error: 'pageId is required' }, 400);
  if (!(await canViewPage(user.id, pageId))) return c.json({ error: 'Forbidden' }, 403);
  const rows = await db.select().from(attachments).where(eq(attachments.pageId, pageId));
  return c.json({ attachments: rows });
});

attachmentRoutes.get('/:id/download', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const [row] = await db.select().from(attachments).where(eq(attachments.id, id)).limit(1);
  if (!row) return c.json({ error: 'Not found' }, 404);
  if (!row.pageId || !(await canViewPage(user.id, row.pageId))) return c.json({ error: 'Forbidden' }, 403);
  const buffer = await readFile(join(env.UPLOAD_DIR, row.storageKey));
  return new Response(buffer, { headers: { 'Content-Type': row.mimeType, 'Content-Disposition': `attachment; filename="${encodeURIComponent(row.fileName)}"` } });
});

attachmentRoutes.delete('/:id', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const [row] = await db.select().from(attachments).where(eq(attachments.id, id)).limit(1);
  if (!row) return c.json({ error: 'Not found' }, 404);
  if (!row.pageId || !(await canEditPage(user.id, row.pageId))) return c.json({ error: 'Forbidden' }, 403);
  await db.delete(attachments).where(eq(attachments.id, id));
  await unlink(join(env.UPLOAD_DIR, row.storageKey)).catch(() => {});
  return c.json({ ok: true });
});
