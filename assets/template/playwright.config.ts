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
    launchOptions: { executablePath: process.env.CHROME_EXECUTABLE_PATH },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], channel: 'chrome' } }],
  // The journeys run against the production build in workerd, the runtime Cloudflare deploys, with local
  // Workflows and cron. Reusing a running server would test `pnpm dev` instead, so a busy port fails the run.
  // Set EXTERNAL_APP=1 to aim the journeys at a server you started, such as `pnpm dev` while iterating.
  webServer: process.env.EXTERNAL_APP
    ? undefined
    : {
        command: 'pnpm build && pnpm preview',
        url: 'http://127.0.0.1:3000/login',
        reuseExistingServer: false,
        timeout: 120_000,
      },
})
