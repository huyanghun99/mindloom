import { createMiddleware } from 'hono/factory';
import { env } from '../env';

/**
 * Strict Origin guard (defense-in-depth alongside CORS).
 *
 * For any state-changing request (POST/PUT/PATCH/DELETE) we require the
 * `Origin` header to match either:
 *   - the API's own origin (same-origin requests, incl. server-rendered
 *     navigations and `app.request()` used by tests, which send no Origin), or
 *   - one of the explicitly allowed web origins.
 *
 * A missing Origin on a mutating request is permitted (browsers omit Origin
 * for same-origin form posts / same-origin fetch, and our test harness never
 * sets one). A cross-origin Origin that is not on the allow-list is rejected
 * with 403, mitigating CSRF.
 */
function allowedOrigins(): Set<string> {
  const set = new Set<string>();
  for (const o of ['http://127.0.0.1:5173', 'http://localhost:5173']) set.add(o);
  if (env.PUBLIC_BASE_URL) {
    try {
      set.add(new URL(env.PUBLIC_BASE_URL).origin);
    } catch {
      /* ignore malformed base url */
    }
  }
  return set;
}

const ALLOWED = allowedOrigins();
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export const csrfGuard = createMiddleware(async (c, next) => {
  if (!MUTATING.has(c.req.method)) return next();
  const origin = c.req.header('origin');
  // No Origin header -> same-origin / test harness -> allow.
  if (!origin) return next();
  // Same-origin as the API itself -> allow.
  if (origin === new URL(c.req.url).origin) return next();
  // Known web origin -> allow.
  if (ALLOWED.has(origin)) return next();
  return c.json({ error: 'Forbidden: origin not allowed' }, 403);
});
