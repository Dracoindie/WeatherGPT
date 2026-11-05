import { expect, test, type Page } from '@playwright/test'
import { enterDemo, MAP_POINT, mockBackend, PUNE } from './support/mockApi'

/**
 * /map: tap for point weather, layer toggles, the time slider, broadcast mode
 * and its reduced-motion / lite-mode 2D fallback. Every number checked here
 * is a fixture value from mockApi.ts (MAP_POINT, mapGrid), so the test also
 * checks that values reach the screen unchanged.
 */

test.beforeEach(async ({ context }) => {
  await context.grantPermissions(['geolocation'])
  await context.setGeolocation({ latitude: PUNE.latitude, longitude: PUNE.longitude })
})

async function openMap(page: Page, { pick = true } = {}) {
  await mockBackend(page)
  await enterDemo(page)
  await page.locator('a[href="/map"]').first().dispatchEvent('click')
  await page.waitForURL('**/map')
  if (pick) await page.getByRole('button', { name: /use my current location/i }).first().click()
  const map = page.getByTestId('weather-map')
  await expect(map.locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 30_000 })
  // the grid for the visible box has arrived
  await expect(page.getByTestId('map-legend')).toBeVisible({ timeout: 30_000 })
  return map
}

test('tap anywhere shows the point weather card with API values', async ({ page, isMobile }) => {
  const map = await openMap(page)
  const canvas = map.locator('canvas.maplibregl-canvas')
  await canvas.scrollIntoViewIfNeeded()
  const box = (await canvas.boundingBox())!
  // tap left of centre, away from the overlays
  const at = { x: box.x + box.width * 0.35, y: box.y + box.height * 0.45 }
  if (isMobile) await page.touchscreen.tap(at.x, at.y)
  else await page.mouse.click(at.x, at.y)

  const card = page.getByTestId('map-point-card')
  await expect(card.getByTestId('map-point-temp')).toHaveText(`${MAP_POINT.temperature_c}°C`, { timeout: 15_000 })
  await expect(card.getByTestId('map-point-feels')).toHaveText(`${MAP_POINT.feels_like_c}°C`)
  await expect(card.getByTestId('map-point-humidity')).toHaveText(`${MAP_POINT.humidity_pct}%`)
  await expect(card.getByTestId('map-point-wind')).toContainText(`${MAP_POINT.wind_speed_kmh} km/h`)
  await expect(card).toContainText('from west') // 250°
  await expect(card).toContainText(`${MAP_POINT.wind_direction_deg}°`)
  await expect(card.getByTestId('map-point-rain')).toHaveText(`${MAP_POINT.precipitation_probability_pct}%`)
  await expect(card.getByTestId('map-point-aqi')).toContainText(`${MAP_POINT.aqi}`)
  await expect(card.getByTestId('map-point-aqi')).toContainText('Satisfactory')
  await expect(card.getByTestId('map-point-uv')).toContainText(`${MAP_POINT.uv_index}`)
  await expect(card.getByTestId('map-point-time')).toContainText('14:45')
  await expect(card.getByTestId('map-point-heat')).toContainText(`${MAP_POINT.heat_index_c}°C`)
  await expect(card.getByTestId('map-point-heat')).toContainText('Extreme caution')
  await expect(card).toContainText('not official IMD')

  // the honesty line under the map
  await expect(page.getByTestId('map-resolution').first()).toContainText('Model grid ≈ 8 km')
  await expect(page.getByTestId('map-resolution').first()).toContainText('not official IMD')

  await card.getByRole('button', { name: 'Close' }).click()
  await expect(card).toHaveCount(0)
})

test('keyboard users get point weather for the map centre', async ({ page }) => {
  await openMap(page)
  await page.getByTestId('map-centre').focus()
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('map-point-temp')).toHaveText(`${MAP_POINT.temperature_c}°C`, { timeout: 15_000 })
})

test('point card is in Marathi when the UI is', async ({ page, isMobile }) => {
  test.skip(isMobile, 'language buttons sit in the desktop nav')
  await openMap(page)
  await page.getByRole('button', { name: 'मरा', exact: true }).first().click()
  await page.getByTestId('map-centre').click()
  const card = page.getByTestId('map-point-card')
  await expect(card.getByTestId('map-point-temp')).toHaveText(`${MAP_POINT.temperature_c}°C`, { timeout: 15_000 })
  await expect(card).toContainText('इथले हवामान')
  await expect(card).toContainText('आर्द्रता')
  await expect(card).toContainText('पश्चिमकडून')
  await expect(card).toContainText('अतिशय सावधगिरी')
  await expect(card).toContainText('अधिकृत IMD नाही')
})

test('layer toggles switch the surface and legend; the time slider moves the hour', async ({ page }) => {
  const map = await openMap(page)
  const legend = page.getByTestId('map-legend')
  await expect(legend).toHaveAttribute('data-layer', 'temperature')

  for (const layer of ['humidity', 'wind', 'rain', 'heat', 'temperature'] as const) {
    const button = page.getByTestId(`map-layer-${layer}`)
    await button.click()
    await expect(button).toHaveAttribute('aria-pressed', 'true')
    await expect(map).toHaveAttribute('data-layer', layer)
    await expect(legend).toHaveAttribute('data-layer', layer)
  }

  // humidity range is the fixture's: 50 % to 80 %
  await page.getByTestId('map-layer-humidity').click()
  await expect(page.getByTestId('map-legend-min')).toHaveText('50')
  await expect(page.getByTestId('map-legend-max')).toHaveText('80')

  // heat bands and their bounds come from the API (thresholds.py), with the guidance label
  await page.getByTestId('map-layer-heat').click()
  await expect(legend).toContainText('Caution')
  await expect(legend).toContainText('≥ 26.7')
  await expect(legend).toContainText('Extreme danger')
  await expect(legend).toContainText('Not an official warning')

  const label = page.getByTestId('map-time-label')
  const before = await label.innerText()
  await page.getByTestId('map-time-slider').fill('30')
  await expect(label).not.toHaveText(before)
})

test('broadcast mode: 3D terrain, particles, big title; Esc leaves', async ({ page }) => {
  // Headless Chromium draws WebGL in software, where lite mode turns on by
  // itself; force it off to exercise the full 3D path.
  await page.addInitScript(() => localStorage.setItem('wgpt:lite-mode', 'off'))
  const map = await openMap(page)
  await page.getByTestId('map-broadcast').click()

  await expect(map).toHaveAttribute('data-broadcast', '3d')
  // the camera tilts for the 3D terrain
  await expect.poll(async () => Number(await map.getAttribute('data-pitch')), { timeout: 10_000 }).toBeGreaterThan(30)
  await expect(page.getByTestId('map-broadcast-title')).toContainText('Pune')
  await expect(page.getByTestId('map-broadcast-title')).toContainText('Temperature')
  await expect(page.getByTestId('map-broadcast-root').getByTestId('map-legend').filter({ visible: true })).toBeVisible()
  await expect(page.getByTestId('map-resolution')).toContainText('Model grid ≈ 8 km')
  const particles = Number(await map.getAttribute('data-particles'))
  expect(particles).toBeGreaterThan(0)
  // the broadcast view fills the screen, above the app header
  const vp = page.viewportSize()!
  const box = (await page.getByTestId('map-broadcast-root').boundingBox())!
  expect(box.width).toBeGreaterThanOrEqual(vp.width - 1)
  expect(box.height).toBeGreaterThanOrEqual(vp.height - 1)
  await expect(page.getByTestId('map-broadcast-root').locator('canvas.maplibregl-canvas')).toBeVisible()

  await page.keyboard.press('Escape')
  await expect(map).toHaveAttribute('data-broadcast', 'off')
})

test('reduced motion: broadcast falls back to a still 2D view', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.addInitScript(() => localStorage.setItem('wgpt:lite-mode', 'off'))
  const map = await openMap(page)
  await page.getByTestId('map-broadcast').click()
  await expect(map).toHaveAttribute('data-broadcast', '2d')
  await expect(map).toHaveAttribute('data-particles', '0')
  await expect(page.getByTestId('map-resolution')).toContainText('2D view')
  await expect(map).toHaveAttribute('data-pitch', '0')
  await page.getByTestId('map-broadcast-exit').click()
  await expect(map).toHaveAttribute('data-broadcast', 'off')
})

test('lite mode: broadcast stays 2D', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('wgpt:lite-mode', 'on'))
  const map = await openMap(page)
  await page.getByTestId('map-broadcast').click()
  await expect(map).toHaveAttribute('data-broadcast', '2d')
  await expect(map).toHaveAttribute('data-particles', '0')
})

test('the map loads only on /map', async ({ page }) => {
  await mockBackend(page)
  const scripts: string[] = []
  page.on('response', (r) => {
    if (r.request().resourceType() === 'script') scripts.push(r.url())
  })
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  const bodies = await Promise.all(
    scripts.filter((u) => u.includes('/_next/static/')).map((u) => page.request.get(u).then((r) => r.text()))
  )
  expect(bodies.some((b) => b.includes('maplibre') || b.includes('deck.gl'))).toBe(false)
})

test('the map ends centred on the picked place, even when the page grows mid-flight', async ({ page }) => {
  // motion on: the fly-to animates while the alert banner and panels appear
  await page.addInitScript(() => localStorage.setItem('wgpt:lite-mode', 'off'))
  await mockBackend(page)
  await enterDemo(page)
  await page.locator('a[href="/map"]').first().dispatchEvent('click')
  await page.waitForURL('**/map')
  await page.locator('canvas.maplibregl-canvas').waitFor({ timeout: 30_000 })
  await page.getByRole('button', { name: /use my current location/i }).first().click()
  await expect(page.getByTestId('weather-map')).toHaveAttribute('data-center', '18.520,73.857', { timeout: 10_000 })
})

test('weather surface: under the roads and labels, semi-transparent, coloured by the hour shown, fixed scale while playing', async ({ page }) => {
  const map = await openMap(page)
  // a MapLibre raster inserted below the basemap's first road/label layer ('roads-base' in the test style)
  await expect(map).toHaveAttribute('data-field-before', 'roads-base', { timeout: 15_000 })
  const opacity = Number(await map.getAttribute('data-field-opacity'))
  expect(opacity).toBeGreaterThanOrEqual(0.35)
  expect(opacity).toBeLessThanOrEqual(0.45)
  // the fixture varies across the view, so the surface must use many colours, not one
  await expect.poll(async () => Number(await map.getAttribute('data-field-colors')), { timeout: 10_000 }).toBeGreaterThan(8)

  // the scale (and legend) is the range at the hour shown: fixture temperature is
  // 24 + 0.8 row + 0.4 col + 4 sin(2 pi h / 24), so the minimum is 24 at hour 0 and 28 at hour 6
  await expect(page.getByTestId('map-legend-min')).toHaveText('24')
  await page.getByTestId('map-time-slider').fill('6')
  await expect(page.getByTestId('map-legend-min')).toHaveText('28')
  await expect(page.getByTestId('map-legend-scale')).toHaveAttribute('data-scale', 'hour')

  // playing: one fixed scale for all hours (the 72 h minimum is 24 - 4 = 20 at hour 18), said in the legend
  await page.getByTestId('map-play').click()
  await expect(page.getByTestId('map-legend-scale')).toHaveAttribute('data-scale', 'fixed')
  await expect(page.getByTestId('map-legend-scale')).toHaveText(/fixed scale for all 72 hours/)
  await expect(page.getByTestId('map-legend-min')).toHaveText('20')
  await page.waitForTimeout(2000) // the hours advance; the scale does not
  await expect(page.getByTestId('map-legend-min')).toHaveText('20')
  await page.getByTestId('map-play').click()
  await expect(page.getByTestId('map-legend-scale')).toHaveAttribute('data-scale', 'hour')

  // hazard mode has no surface
  await page.getByTestId('map-layer-hazard').click()
  await expect(map).not.toHaveAttribute('data-field-before', /.*/)
})

test('grid: a pan or small zoom inside the loaded grid sends no new request; leaving it does', async ({ page }) => {
  const map = await openMap(page)
  await expect(map).toHaveAttribute('data-center', `${PUNE.latitude.toFixed(3)},${PUNE.longitude.toFixed(3)}`, { timeout: 15_000 })
  await expect(page.getByTestId('map-legend')).toBeVisible({ timeout: 15_000 })
  await page.waitForTimeout(1500) // let the fly-to and its request settle
  const before = Number(await map.getAttribute('data-grid-requests'))
  expect(before).toBeGreaterThan(0)

  // a small drag stays inside the loaded grid (it reaches a step past every edge)
  const canvas = map.locator('canvas.maplibregl-canvas')
  const box = (await canvas.boundingBox())!
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2
  await page.mouse.move(cx, cy)
  await page.mouse.down()
  await page.mouse.move(cx + 12, cy + 8, { steps: 4 })
  await page.mouse.up()
  await page.waitForTimeout(1200)
  expect(Number(await map.getAttribute('data-grid-requests'))).toBe(before)

  // zooming out leaves it: one new request after the move settles
  await page.getByRole('button', { name: /zoom out/i }).click()
  await expect.poll(async () => Number(await map.getAttribute('data-grid-requests')), { timeout: 10_000 }).toBe(before + 1)
})
