import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { ragAskSchema } from '@mindloom/shared';
import { authMiddleware } from '../middleware/auth';
import { rateLimitMiddleware } from '../middleware/rate-limit';
import { askRag } from '../services/rag.service';

export const ragRoutes = new Hono();
ragRoutes.use('*', authMiddleware);
ragRoutes.post('/ask', rateLimitMiddleware('rag.ask'), zValidator('json', ragAskSchema), async (c) => {
  const user = c.get('user');
  const input = c.req.valid('json');
  const answer = await askRag({ userId: user.id, ...input });
  return c.json(answer);
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
