import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { pool } from '../db/client';
import { db } from '../db/client';

const startedAt = Date.now();

export const healthRoutes = new Hono();

healthRoutes.get('/', async (c) => {
  try {
    await pool.query('select 1');
    const { rows } = await db.execute<{ count: string }>(sql`SELECT count(*)::text FROM schema_migrations`);
    const migrationCount = rows[0]?.count ?? '0';
    return c.json({
      ok: true,
      service: 'mindloom-server',
      version: process.env.npm_package_version ?? '0.1.0',
      uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
      db: 'connected',
      migrations: migrationCount
    });
  } catch {
    return c.json({ ok: false, service: 'mindloom-server', db: 'disconnected' }, 503);
  }
});

healthRoutes.get('/diagnostics', async (c) => {
  const logLines: string[] = [];
  logLines.push(`MindLoom Diagnostics ${new Date().toISOString()}`);
  logLines.push(`Node ${process.version} · PID ${process.pid} · Uptime ${Math.floor((Date.now() - startedAt) / 1000)}s`);
  logLines.push(`Platform ${process.platform} ${process.arch}`);
  logLines.push(`Memory RSS ${Math.round(process.memoryUsage().rss / 1024 / 1024)}MB`);
  const envKeys = ['NODE_ENV', 'AI_DRIVER', 'AI_COMPLETION_MODEL', 'AI_EMBEDDING_MODEL', 'EMBEDDING_DIMENSION', 'STORAGE_DRIVER', 'ALLOW_SIGNUP'];
  logLines.push('--- Environment ---');
  for (const key of envKeys) logLines.push(`${key}=${process.env[key] ?? '(default)'}`);
  try {
    await pool.query('select 1');
    logLines.push('--- Database ---');
    logLines.push('status=connected');
    const mig = await db.execute<{ filename: string }>(sql`SELECT filename FROM schema_migrations ORDER BY filename`);
    logLines.push(`migrations=${mig.rows.length}`);
    for (const m of mig.rows) logLines.push(`  ${m.filename}`);
  } catch (err) {
    logLines.push(`Database: disconnected (${err instanceof Error ? err.message : String(err)})`);
  }
  return c.text(logLines.join('\n'));
});
