import { expect, test } from '@playwright/test'
import { enterDemo, mockBackend, PUNE } from './support/mockApi'

/**
 * Broadcast on phones: a compact lower third (one-line title, the legend
 * folded behind a toggle) that stays clear of the map credit, so the (i)
 * button and the expanded credit are always reachable.
 */
test('phones: compact broadcast panel, legend toggle, map credit not covered', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'phone layout')
  await page.addInitScript(() => localStorage.setItem('wgpt:lite-mode', 'off'))
  await page.context().grantPermissions(['geolocation'])
  await page.context().setGeolocation({ latitude: PUNE.latitude, longitude: PUNE.longitude })
  await mockBackend(page)
  await enterDemo(page)
  await page.locator('a[href="/map"]').first().dispatchEvent('click')
  await page.waitForURL('**/map')
  await page.getByRole('button', { name: /use my current location/i }).first().click()
  await expect(page.getByTestId('weather-map').locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId('map-legend').first()).toBeVisible({ timeout: 15_000 })
  await page.getByTestId('map-broadcast').click()
  const root = page.getByTestId('map-broadcast-root')

  // one line: the title box is no taller than one line of its text plus padding
  const title = page.getByTestId('map-broadcast-title')
  await expect(title).toContainText('Pune')
  const lineHeight = await title.evaluate((el) => parseFloat(getComputedStyle(el).lineHeight))
  expect((await title.boundingBox())!.height).toBeLessThan(lineHeight * 1.5 + 16)

  // the legend starts folded; the toggle opens and closes it
  const toggle = page.getByTestId('map-broadcast-legend-toggle')
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await expect(root.getByTestId('map-legend').filter({ visible: true })).toHaveCount(0)
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  await expect(root.getByTestId('map-legend').filter({ visible: true })).toBeVisible()
  await toggle.click()
  await expect(root.getByTestId('map-legend').filter({ visible: true })).toHaveCount(0)

  // the folded panel leaves most of the screen to the map
  const vh = page.viewportSize()!.height
  const panel = (await page.getByTestId('map-broadcast-panel').boundingBox())!
  expect(panel.height / vh).toBeLessThan(0.3)

  // the map credit, expanded (it folds after 5 s; the (i) button opens it), sits below the panel, not under it
  const attrib = root.locator('.maplibregl-ctrl-attrib')
  if (!/maplibregl-compact-show/.test((await attrib.getAttribute('class')) ?? '')) await attrib.locator('.maplibregl-ctrl-attrib-button').click()
  await expect(attrib).toHaveClass(/maplibregl-compact-show/)
  const credit = (await attrib.boundingBox())!
  expect(credit.y).toBeGreaterThanOrEqual(panel.y + panel.height - 1)
  await expect(attrib.getByRole('link', { name: /OpenStreetMap/ })).toBeVisible()
})
