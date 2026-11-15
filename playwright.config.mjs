import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './playwright',
  testMatch: '**/*.pw.mjs',
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:11059',
    browserName: 'chromium',
    channel: 'chrome',
    headless: true,
    permissions: ['microphone'],
    viewport: { width: 390, height: 844 },
    launchOptions: {
      args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
    },
  },
  webServer: {
    command: 'npx vite --host 127.0.0.1 --port 11059 --strictPort',
    url: 'http://127.0.0.1:11059',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
