import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// Excalidraw 0.18.x ships its stylesheet through a *conditional* export
// (`development` / `production`) with no `default` fallback. Vite's CSS
// subpath resolver does not match those conditions, so the bare import
// `@excalidraw/excalidraw/index.css` fails to resolve. We map it to the
// concrete dist file (dev vs prod) so the editor styles load reliably.
function resolveExcalidrawCss(command: 'build' | 'serve'): string | undefined {
  try {
    const entry = require.resolve('@excalidraw/excalidraw');
    return entry.replace(
      /dist\/(?:prod|dev)\/index\.js$/,
      `dist/${command === 'build' ? 'prod' : 'dev'}/index.css`
    );
  } catch {
    return undefined;
  }
}

export default defineConfig(({ command }) => {
  const excalidrawCss = resolveExcalidrawCss(command);
  const alias: Record<string, string> = excalidrawCss
    ? { '@excalidraw/excalidraw/index.css': excalidrawCss }
    : {};
  return {
    plugins: [react()],
    resolve: {
      alias
    },
    server: {
      port: 5173,
      host: '0.0.0.0',
      proxy: {
        '/api': { target: 'http://127.0.0.1:39280', changeOrigin: true },
        '/health': { target: 'http://127.0.0.1:39280', changeOrigin: true }
      }
    }
  };
});
