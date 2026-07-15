import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { eq, sql } from 'drizzle-orm';
import { loginSchema, registerSchema } from '@mindloom/shared';
import { db } from '../db/client';
import { users } from '@mindloom/db';
import { env } from '../env';
import { hashPassword, verifyPassword } from '../utils/password';
import { signSession, setSessionCookie, authMiddleware } from '../middleware/auth';
export const authRoutes = new Hono();
authRoutes.post('/register', zValidator('json', registerSchema), async (c) => {
    const input = c.req.valid('json');
    const count = await db.execute(sql `SELECT COUNT(*)::text FROM users`);
    const isFirst = Number(count.rows[0]?.count ?? 0) === 0;
    if (!isFirst && !env.ALLOW_SIGNUP)
        return c.json({ error: 'Signup is disabled' }, 403);
    const passwordHash = await hashPassword(input.password);
    const [user] = await db.insert(users).values({
        email: input.email.toLowerCase(),
        name: input.name,
        passwordHash,
        isInstanceOwner: isFirst
    }).returning();
    const token = await signSession({ id: user.id, email: user.email, name: user.name, isInstanceOwner: user.isInstanceOwner });
    setSessionCookie(c, token);
    return c.json({ user: { id: user.id, email: user.email, name: user.name, isInstanceOwner: user.isInstanceOwner } });
});
authRoutes.post('/login', zValidator('json', loginSchema), async (c) => {
    const input = c.req.valid('json');
    const [user] = await db.select().from(users).where(eq(users.email, input.email.toLowerCase())).limit(1);
    if (!user || !(await verifyPassword(user.passwordHash, input.password)))
        return c.json({ error: 'Invalid email or password' }, 401);
    const token = await signSession({ id: user.id, email: user.email, name: user.name, isInstanceOwner: user.isInstanceOwner });
    setSessionCookie(c, token);
    return c.json({ user: { id: user.id, email: user.email, name: user.name, isInstanceOwner: user.isInstanceOwner } });
});
authRoutes.get('/me', authMiddleware, async (c) => c.json({ user: c.get('user') }));
