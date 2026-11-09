import { expect, test, type Page } from '@playwright/test'
import { enterDemo, mockBackend, PUNE } from './support/mockApi'

/**
 * /map on large screens: Current conditions and the 7-day forecast share the
 * right-hand column next to the map, so there is no big empty space under the
 * conditions. Phones keep the order map, conditions, forecast.
 */

async function openMap(page: Page) {
  await page.context().grantPermissions(['geolocation'])
  await page.context().setGeolocation({ latitude: PUNE.latitude, longitude: PUNE.longitude })
  await mockBackend(page)
  await enterDemo(page)
  await page.locator('a[href="/map"]').first().dispatchEvent('click')
  await page.waitForURL('**/map')
  await page.getByRole('button', { name: /use my current location/i }).first().click()
  await expect(page.getByTestId('weather-map').locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId('forecast-days').locator('li')).toHaveCount(7, { timeout: 15_000 })
}

test('large screens: the forecast fills the column under Current conditions', async ({ page, isMobile }) => {
  test.skip(isMobile, 'two-column layout')
  await openMap(page)
  const map = (await page.getByTestId('weather-map').boundingBox())!
  const forecast = (await page.getByTestId('map-forecast').boundingBox())!
  // beside the map, not below it
  expect(forecast.x).toBeGreaterThan(map.x + map.width)
  expect(forecast.y).toBeLessThan(map.y + map.height)
  // the days are rows, one per line
  const days = page.getByTestId('forecast-days').locator('li')
  const first = (await days.nth(0).boundingBox())!
  const second = (await days.nth(1).boundingBox())!
  expect(second.y).toBeGreaterThan(first.y + first.height - 1)
  expect(Math.abs(second.x - first.x)).toBeLessThan(2)
})

test('phones: map, then Current conditions, then the forecast', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'phone layout')
  await openMap(page)
  const map = (await page.getByTestId('weather-map').boundingBox())!
  const forecast = (await page.getByTestId('map-forecast').boundingBox())!
  expect(forecast.y).toBeGreaterThan(map.y + map.height)
})
