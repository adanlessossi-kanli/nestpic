import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.ts',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [['html']],
  globalSetup: './scripts/seed-test-users.ts',
  use: {
    baseURL: 'http://localhost:3000',
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      DATABASE_URL: 'postgresql://postgres:postgres@localhost:5433/nestpic_test',
      OBJECT_STORE_ENDPOINT: 'http://localhost:8081',
      OBJECT_STORE_ACCESS_KEY: 'localdev',
      OBJECT_STORE_SECRET_KEY: 'localdev-secret',
      OBJECT_STORE_BUCKET: 'nestpic-test',
      SESSION_SECRET: 'test-session-secret-change-in-production-32c',
      CDN_BASE_URL: 'http://localhost:8081',
      CDN_KEY_PAIR_ID: 'local-key-pair-id',
      CDN_PRIVATE_KEY: 'local-private-key-placeholder',
      NODE_ENV: 'test',
      DISABLE_LOCAL_WORKER: 'true',
      RATE_LIMIT_DISABLED: 'true',
    },
  },
})
