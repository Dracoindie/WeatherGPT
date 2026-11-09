import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { enterDemo, mockBackend, PUNE, type MockOptions } from './support/mockApi'

/**
 * /map route mode (docs/ROUTES.md): pick a start and a destination, the route
 * line coloured by the estimated hazard when you pass, the report (timeline,
 * findings, honesty) and the departure suggestion. Every value is a fixture
 * (mockApi.ts mapRoute); the scoring itself is tested in tests/test_routes.py.
 */

test.beforeEach(async ({ context }) => {
  await context.grantPermissions(['geolocation'])
  await context.setGeolocation({ latitude: PUNE.latitude, longitude: PUNE.longitude })
})

async function openRoute(page: Page, opts: MockOptions = {}) {
  await mockBackend(page, opts)
  await enterDemo(page)
  await page.locator('a[href="/map"]').first().dispatchEvent('click')
  await page.waitForURL('**/map')
  await page.getByRole('button', { name: /use my current location/i }).first().click()
  const map = page.getByTestId('weather-map')
  await expect(map.locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 30_000 })
  await page.getByTestId('map-layer-route').click()
  await expect(map).toHaveAttribute('data-layer', 'route')
  return map
}

async function toMumbai(page: Page) {
  await page.getByTestId('route-to-input').fill('Mumbai')
  await page.getByTestId('route-to-search').click()
  await expect(page.getByTestId('route-to-name')).toHaveText('Mumbai')
}

test('pick a route: coloured line, report, findings and honesty', async ({ page }) => {
  const map = await openRoute(page)
  // the picked place is the start
  await expect(page.getByTestId('route-from-name')).toContainText('Pune')
  await toMumbai(page)
  await page.getByTestId('route-go').click()

  const report = page.getByTestId('route-report')
  await expect(report).toBeVisible({ timeout: 15_000 })
  // the line on the map: one piece per stretch, coloured by level
  await expect(map).toHaveAttribute('data-route-segments', '3')
  await expect(map).toHaveAttribute('data-route-worst', 'watch')
  await expect(report).toHaveAttribute('data-worst', 'watch')

  // timeline strip: the same stretches, with km and clock time
  const strip = page.getByTestId('route-timeline')
  await expect(strip.locator('[data-level]')).toHaveCount(3)
  await expect(strip.locator('[data-level="watch"]')).toHaveAttribute('aria-label', /km 58–73: Watch/)
  await expect(page.getByTestId('route-summary')).toContainText('120 km · about 2 h 0 min')

  // plain-language finding with place, time and level, and its value vs threshold
  const finding = page.getByTestId('route-finding-rain')
  await expect(finding).toContainText(/Heavy rain near Kasara around \d\d:\d\d \(Watch\)/)
  await expect(finding).toContainText('WMO 65')
  await expect(finding).toContainText('km 60–70')
  await expect(finding).toContainText('on NH160')

  // honesty: estimated, model resolution, never "safe", not IMD, not traffic
  const honesty = page.getByTestId('route-honesty')
  await expect(honesty).toContainText('model data (grid ≈ 8 km, a sample every 5 km)')
  await expect(honesty).toContainText('does not mean the road is safe')
  await expect(honesty).toContainText('Not official IMD')
  await expect(honesty).toContainText('no uptime guarantee')
  await expect(page.getByTestId('route-legend')).toContainText('NOT traffic')
  const text = await report.innerText()
  expect(text.replace(/does not mean the road is safe/g, '')).not.toMatch(/\bsafe\b/i)
})

test('departure suggestion: leaving later avoids the rain, and can be applied', async ({ page }) => {
  await openRoute(page)
  await toMumbai(page)
  await page.getByTestId('route-go').click()
  const suggestion = page.getByTestId('route-suggestion-text')
  await expect(suggestion).toHaveText(/^Leaving at \d\d:\d\d avoids the rain\.$/, { timeout: 15_000 })
  // 49 departures over 12 h: now at watch, the rest none
  const deps = page.getByTestId('route-departures').locator('li')
  await expect(deps).toHaveCount(49)
  await expect(deps.first()).toHaveAttribute('data-level', 'watch')
  await expect(deps.first()).toHaveAttribute('data-chosen', 'true')
  await expect(deps.nth(1)).toHaveAttribute('data-level', 'none')
  await expect(deps.nth(1)).toHaveAttribute('data-suggested', 'true')
  await expect(deps.first()).toContainText(/Leave \d\d:\d\d: Watch/)

  const asked = page.waitForRequest((r) => r.url().includes('/api/route') && r.url().includes('depart='))
  await page.getByTestId('route-use-suggestion').click()
  await asked
  // dry all the way at every departure: positive wording, not "no lower hazard"
  await expect(page.getByTestId('route-all-clear')).toHaveText('Clear along the whole way: any departure in the next 12 h looks fine.', { timeout: 15_000 })
  await expect(page.getByTestId('route-best-already')).toHaveCount(0)
  await expect(page.getByTestId('route-report')).toHaveAttribute('data-worst', 'none')
  await expect(page.getByTestId('route-no-findings')).toBeVisible()
  await expect(page.getByTestId('route-depart-later')).toHaveAttribute('aria-pressed', 'true')
})

test('pick the destination on the map, and a later departure', async ({ page }) => {
  const map = await openRoute(page)
  await page.getByTestId('route-to-pick').click()
  await expect(map).toHaveAttribute('data-route-picking', 'to')
  await expect(page.getByTestId('route-picking')).toBeVisible()
  // the keyboard path: "Weather at map centre" taps the map centre
  await page.getByTestId('map-centre').click()
  await expect(page.getByTestId('route-to-name')).toContainText('Map point')
  await expect(map).not.toHaveAttribute('data-route-picking', /.+/)

  await page.getByTestId('route-depart-later').click()
  const at = page.getByTestId('route-depart-at')
  await expect(at).toBeVisible()
  expect(await at.getAttribute('max')).toBeTruthy()
  const asked = page.waitForRequest((r) => r.url().includes('/api/route'))
  await page.getByTestId('route-go').click()
  const url = new URL((await asked).url())
  expect(url.searchParams.get('depart')).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:00\.000Z$/)
  expect(Number(url.searchParams.get('to_lat'))).toBeGreaterThan(0)
})

test('routing unavailable: a clear message, the map keeps working', async ({ page }) => {
  await openRoute(page, { fail: { '/api/route': 503 } })
  await toMumbai(page)
  await page.getByTestId('route-go').click()
  await expect(page.getByTestId('route-error')).toContainText('Route planning is unavailable right now')
  await expect(page.getByTestId('route-error')).toContainText('no uptime guarantee')
  await page.getByTestId('map-layer-temperature').click()
  await expect(page.getByTestId('weather-map')).toHaveAttribute('data-layer', 'temperature')
})

test('route words follow the UI language', async ({ page, isMobile }) => {
  test.skip(isMobile, 'language buttons sit in the desktop nav')
  await openRoute(page)
  await toMumbai(page)
  await page.getByTestId('route-go').click()
  await expect(page.getByTestId('route-report')).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: 'हिं', exact: true }).first().click()
  await expect(page.getByTestId('route-finding-rain')).toContainText(/Kasara के पास लगभग \d\d:\d\d बजे भारी बारिश/)
  await expect(page.getByTestId('route-legend')).toContainText('ट्रैफ़िक नहीं')
  await page.getByRole('button', { name: 'मरा', exact: true }).first().click()
  await expect(page.getByTestId('route-legend')).toContainText('वाहतूक नाही')
  await expect(page.getByTestId('route-suggestion-text')).toContainText('पाऊस टाळता येईल')

  // a calm route in every language (here after taking the suggested departure)
  await page.getByTestId('route-use-suggestion').click()
  await expect(page.getByTestId('route-all-clear')).toContainText('संपूर्ण मार्गावर हवामान स्वच्छ', { timeout: 15_000 })
  await page.getByRole('button', { name: 'हिं', exact: true }).first().click()
  await expect(page.getByTestId('route-all-clear')).toContainText('पूरे रास्ते मौसम साफ़')
  await page.getByRole('button', { name: 'Hing', exact: true }).first().click()
  await expect(page.getByTestId('route-all-clear')).toContainText('Poore raaste mausam saaf')
})

test('route planner and report pass axe (no serious or critical issues)', async ({ page }) => {
  await openRoute(page)
  await toMumbai(page)
  await page.getByTestId('route-go').click()
  await expect(page.getByTestId('route-report')).toBeVisible({ timeout: 15_000 })
  const result = await new AxeBuilder({ page })
    .include('[data-testid=route-planner]')
    .include('[data-testid=route-report]')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze()
  const blocking = result.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
  expect(blocking.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([])
})

test('no horizontal scroll with the route planner and report', async ({ page }) => {
  await openRoute(page)
  await toMumbai(page)
  await page.getByTestId('route-go').click()
  await expect(page.getByTestId('route-report')).toBeVisible({ timeout: 15_000 })
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(1)
})
