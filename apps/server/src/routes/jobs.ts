import { Hono } from 'hono';
import { authMiddleware, type AppEnv } from '../middleware/auth';
import { getJobMetrics } from '../services/job-metrics';

export const jobRoutes = new Hono<AppEnv>();
jobRoutes.use('*', authMiddleware);

// Lightweight ops visibility into the single-process worker. Counters are
// in-memory (see job-metrics.ts); a shared store would slot in behind the
// same interface for multi-worker deployments.
jobRoutes.get('/metrics', async (c) => {
  return c.json({ metrics: getJobMetrics() });
});
