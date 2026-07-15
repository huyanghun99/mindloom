import { Hono } from 'hono';
import { type AppEnv } from '../middleware/auth';
export declare const captureRoutes: Hono<AppEnv, import("hono/types").BlankSchema, "/">;
