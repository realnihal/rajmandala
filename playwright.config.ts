import { defineConfig } from '@playwright/test';

/** Browser tests that play the real game, in Playwright's own Chromium (npx playwright install chromium). */
export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: 'http://localhost:5173',
    // Set PW_BROWSER to use a browser already on this machine instead of downloading one.
    launchOptions: process.env.PW_BROWSER ? { executablePath: process.env.PW_BROWSER } : {},
  },
  webServer: {
    command: 'npm run dev --workspace @rajmandala/web',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
