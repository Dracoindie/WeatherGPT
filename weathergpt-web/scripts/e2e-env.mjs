/**
 * Test-only addresses for Playwright (never a real project).
 *
 * NEXT_PUBLIC_* values are compiled into the bundle by `next build`, so the
 * e2e build is made with these (scripts/build-e2e.mjs, `npm run build:e2e`)
 * into its own folder. `.env.local` and the normal `.next` build are not
 * touched, and the app has no test switch: it simply talks to the Supabase
 * URL it was built with, which here is scripts/mock-supabase.mjs on this PC.
 */

export const E2E_SUPABASE_PORT = 3101
export const E2E_SUPABASE_URL = `http://127.0.0.1:${E2E_SUPABASE_PORT}`
export const E2E_DIST_DIR = '.next-e2e'

/** Real environment variables win over .env.local in Next.js. */
export const E2E_BUILD_ENV = {
  NEXT_PUBLIC_SUPABASE_URL: E2E_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'e2e-anon-key',
  // the address e2e/support/mockApi.ts intercepts
  NEXT_PUBLIC_API_BASE_URL: 'http://localhost:8000',
  NEXT_DIST_DIR: E2E_DIST_DIR,
  NEXT_TELEMETRY_DISABLED: '1',
}
