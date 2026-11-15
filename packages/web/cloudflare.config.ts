import { bindings, defineConfig, exports } from 'cf/config';
import * as entrypoint from './worker/index.ts' with { type: 'cf-worker' };

export default defineConfig({
  worker: {
    name: 'rajmandala',
    compatibilityDate: '2026-10-06',
    entrypoint,
    env: {
      // Other sites allowed to use this game server, comma-separated. The game screen on GitHub Pages is one.
      ALLOWED_ORIGINS: bindings.text('https://realnihal.github.io'),
    },
    exports: {
      // One Durable Object per game room, with SQLite-backed storage.
      GameRoom: exports.durableObject({ storage: 'sqlite' }),
      // Counts room creations per visitor, to stop one address flooding the server with rooms.
      RateLimiter: exports.durableObject({ storage: 'sqlite' }),
    },
  },
});
