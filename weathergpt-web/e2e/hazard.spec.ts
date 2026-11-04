import { expect, test, type Page } from '@playwright/test'
import { enterDemo, mockBackend, PUNE } from './support/mockApi'

/**
 * /map hazard mode: hexes by level, the hazard-type chips, the tap card with
 * value vs threshold, roads coloured by hazard (not traffic), the summary and
 * "Show me the worst". Every number is a fixture value (mockApi.ts
 * HAZARD_POINTS / mapHazardSummary), thresholds from thresholds.json.
 *
 * Agreement with alerts is proven in the backend (tests/test_hazard.py, the
 * same Open-Meteo data through /api/alerts, the risk board, push and the
 * hazard map). Here: the hex at the place and the alert banner show the same
 * level for the same fixture data.
 */

test.beforeEach(async ({ context }) => {
  await context.grantPermissions(['geolocation'])
  await context.setGeolocation({ latitude: PUNE.latitude, longitude: PUNE.longitude })
})

async function openHazard(page: Page) {
  await mockBackend(page)
  await enterDemo(page)
  await page.locator('a[href="/map"]').first().dispatchEvent('click')
  await page.waitForURL('**/map')
  await page.getByRole('button', { name: /use my current location/i }).first().click()
  const map = page.getByTestId('weather-map')
  await expect(map.locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 30_000 })
  await page.getByTestId('map-layer-hazard').click()
  await expect(map).toHaveAttribute('data-layer', 'hazard')
  await expect.poll(async () => Number(await map.getAttribute('data-hazard-cells')), { timeout: 20_000 }).toBeGreaterThan(0)
  return map
}

test('hazard layer: hexes, five-level legend, type chips', async ({ page }) => {
  const map = await openHazard(page)
  const legend = page.getByTestId('map-legend')
  await expect(legend).toHaveAttribute('data-layer', 'hazard')
  for (const level of ['None', 'Advisory', 'Watch', 'Warning', 'Severe']) {
    await expect(legend).toContainText(level)
  }
  await expect(page.getByTestId('map-resolution')).toContainText('Model grid ≈ 8 km')
  await expect(page.getByTestId('map-resolution')).toContainText('not official IMD')

  for (const type of ['rain', 'heat', 'wind', 'storm', 'cold', 'overall'] as const) {
    await page.getByTestId(`map-hazard-${type}`).click()
    await expect(map).toHaveAttribute('data-hazard-type', type)
    await expect(page.getByTestId(`map-hazard-${type}`)).toHaveAttribute('aria-pressed', 'true')
  }
})

test('roads are coloured by hazard, and the legend says it is not traffic', async ({ page }) => {
  const map = await openHazard(page)
  await expect.poll(async () => Number(await map.getAttribute('data-road-pieces')), { timeout: 20_000 }).toBeGreaterThan(0)
  await expect(page.getByTestId('map-roads-note')).toContainText('NOT traffic')
})

test('tap a hex: level, value vs threshold, window, honesty note; agrees with the alert banner', async ({ page }) => {
  await openHazard(page)
  // the map is centred on the place; the centre button picks the hex there (keyboard path)
  await page.getByTestId('map-centre').click()
  const card = page.getByTestId('map-hazard-card')
  await expect(card).toBeVisible({ timeout: 15_000 })
  await expect(card).toContainText('Watch')
  await expect(card.getByTestId('map-hazard-trigger-rain')).toContainText('Heavy rain')
  await expect(card.getByTestId('map-hazard-trigger-rain')).toContainText('45 mm ≥ 15 mm')
  await expect(card.getByTestId('map-hazard-rain')).toHaveText('45 mm')
  await expect(card.getByTestId('map-hazard-window')).toContainText('–')
  await expect(card.getByTestId('map-hazard-note')).toContainText('not official IMD')
  await expect(card.getByTestId('map-hazard-note')).toContainText('model grid ≈ 8 km')

  // the alert banner for the same place and data says Watch too
  await expect(page.locator('[data-severity="watch"]').first()).toBeVisible()

  // a type with no rule firing at the place
  await page.getByTestId('map-hazard-heat').click()
  await expect(card.getByTestId('map-hazard-none')).toBeVisible()
})

test('a mouse tap on the place picks its hex', async ({ page, isMobile }) => {
  test.skip(isMobile, 'touch taps are covered by the centre button on phones')
  await openHazard(page)
  const canvas = page.locator('[data-testid="weather-map"] canvas.maplibregl-canvas')
  await canvas.scrollIntoViewIfNeeded()
  const box = (await canvas.boundingBox())!
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  await expect(page.getByTestId('map-hazard-card')).toContainText('45 mm ≥ 15 mm', { timeout: 15_000 })
})

test('summary within 25 km and Show me the worst', async ({ page }) => {
  const map = await openHazard(page)
  const summary = page.getByTestId('map-hazard-summary')
  await expect(summary).toContainText('Within 25 km of Pune', { timeout: 15_000 })
  await expect(summary.getByTestId('map-hazard-count-warning')).toContainText('3 cells')
  await expect(summary.getByTestId('map-hazard-count-watch')).toContainText('7 cells')
  await expect(summary.getByTestId('map-hazard-maxrain')).toContainText('72 mm')
  await expect(summary.getByTestId('map-hazard-worst')).toContainText('Warning')
  await expect(summary.getByTestId('map-hazard-worst')).toContainText('in 4 h')
  await expect(summary).toContainText('not official IMD')

  await page.getByTestId('map-show-worst').click()
  // the slider jumps to the worst window and the map moves there
  await expect(page.getByTestId('map-time-slider')).toHaveValue('4')
  // the summary's worst cell is at 18.6, 74.1 (mapHazardSummary)
  await expect(map).toHaveAttribute('data-center', '18.600,74.100', { timeout: 10_000 })
  await expect(map).toHaveAttribute('data-hazard-cells', /[1-9]/)
})

test('the time slider moves the hazard window', async ({ page }) => {
  await openHazard(page)
  await page.getByTestId('map-centre').click()
  const windowLabel = page.getByTestId('map-hazard-window')
  const before = await windowLabel.innerText()
  await page.getByTestId('map-time-slider').fill('12')
  await expect(windowLabel).not.toHaveText(before, { timeout: 10_000 })
  // hazard windows stop where a full 24 h still fits
  await expect(page.getByTestId('map-time-slider')).toHaveAttribute('max', '48')
})

test('"Ask about this area" opens the console with a question for that hex, time and language', async ({ page, isMobile }) => {
  await openHazard(page)
  await page.getByTestId('map-centre').click()
  const card = page.getByTestId('map-hazard-card')
  await expect(card).toBeVisible({ timeout: 15_000 })
  const ask = card.getByTestId('map-hazard-ask')
  await expect(ask).toContainText('Ask about this area')

  // the Pune hex has a heavy-rain watch, so the question is about rain; hour 0 is today
  const url = new URL((await ask.getAttribute('href'))!, 'http://x')
  expect(url.pathname).toBe('/')
  expect(url.searchParams.get('q')).toBe('Will there be heavy rain here today?')
  // the hex centre, not the map centre: within one res-5 hex (~10 km) of Pune
  expect(Math.abs(Number(url.searchParams.get('lat')) - 18.52)).toBeLessThan(0.15)
  expect(Math.abs(Number(url.searchParams.get('lon')) - 73.86)).toBeLessThan(0.15)

  // the window two days ahead is asked about as a later day, never as "today"
  await page.getByTestId('map-time-slider').fill('48')
  await expect.poll(async () => new URL((await ask.getAttribute('href'))!, 'http://x').searchParams.get('q')).toMatch(/^Will there be heavy rain here (tomorrow|the day after tomorrow)\?$/)

  await page.getByTestId('map-time-slider').fill('0')
  await expect.poll(async () => new URL((await ask.getAttribute('href'))!, 'http://x').searchParams.get('q')).toBe('Will there be heavy rain here today?')
  if (!isMobile) {
    // the question follows the UI language
    await page.getByRole('button', { name: 'हिं', exact: true }).first().click()
    await expect(card.getByTestId('map-hazard-ask')).toContainText('इस इलाक़े के बारे में पूछें')
    const hi = new URL((await card.getByTestId('map-hazard-ask').getAttribute('href'))!, 'http://x')
    expect(hi.searchParams.get('q')).toBe('क्या आज यहाँ भारी बारिश होगी?')
  }

  // the console receives it and asks it
  await card.getByTestId('map-hazard-ask').click()
  await page.waitForURL((u) => u.pathname === '/')
  await expect(page.getByText(/heavy rain here today|यहाँ भारी बारिश/).first()).toBeVisible({ timeout: 15_000 })
})

test('hazard words follow the UI language', async ({ page, isMobile }) => {
  test.skip(isMobile, 'language buttons sit in the desktop nav')
  await openHazard(page)
  await page.getByRole('button', { name: 'हिं', exact: true }).first().click()
  await expect(page.getByTestId('map-roads-note')).toContainText('ट्रैफ़िक नहीं')
  await expect(page.getByTestId('map-hazard-summary')).toContainText('किमी के भीतर')
})
