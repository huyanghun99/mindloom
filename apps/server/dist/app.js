import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serveStatic } from '@hono/node-server/serve-static';
import { authRoutes } from './routes/auth';
import { workspaceRoutes } from './routes/workspaces';
import { spaceRoutes } from './routes/spaces';
import { pageRoutes } from './routes/pages';
import { searchRoutes } from './routes/search';
import { ragRoutes } from './routes/rag';
import { llmWikiRoutes } from './routes/llm-wiki';
import { captureRoutes } from './routes/capture';
import { attachmentRoutes } from './routes/attachments';
import { healthRoutes } from './routes/health';
export function createApp() {
    const app = new Hono();
    app.use('*', cors({ origin: ['http://127.0.0.1:5173', 'http://localhost:5173'], credentials: true }));
    app.route('/health', healthRoutes);
    app.route('/api/auth', authRoutes);
    app.route('/api/workspaces', workspaceRoutes);
    app.route('/api/spaces', spaceRoutes);
    app.route('/api/pages', pageRoutes);
    app.route('/api/search', searchRoutes);
    app.route('/api/rag', ragRoutes);
    app.route('/api/llm-wiki', llmWikiRoutes);
    app.route('/api/capture', captureRoutes);
    app.route('/api/attachments', attachmentRoutes);
    app.use('/assets/*', serveStatic({ root: '../../web/dist' }));
    app.get('/', serveStatic({ path: '../../web/dist/index.html' }));
    app.notFound((c) => c.json({ error: 'Not found' }, 404));
    app.onError((err, c) => {
        console.error(err);
        return c.json({ error: 'Internal server error', message: err.message }, 500);
    });
    return app;
}
