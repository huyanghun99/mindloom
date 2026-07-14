import { Hono } from 'hono';
import { type AppEnv } from '../middleware/auth';
export declare const authRoutes: Hono<AppEnv, import("hono/types").BlankSchema, "/">;
