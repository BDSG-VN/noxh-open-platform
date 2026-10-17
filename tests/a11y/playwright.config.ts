import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: '.',
  testMatch: /.*\.spec\.ts/,
  outputDir: '../../test-results/a11y',
  globalSetup: './global-setup.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  reporter: process.env.CI ? [['list'], ['github']] : [['list']],
  use: {
    headless: true,
    locale: 'vi-VN',
    viewport: { width: 1280, height: 900 },
    actionTimeout: 15_000,
  },
});
