import { defineConfig, devices } from '@playwright/test'
import { E2E_DIST_DIR, E2E_SUPABASE_URL } from './scripts/e2e-env.mjs'

/**
 * E2E + screenshot runs against a production build made for tests
 * (`npm run build:e2e` first; it builds into `.next-e2e` with the test-only
 * Supabase address from scripts/e2e-env.mjs, never the one in `.env.local`).
 * The FastAPI backend, Nominatim and Supabase are mocked per test in
 * e2e/support/mockApi.ts; the Next.js server's own Supabase check goes to
 * scripts/mock-supabase.mjs on 127.0.0.1. No network or backend is needed.
 */
const PORT = 3100

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  workers: 2,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    // Requests made by a service worker bypass page.route mocks; only the PWA
    // spec opts back in.
    serviceWorkers: 'block',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    // 390 px phone on the Chromium engine, so one browser download covers both.
    {
      name: 'mobile',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 2,
      },
    },
  ],
  webServer: [
    {
      command: 'node scripts/mock-supabase.mjs',
      url: `${E2E_SUPABASE_URL}/__e2e/health`,
      reuseExistingServer: true,
      timeout: 30_000,
    },
    {
      command: `npx next start -p ${PORT}`,
      url: `http://localhost:${PORT}`,
      reuseExistingServer: true,
      timeout: 120_000,
      env: { NEXT_DIST_DIR: E2E_DIST_DIR },
    },
  ],
})
