import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const src = (path: string) => fileURLToPath(new URL(path, import.meta.url));

/**
 * Builds only the game screen, as static files for GitHub Pages. The game
 * server is deployed separately to Cloudflare; VITE_API_BASE tells the
 * screen where it is.
 */
export default defineConfig({
  plugins: [react()],
  // Relative asset paths, so the site works under /<repository>/ on GitHub Pages.
  base: './',
  resolve: {
    alias: {
      '@rajmandala/engine': src('../engine/src/index.ts'),
      '@rajmandala/server': src('../server/src/index.ts'),
    },
  },
  build: { outDir: 'dist-pages', emptyOutDir: true },
});
