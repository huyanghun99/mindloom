import type { AppEnv } from './auth';
/**
 * Per-user / per-space sliding window rate limit backed by the
 * `api_rate_limit_events` PostgreSQL table. MVP avoids Redis per
 * the design doc; this table is the source of truth.
 */
export declare function rateLimitMiddleware(routeKey: string): import("hono").MiddlewareHandler<AppEnv, string, {}, Response>;
