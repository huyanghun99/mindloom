import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { eq, desc } from 'drizzle-orm';
import { ragAskSchema } from '@mindloom/shared';
import { authMiddleware, type AppEnv } from '../middleware/auth';
import { rateLimitMiddleware } from '../middleware/rate-limit';
import { askRag } from '../services/rag.service';
import { db } from '../db/client';
import { ragSessions } from '@mindloom/db';

export const ragRoutes = new Hono<AppEnv>();
ragRoutes.use('*', authMiddleware);
ragRoutes.post('/ask', rateLimitMiddleware('rag.ask'), zValidator('json', ragAskSchema), async (c) => {
  const user = c.get('user');
  const input = c.req.valid('json');
  const answer = await askRag({ userId: user.id, ...input });
  const [session] = await db.insert(ragSessions).values({
    workspaceId: input.workspaceId, spaceId: input.spaceId ?? null, userId: user.id,
    query: input.query, answer: answer.answer, citations: answer.citations
  }).returning();
  return c.json({ ...answer, sessionId: session.id });
});

ragRoutes.post('/ask/stream', rateLimitMiddleware('rag.ask.stream'), zValidator('json', ragAskSchema), async (c) => {
  const user = c.get('user');
  const input = c.req.valid('json');
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const answer = await askRag({ userId: user.id, ...input });
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: answer.answer, done: false })}\n\n`));
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true, citations: answer.citations })}\n\n`));
      controller.close();
    }
  });
  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } });
});

ragRoutes.get('/sessions', async (c) => {
  const user = c.get('user');
  const rows = await db.select().from(ragSessions).where(eq(ragSessions.userId, user.id)).orderBy(desc(ragSessions.createdAt)).limit(50);
  return c.json({ sessions: rows });
});

ragRoutes.get('/sessions/:id', async (c) => {
  const user = c.get('user');
  const [session] = await db.select().from(ragSessions).where(eq(ragSessions.id, c.req.param('id'))).limit(1);
  if (!session) return c.json({ error: 'Not found' }, 404);
  if (session.userId !== user.id) return c.json({ error: 'Forbidden' }, 403);
  return c.json({ session });
});
