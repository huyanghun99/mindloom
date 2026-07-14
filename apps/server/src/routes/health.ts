import { Hono } from 'hono';
import { pool } from '../db/client';

export const healthRoutes = new Hono();
healthRoutes.get('/', async (c) => {
  await pool.query('select 1');
  return c.json({ ok: true, service: 'mindloom-server' });
});
