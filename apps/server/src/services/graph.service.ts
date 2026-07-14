import { sql } from 'drizzle-orm';
import { db } from '../db/client';

export async function getGraphForEntity(params: { workspaceId: string; spaceId: string; sourceType: string; sourceId: string }) {
  const result = await db.execute(sql`
    SELECT * FROM knowledge_edges
    WHERE workspace_id = ${params.workspaceId}
      AND space_id = ${params.spaceId}
      AND status <> 'deleted'
      AND ((source_type = ${params.sourceType} AND source_id = ${params.sourceId})
        OR (target_type = ${params.sourceType} AND target_id = ${params.sourceId}))
    ORDER BY confidence DESC, updated_at DESC
    LIMIT 100
  `);
  return result.rows;
}

export async function getEvidenceCard(edgeId: string) {
  const result = await db.execute(sql`SELECT * FROM knowledge_edges WHERE id = ${edgeId} LIMIT 1`);
  return result.rows[0] ?? null;
}
