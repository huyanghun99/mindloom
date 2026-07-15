import { and, eq, or, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { pages, spaceMembers, workspaceMembers } from '@mindloom/db';
export async function canManageWorkspace(userId, workspaceId) {
    const rows = await db.select().from(workspaceMembers).where(and(eq(workspaceMembers.userId, userId), eq(workspaceMembers.workspaceId, workspaceId), or(eq(workspaceMembers.role, 'owner'), eq(workspaceMembers.role, 'admin')))).limit(1);
    return rows.length > 0;
}
export async function canViewSpace(userId, spaceId) {
    const rows = await db.select().from(spaceMembers).where(and(eq(spaceMembers.spaceId, spaceId), eq(spaceMembers.userId, userId))).limit(1);
    return rows.length > 0;
}
export async function canEditSpace(userId, spaceId) {
    const rows = await db.select().from(spaceMembers).where(and(eq(spaceMembers.spaceId, spaceId), eq(spaceMembers.userId, userId), or(eq(spaceMembers.role, 'admin'), eq(spaceMembers.role, 'writer')))).limit(1);
    return rows.length > 0;
}
export async function canViewPage(userId, pageId) {
    const [page] = await db.select().from(pages).where(eq(pages.id, pageId)).limit(1);
    if (!page)
        return false;
    return canViewSpace(userId, page.spaceId);
}
export async function canEditPage(userId, pageId) {
    const [page] = await db.select().from(pages).where(eq(pages.id, pageId)).limit(1);
    if (!page)
        return false;
    return canEditSpace(userId, page.spaceId);
}
export async function getReadableSpaceIds(userId, workspaceId) {
    const rows = await db.execute(sql `
    SELECT sm.space_id
    FROM space_members sm
    JOIN spaces s ON s.id = sm.space_id
    WHERE sm.user_id = ${userId} AND s.workspace_id = ${workspaceId}
  `);
    return rows.rows.map((r) => r.space_id);
}
