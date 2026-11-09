import { expect, test, type Page } from '@playwright/test'
import { enterDemo, mockBackend, PUNE } from './support/mockApi'

/**
 * /map layout: on phones the map is about 60 % of the screen height and the
 * place chip stays small, so it does not cover the map.
 */

async function openMap(page: Page) {
  await page.context().grantPermissions(['geolocation'])
  await page.context().setGeolocation({ latitude: PUNE.latitude, longitude: PUNE.longitude })
  await mockBackend(page)
  await enterDemo(page)
  await page.locator('a[href="/map"]').first().dispatchEvent('click')
  await page.waitForURL('**/map')
  await page.getByRole('button', { name: /use my current location/i }).first().click()
  const map = page.getByTestId('weather-map')
  await expect(map.locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId('map-location-card')).toBeVisible({ timeout: 15_000 })
  return map
}

test('phones: the map is about 60 % of the screen tall and the place chip covers little of it', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'phone layout')
  await openMap(page)
  const vh = page.viewportSize()!.height
  const frame = (await page.getByTestId('map-frame').boundingBox())!
  expect(frame.height / vh).toBeGreaterThan(0.55)
  expect(frame.height / vh).toBeLessThan(0.65)
  const chip = (await page.getByTestId('map-location-card').boundingBox())!
  expect(chip.width).toBeLessThanOrEqual(frame.width * 0.5 + 1)
  // name, condition and alert status in small type: under 8 % of the map's area
  expect((chip.width * chip.height) / (frame.width * frame.height)).toBeLessThan(0.08)
})

test('wide screens: the map keeps its tall frame', async ({ page, isMobile }) => {
  test.skip(isMobile, 'wide layout')
  await openMap(page)
  const frame = (await page.getByTestId('map-frame').boundingBox())!
  expect(frame.height).toBeGreaterThanOrEqual(460)
})
