import { createMiddleware } from 'hono/factory';
import { getCookie, setCookie } from 'hono/cookie';
import { jwtVerify, SignJWT } from 'jose';
import { env } from '../env';

const key = new TextEncoder().encode(env.APP_SECRET);

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  isInstanceOwner: boolean;
}

/** Hono env bound to every route that runs after authMiddleware. */
export type AppEnv = {
  Variables: {
    user: SessionUser;
  };
};

export async function signSession(user: SessionUser): Promise<string> {
  return new SignJWT(user as any)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('14d')
    .sign(key);
}

export async function verifySession(token: string): Promise<SessionUser | null> {
  try {
    const { payload } = await jwtVerify(token, key);
    return payload as any as SessionUser;
  } catch {
    return null;
  }
}

export const authMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  const token = getCookie(c, 'mindloom_session') ?? c.req.header('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return c.json({ error: 'Unauthorized' }, 401);
  const user = await verifySession(token);
  if (!user) return c.json({ error: 'Unauthorized' }, 401);
  c.set('user', user);
  await next();
});

export function setSessionCookie(c: Parameters<typeof setCookie>[0], token: string) {
  setCookie(c, 'mindloom_session', token, {
    httpOnly: true,
    sameSite: 'Lax',
    secure: env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 14
  });
}
