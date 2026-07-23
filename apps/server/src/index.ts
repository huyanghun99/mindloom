import './env-load';
import { serve } from '@hono/node-server';
import { createApp } from './app';
import { env } from './env';
import { startJobRunner, stopJobRunner } from './services/job-runner';

const app = createApp();
startJobRunner();

const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`MindLoom API listening on http://127.0.0.1:${info.port}`);
});

// Graceful shutdown: stop the poll loop, let an in-flight job finish, then close
// the HTTP server (Gate: SIGTERM/SIGINT 不再留下僵尸 job).
let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Received ${signal}, shutting down gracefully...`);
  await stopJobRunner();
  server.close(() => {
    console.log('HTTP server closed.');
    process.exit(0);
  });
  // Force-exit if connections keep the server from closing.
  setTimeout(() => process.exit(0), 15000).unref();
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
