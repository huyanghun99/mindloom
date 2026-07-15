import { Hono } from 'hono';
import { type AppEnv } from '../middleware/auth';
export declare const workspaceRoutes: Hono<AppEnv, import("hono/types").BlankSchema, "/">;
