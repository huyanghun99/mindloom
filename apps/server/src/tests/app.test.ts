import { describe, expect, it } from 'vitest';
import { createApp } from '../app';

describe('server app smoke', () => {
  it('creates a Hono app with routes registered', () => {
    const app = createApp();
    expect(app).toBeDefined();
  });

  it('returns 404 for unknown routes', async () => {
    const app = createApp();
    const res = await app.request('/api/nonexistent-endpoint');
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('Not found');
  });
});
