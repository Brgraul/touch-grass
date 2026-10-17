import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './src/features',
  testMatch: '**/*.e2e.spec.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 20_000 },
  retries: process.env.CI ? 1 : 0,
  // Vite watches the project root, so a report written outside test-results reloads the page under test.
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'test-results/report' }]],
  outputDir: 'test-results/artifacts',
  use: {
    baseURL: process.env.APP_URL ?? 'http://127.0.0.1:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], channel: 'chrome' } }],
  webServer: process.env.EXTERNAL_APP
    ? undefined
    : {
        command: 'pnpm dev',
        url: 'http://127.0.0.1:3000/login',
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
})
