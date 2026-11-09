import { expect, test, type Page } from '@playwright/test'
import { enterDemo, mockBackend, PUNE, type MockOptions } from './support/mockApi'

/**
 * The experimental waterlogging layer (docs/WATERLOGGING.md): "zoom in" when
 * the view is larger than a city, hexagons by level, a legend that says how it
 * is made and that it is experimental and not official, and the tap card.
 */

test.beforeEach(async ({ context }) => {
  await context.grantPermissions(['geolocation'])
  await context.setGeolocation({ latitude: PUNE.latitude, longitude: PUNE.longitude })
})

async function openWaterlogging(page: Page, opts: MockOptions = {}) {
  const log = await mockBackend(page, opts)
  await enterDemo(page)
  await page.locator('a[href="/map"]').first().dispatchEvent('click')
  await page.waitForURL('**/map')
  await page.getByRole('button', { name: /use my current location/i }).first().click()
  const map = page.getByTestId('weather-map')
  await expect(map.locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 30_000 })
  await expect(map).toHaveAttribute('data-center', '18.520,73.857', { timeout: 15_000 })
  await page.getByTestId('map-layer-waterlogging').click()
  await expect(map).toHaveAttribute('data-layer', 'waterlogging')
  return { log, map }
}

test('zoomed out: "zoom in" without a request; Zoom in here loads the estimate', async ({ page }) => {
  const { log, map } = await openWaterlogging(page)
  await expect(map).toHaveAttribute('data-waterlog-status', 'too-large', { timeout: 10_000 })
  await expect(page.getByRole('status').filter({ hasText: 'Zoom in to a city to see the waterlogging estimate.' })).toBeVisible()
  expect(log.paths.filter((p) => p === '/api/map/waterlogging')).toHaveLength(0)
  await page.getByTestId('wl-zoom-here').click()
  await expect(map).toHaveAttribute('data-waterlog-status', 'ready', { timeout: 20_000 })
  await expect(map).toHaveAttribute('data-waterlog-cells', '19')
  await expect(page.getByRole('status').filter({ hasText: '19 areas with an estimated risk' })).toBeVisible()
  // no weather surface or wind particles under the hexagons
  await expect(map).not.toHaveAttribute('data-field-before', /.*/)
  await expect(map).toHaveAttribute('data-particles', '0')
})

test('legend: levels, the rain window, how it is made, experimental and not official', async ({ page }) => {
  const { map } = await openWaterlogging(page)
  await page.getByTestId('wl-zoom-here').click()
  await expect(map).toHaveAttribute('data-waterlog-status', 'ready', { timeout: 20_000 })
  const legend = page.getByTestId('map-legend').filter({ visible: true })
  await expect(legend).toHaveAttribute('data-layer', 'waterlogging')
  await expect(legend).toContainText('Waterlogging risk (experimental)')
  for (const l of ['Low', 'Moderate', 'High']) await expect(legend).toContainText(l)
  await expect(page.getByTestId('wl-window')).toHaveText(/^Rain window \d\d:\d\d – \d\d:\d\d$/)
  await expect(page.getByTestId('wl-how')).toContainText('Not a measurement, not an alert, not official IMD.')
  await expect(page.getByTestId('wl-how')).toContainText('model grid ≈ 8 km')
})

test('tap a hexagon: level and its parts', async ({ page }) => {
  const { map } = await openWaterlogging(page)
  await page.getByTestId('wl-zoom-here').click()
  await expect(map).toHaveAttribute('data-waterlog-status', 'ready', { timeout: 20_000 })
  // the fly-in ends on the place; then the centre tap lands on the bottom hexagon
  await expect(map).toHaveAttribute('data-center', '18.520,73.857', { timeout: 15_000 })
  const card = page.getByTestId('wl-card')
  await expect(async () => {
    await page.getByTestId('map-centre').click()
    await expect(card).toBeVisible({ timeout: 2_000 })
  }).toPass({ timeout: 20_000 })
  await expect(card).toHaveAttribute('data-level', 'high')
  await expect(card).toContainText('Waterlogging risk (experimental)')
  await expect(page.getByTestId('wl-rain')).toHaveText('22.4 mm, wettest hour 9.1 mm')
  await expect(page.getByTestId('wl-low')).toHaveText('7.5 m below its surroundings')
  await expect(page.getByTestId('wl-reports')).toHaveText('1')
  await expect(card).toContainText('Not official IMD.')
})

test('outage: a clear line and Retry', async ({ page }) => {
  const { map } = await openWaterlogging(page, { fail: { '/api/map/waterlogging': 503 } })
  await page.getByTestId('wl-zoom-here').click()
  await expect(map).toHaveAttribute('data-waterlog-status', 'error', { timeout: 20_000 })
  await expect(page.getByRole('status').filter({ hasText: 'The waterlogging estimate is unavailable right now.' })).toBeVisible()
  await expect(page.getByTestId('wl-retry')).toBeVisible()
})

test('waterlogging words follow the UI language', async ({ page, isMobile }) => {
  test.skip(isMobile, 'language buttons sit in the desktop nav')
  const { map } = await openWaterlogging(page)
  await page.getByTestId('wl-zoom-here').click()
  await expect(map).toHaveAttribute('data-waterlog-status', 'ready', { timeout: 20_000 })
  await page.getByRole('button', { name: 'हिं', exact: true }).first().click()
  await expect(page.getByTestId('map-legend').filter({ visible: true })).toContainText('जलभराव का जोखिम (प्रायोगिक)')
  await page.getByRole('button', { name: 'मरा', exact: true }).first().click()
  await expect(page.getByTestId('map-layer-waterlogging')).toHaveText('पाणी साचणे (प्रायोगिक)')
  await page.getByRole('button', { name: 'Hing', exact: true }).first().click()
  await expect(page.getByTestId('wl-how')).toContainText('official IMD nahi')
})
