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

test('icons missing from the basemap sprite get a fallback, without warnings', async ({ page }) => {
  // the test style has a point of interest asking for "circle-11", like OpenFreeMap dark
  const warnings: string[] = []
  page.on('console', (m) => {
    if ((m.type() === 'warning' || m.type() === 'error') && /could not be loaded|circle-11/.test(m.text())) warnings.push(m.text())
  })
  await page.context().grantPermissions(['geolocation'])
  await page.context().setGeolocation({ latitude: PUNE.latitude, longitude: PUNE.longitude })
  await mockBackend(page)
  await enterDemo(page)
  await page.locator('a[href="/map"]').first().dispatchEvent('click')
  await page.waitForURL('**/map')
  await page.getByRole('button', { name: /use my current location/i }).first().click()
  await expect(page.getByTestId('weather-map').locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId('map-legend')).toBeVisible({ timeout: 30_000 })
  await page.waitForTimeout(2000)
  expect(warnings).toEqual([])
})

test('broadcast keeps the place in view and exit restores the view', async ({ page, isMobile }) => {
  // Regression: the portal move made the container 0x0 for a moment, and the
  // resize + tilt computed at that size moved the centre ~330 km from Pune.
  await page.addInitScript(() => localStorage.setItem('wgpt:lite-mode', 'off'))
  await page.context().grantPermissions(['geolocation'])
  await page.context().setGeolocation({ latitude: PUNE.latitude, longitude: PUNE.longitude })
  await mockBackend(page)
  await enterDemo(page)
  await page.locator('a[href="/map"]').first().dispatchEvent('click')
  await page.waitForURL('**/map')
  await page.getByRole('button', { name: /use my current location/i }).first().click()
  const map = page.getByTestId('weather-map')
  await expect(map.locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 30_000 })
  const at = `${PUNE.latitude.toFixed(3)},${PUNE.longitude.toFixed(3)}`
  await expect(map).toHaveAttribute('data-center', at, { timeout: 15_000 })

  await page.getByTestId('map-broadcast').click()
  // the broadcast tilt: 58 on phones, 64 on wide maps (camera.ts)
  await expect(map).toHaveAttribute('data-pitch', isMobile ? '58' : '64', { timeout: 15_000 })
  await page.waitForTimeout(1000)
  await expect(map).toHaveAttribute('data-center', at)

  await page.getByRole('button', { name: /exit broadcast/i }).click()
  await expect(map).toHaveAttribute('data-pitch', '0', { timeout: 15_000 })
  await page.waitForTimeout(1000)
  await expect(map).toHaveAttribute('data-center', at)
})

async function openMapNoPick(page: Page) {
  await page.context().grantPermissions(['geolocation'])
  await page.context().setGeolocation({ latitude: PUNE.latitude, longitude: PUNE.longitude })
  await mockBackend(page)
  await enterDemo(page)
  await page.locator('a[href="/map"]').first().dispatchEvent('click')
  await page.waitForURL('**/map')
  const map = page.getByTestId('weather-map')
  await expect(map.locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 30_000 })
  return map
}

// OSMF Attribution Guidelines: the credit is visible at first; it may fold on
// map interaction or after five seconds, and an (i) button must bring it back.
test('small screens: the map credit starts expanded and folds to (i) on the first user pan', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'compact credits are for maps <= 640 px wide')
  const map = await openMapNoPick(page)
  const attrib = map.locator('.maplibregl-ctrl-attrib')
  await expect(attrib).toHaveClass(/maplibregl-compact-show/)
  await expect(attrib.getByRole('link', { name: /OpenStreetMap/ })).toBeVisible()
  const box = (await map.locator('canvas.maplibregl-canvas').boundingBox())!
  const t0 = Date.now()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + 30, box.y + box.height / 2 + 10, { steps: 5 })
  await page.mouse.up()
  await expect(attrib).not.toHaveClass(/maplibregl-compact-show/, { timeout: 2000 })
  expect(Date.now() - t0).toBeLessThan(4000) // the pan folded it, not the 5 s timer
  // the (i) button brings the credit and its licence link back
  await attrib.locator('.maplibregl-ctrl-attrib-button').click()
  await expect(attrib).toHaveClass(/maplibregl-compact-show/)
  await expect(attrib.getByRole('link', { name: /OpenStreetMap/ })).toHaveAttribute('href', /openstreetmap\.org\/copyright/)
})

test('small screens: without interaction the map credit folds to (i) after 5 s', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'compact credits are for maps <= 640 px wide')
  const map = await openMapNoPick(page)
  const attrib = map.locator('.maplibregl-ctrl-attrib')
  await expect(attrib).toHaveClass(/maplibregl-compact-show/)
  await expect(attrib).not.toHaveClass(/maplibregl-compact-show/, { timeout: 9000 })
  await expect(attrib.locator('.maplibregl-ctrl-attrib-button')).toBeVisible()
})

test('wide screens: the map credit is never folded', async ({ page, isMobile }) => {
  test.skip(isMobile, 'wide maps only')
  const map = await openMapNoPick(page)
  const attrib = map.locator('.maplibregl-ctrl-attrib')
  await page.waitForTimeout(6000)
  await expect(attrib).not.toHaveClass(/maplibregl-compact/)
  await expect(attrib.getByRole('link', { name: /OpenStreetMap/ })).toBeVisible()
})
