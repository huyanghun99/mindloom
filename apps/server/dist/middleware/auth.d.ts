import { setCookie } from 'hono/cookie';
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
export declare function signSession(user: SessionUser): Promise<string>;
export declare function verifySession(token: string): Promise<SessionUser | null>;
export declare const authMiddleware: import("hono").MiddlewareHandler<AppEnv, string, {}, Response>;
export declare function setSessionCookie(c: Parameters<typeof setCookie>[0], token: string): void;
