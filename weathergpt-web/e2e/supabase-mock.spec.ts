import { expect, test } from '@playwright/test'
import { E2E_SUPABASE_URL } from '../scripts/e2e-env.mjs'
import { mockBackend, signIn } from './support/mockApi'

/**
 * Tests never talk to a real Supabase project. The e2e build
 * (`npm run build:e2e`) carries the test-only address from
 * scripts/e2e-env.mjs: the browser's calls are answered by page.route, and the
 * Next.js proxy's server-side session check, which Playwright cannot
 * intercept, lands on scripts/mock-supabase.mjs on this machine.
 */
test('signed in: the browser and the Next.js server only ever call the test-only Supabase address', async ({ page, request }) => {
  const hosts = new Set<string>()
  page.on('request', (r) => hosts.add(new URL(r.url()).host))
  await mockBackend(page)
  await signIn(page)
  // a full page load with the session cookie: the proxy checks it on the server
  await page.reload()
  await expect(page).toHaveURL(/\/dashboard$/)

  await expect
    .poll(
      async () => {
        const seen = (await (await request.get(`${E2E_SUPABASE_URL}/__e2e/requests`)).json()) as Array<{ path: string; authorization: string | null }>
        return seen.some((r) => r.path === '/auth/v1/user' && r.authorization === 'Bearer e2e-access-token')
      },
      { timeout: 15_000, message: "the proxy's session check did not reach the mock Supabase: is the server running the build:e2e build?" }
    )
    .toBe(true)

  // the browser asked the test-only address, and no Supabase-hosted project
  expect(hosts).toContain(new URL(E2E_SUPABASE_URL).host)
  expect([...hosts].filter((h) => /supabase\./.test(h))).toEqual([])
})
