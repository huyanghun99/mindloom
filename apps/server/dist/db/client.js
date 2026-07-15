import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '@mindloom/db';
import { env } from '../env';
export const pool = new pg.Pool({ connectionString: env.DATABASE_URL });
export const db = drizzle(pool, { schema });
