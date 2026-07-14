import { Hono } from 'hono';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { authMiddleware } from '../middleware/auth';
import { env } from '../env';
import { db } from '../db/client';
import { attachments } from '@mindloom/db';
import { canEditPage } from '../services/permission.service';
export const attachmentRoutes = new Hono();
attachmentRoutes.use('*', authMiddleware);
attachmentRoutes.post('/upload', async (c) => {
    const user = c.get('user');
    const form = await c.req.formData();
    const file = form.get('file');
    const workspaceId = String(form.get('workspaceId') ?? '');
    const spaceId = String(form.get('spaceId') ?? '');
    const pageId = String(form.get('pageId') ?? '');
    if (!(file instanceof File))
        return c.json({ error: 'file is required' }, 400);
    if (!workspaceId || !spaceId || !pageId)
        return c.json({ error: 'workspaceId, spaceId, pageId are required' }, 400);
    if (!(await canEditPage(user.id, pageId)))
        return c.json({ error: 'Forbidden' }, 403);
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
