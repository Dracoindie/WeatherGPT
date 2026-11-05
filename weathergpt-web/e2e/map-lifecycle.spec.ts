import { expect, test, type Page } from '@playwright/test'
import { enterDemo, mockBackend, PUNE } from './support/mockApi'

/**
 * Broadcast mode with a real (mocked-tile) terrain DEM source must not throw,
 * and leaving /map must dispose the map, the deck.gl overlay, the flyover loop
 * and every listener.
 *
 * Regression: deck.gl 9.4's MapboxOverlay reads `map.transform.elevation`
 * whenever MapLibre has terrain set (centerCameraOnTerrain). MapLibre 6 has no
 * `map.transform`, so every camera sync threw ("Cannot read properties of
 * undefined (reading 'elevation')"), thousands of times, and the flyover loop
 * outlived the page. The map is on MapLibre 5 (deck.gl's documented range),
 * where real 3D terrain works with the overlay.
 */

function watchErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`)
  })
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  return errors
}

async function openBroadcast(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('wgpt:lite-mode', 'off')
    // count animation frames the page runs (MapLibre, deck.gl and our flyover all use rAF)
    const w = window as unknown as { __frames: number }
    w.__frames = 0
    const raf = window.requestAnimationFrame.bind(window)
    window.requestAnimationFrame = (cb) => raf((t) => {
      w.__frames++
      cb(t)
    })
  })
  await page.context().grantPermissions(['geolocation'])
  await page.context().setGeolocation({ latitude: PUNE.latitude, longitude: PUNE.longitude })
  await mockBackend(page)
  const dem: string[] = []
  page.on('request', (r) => {
    if (/elevation-tiles-prod|terrain-rgb/.test(r.url())) dem.push(r.url())
  })
  await enterDemo(page)
  await page.locator('a[href="/map"]').first().dispatchEvent('click')
  await page.waitForURL('**/map')
  await page.getByRole('button', { name: /use my current location/i }).first().click()
  const map = page.getByTestId('weather-map')
  await expect(map.locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 30_000 })
  await page.getByTestId('map-broadcast').click()
  await expect(map).toHaveAttribute('data-broadcast', '3d')
  await expect(map).toHaveAttribute('data-terrain', 'on', { timeout: 15_000 })
  return { map, dem }
}

test('broadcast with a terrain DEM source: real 3D terrain, tilt and flyover, zero console errors', async ({ page }) => {
  const errors = watchErrors(page)
  const { map, dem } = await openBroadcast(page)
  // the DEM tiles really load (terrain and relief are drawn from them)
  await expect.poll(() => dem.length, { timeout: 15_000 }).toBeGreaterThan(0)
  // tilted, and the flyover turns the camera
  await expect.poll(async () => Number(await map.getAttribute('data-pitch')), { timeout: 10_000 }).toBeGreaterThan(30)
  // let the flyover and particles run for a while: every frame used to throw
  await page.waitForTimeout(4000)
  expect(errors).toEqual([])
  await page.getByTestId('map-broadcast-exit').click()
  await expect(map).toHaveAttribute('data-broadcast', 'off')
  await expect(map).toHaveAttribute('data-terrain', 'off')
  await page.waitForTimeout(1500)
  expect(errors).toEqual([])
})

test('leaving /map from broadcast stops every loop and disposes the map', async ({ page }) => {
  const errors = watchErrors(page)
  await openBroadcast(page)
  await page.waitForTimeout(2000)

  // client-side navigation back to the dashboard (the page unmounts, no reload)
  await page.goBack()
  await page.waitForURL('**/dashboard')
  await expect(page.getByTestId('weather-map')).toHaveCount(0)
  await expect(page.locator('.maplibregl-map')).toHaveCount(0)
  await expect(page.getByTestId('map-broadcast-root')).toHaveCount(0)
  expect(await page.evaluate(() => document.body.style.overflow)).toBe('')

  // let anything still scheduled drain, then measure: the dashboard has no animation loop
  await page.waitForTimeout(1500)
  const before = await page.evaluate(() => (window as unknown as { __frames: number }).__frames)
  await page.waitForTimeout(2000)
  const after = await page.evaluate(() => (window as unknown as { __frames: number }).__frames)
  // a running map/flyover loop would add ~120 frames in 2 s
  expect(after - before).toBeLessThan(10)
  expect(errors).toEqual([])
})
