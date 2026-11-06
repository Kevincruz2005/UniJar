import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './test/browser', workers: 1, fullyParallel: false,
  timeout: 90000, expect: { timeout: 20000 }, retries: 0,
  outputDir: '../.local/frontend-browser-results',
  reporter: [['list'], ['json', { outputFile: '../.local/frontend-browser-report.json' }]],
  use: { baseURL: process.env.BROWSER_BASE_URL ?? 'http://localhost:5173', viewport: { width: 1440, height: 1000 }, trace: 'retain-on-failure', screenshot: 'only-on-failure', launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } },
});
