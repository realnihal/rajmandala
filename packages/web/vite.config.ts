import { fileURLToPath } from 'node:url';
import { cloudflare } from '@cloudflare/vite-plugin';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const src = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  // The Cloudflare plugin runs worker/index.ts in the Workers runtime beside the page,
  // so the game screen and the game server share one dev server and one origin.
  plugins: [react(), cloudflare()],
  resolve: {
    alias: {
      '@rajmandala/engine': src('../engine/src/index.ts'),
      '@rajmandala/server': src('../server/src/index.ts'),
    },
  },
  server: { port: 5173, strictPort: true },
});
