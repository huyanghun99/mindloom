import { serve } from '@hono/node-server';
import { createApp } from './app';
import { env } from './env';
import { startJobRunner } from './services/job-runner';
const app = createApp();
startJobRunner();
serve({ fetch: app.fetch, port: env.PORT }, (info) => {
    console.log(`MindLoom API listening on http://127.0.0.1:${info.port}`);
});
