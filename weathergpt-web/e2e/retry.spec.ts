import { expect, test, type Page } from '@playwright/test'
import { retryDelay } from '../lib/retryCooldown'
import { enterDemo, mockBackend, PUNE } from './support/mockApi'

/**
 * "Retry" on the map's error states, with backoff: after a failure the button
 * waits (2 s, then 4, 8 ... at most 30 s) before it can ask again, so it never
 * hammers Open-Meteo or the public OSRM server. A success resets it.
 */

test('backoff: 2 s after the first failure, doubling, at most 30 s', () => {
  expect([0, 1, 2, 3, 4, 5, 6, 9].map(retryDelay)).toEqual([0, 2000, 4000, 8000, 16000, 30000, 30000, 30000])
})

/** Answer the first `n` calls to `path` with 503, then let the normal mock answer. */
async function failFirst(page: Page, glob: string, n: number) {
  let calls = 0
  await page.route(glob, (route) => {
    calls += 1
    if (calls <= n) return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ detail: 'down' }) })
    return route.fallback()
  })
  return () => calls
}

async function openMap(page: Page) {
  await page.context().grantPermissions(['geolocation'])
  await page.context().setGeolocation({ latitude: PUNE.latitude, longitude: PUNE.longitude })
  await enterDemo(page)
  await page.locator('a[href="/map"]').first().dispatchEvent('click')
  await page.waitForURL('**/map')
  await page.getByRole('button', { name: /use my current location/i }).first().click()
  await expect(page.getByTestId('weather-map').locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 30_000 })
}

test('map weather unavailable: Retry waits out the backoff, then loads the layer', async ({ page }) => {
  test.setTimeout(90_000)
  await mockBackend(page)
  // the grid fails until the test lets it through (the map also reloads it on its own moves)
  let down = true
  await page.route('**/api/map/grid**', (route) =>
    down ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ detail: 'down' }) }) : route.fallback()
  )
  await openMap(page)
  const retry = page.getByTestId('map-grid-retry')
  await expect(page.getByText('Map weather is unavailable right now.')).toBeVisible({ timeout: 15_000 })
  // cooling down: disabled with a countdown
  await expect(retry).toBeDisabled()
  await expect(retry).toHaveText(/Retry in \d+ s/)
  // then it can be pressed (still down meanwhile, or a map move would reload it first), and the layer loads
  await expect(retry).toBeEnabled({ timeout: 35_000 })
  await expect(retry).toHaveText('Retry')
  down = false
  await retry.click()
  await expect(page.getByTestId('map-legend').first()).toBeVisible({ timeout: 10_000 })
  await expect(retry).toHaveCount(0)
})

test('route unavailable: Retry with a longer wait after each failure, then the route', async ({ page }) => {
  await mockBackend(page)
  await failFirst(page, '**/api/route**', 2)
  await openMap(page)
  await page.getByTestId('map-layer-route').click()
  await page.getByTestId('route-to-input').fill('Mumbai')
  await page.getByTestId('route-to-search').click()
  await expect(page.getByTestId('route-to-name')).toHaveText('Mumbai')
  await page.getByTestId('route-go').click()
  await expect(page.getByTestId('route-error')).toContainText('Route planning is unavailable right now')
  const retry = page.getByTestId('route-retry')
  await expect(retry).toBeDisabled()
  await expect(retry).toBeEnabled({ timeout: 5000 })
  await retry.click()
  // the second failure waits longer (4 s)
  await expect(retry).toHaveText(/Retry in [34] s/, { timeout: 10_000 })
  await expect(retry).toBeEnabled({ timeout: 7000 })
  await retry.click()
  await expect(page.getByTestId('route-report')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('route-error')).toHaveCount(0)
})
