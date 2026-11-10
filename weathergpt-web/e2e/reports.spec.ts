import { expect, test, type Page } from '@playwright/test'
import { enterDemo, mockBackend, PUNE, reportsFixture, signIn, type MockOptions } from './support/mockApi'

/**
 * Community reports on /map (docs/REPORTS.md): the reports layer, the tap card
 * (trust and why, photo, approximate time, "community report, unverified"),
 * the signed-in "Report what you see" flow with a photo, Confirm / Flag, and
 * the error messages. The backend is mocked (mockApi.ts reportsFixture: one
 * high, one medium and one low-trust report; the low one is hidden by default).
 */

test.beforeEach(async ({ context }) => {
  await context.grantPermissions(['geolocation'])
  await context.setGeolocation({ latitude: PUNE.latitude, longitude: PUNE.longitude })
})

async function openReports(page: Page) {
  await page.locator('a[href="/map"]').first().dispatchEvent('click')
  await page.waitForURL('**/map')
  await page.getByRole('button', { name: /use my current location/i }).first().click()
  const map = page.getByTestId('weather-map')
  await expect(map.locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 30_000 })
  await expect(map).toHaveAttribute('data-center', '18.520,73.857', { timeout: 15_000 })
  await page.getByTestId('map-layer-reports').click()
  await expect(map).toHaveAttribute('data-layer', 'reports')
  return map
}

async function demo(page: Page, opts: MockOptions = {}) {
  const log = await mockBackend(page, opts)
  await enterDemo(page)
  const map = await openReports(page)
  return { log, map }
}

async function signedIn(page: Page, opts: MockOptions = {}) {
  const log = await mockBackend(page, opts)
  await signIn(page)
  const map = await openReports(page)
  return { log, map }
}

test('reports layer: dots, legend, count and the unverified label; signed out you are asked to sign in', async ({ page }) => {
  const { map } = await demo(page)
  await expect(map).toHaveAttribute('data-reports', '2', { timeout: 15_000 })
  await expect(page.getByTestId('reports-status')).toHaveText('2 community reports in view')
  const legend = page.getByTestId('map-legend').filter({ visible: true })
  await expect(legend).toHaveAttribute('data-layer', 'reports')
  await expect(legend).toContainText('Community reports (unverified)')
  await expect(legend).toContainText('Bigger dot = higher trust')
  await expect(legend).toContainText('Reports never change forecasts or alert levels.')
  await expect(page.getByTestId('report-sign-in')).toHaveAttribute('href', '/login')
  await expect(page.getByTestId('report-new')).toHaveCount(0)
  // no weather surface or wind under the reports
  await expect(map).not.toHaveAttribute('data-field-before', /.*/)
  await expect(map).toHaveAttribute('data-particles', '0')
})

test('low-trust reports are hidden until "Show unverified reports"; the toggle follows the UI language', async ({ page, isMobile }) => {
  const { map } = await demo(page)
  await expect(map).toHaveAttribute('data-reports', '2', { timeout: 15_000 })
  await expect(map).toHaveAttribute('data-reports-hidden', '1')
  const toggle = page.getByTestId('reports-show-low')
  await expect(toggle).toHaveText('Show unverified reports (1 hidden)')
  await expect(toggle).toHaveAttribute('aria-pressed', 'false')
  await expect(page.getByTestId('reports-low-note')).toHaveText('Low-trust reports are hidden until you show them. Your own reports always show.')

  await toggle.click()
  await expect(map).toHaveAttribute('data-reports', '3')
  await expect(map).toHaveAttribute('data-reports-hidden', '0')
  await expect(toggle).toHaveText('Showing unverified reports (1)')
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('reports-status')).toHaveText('3 community reports in view')

  await toggle.click()
  await expect(map).toHaveAttribute('data-reports', '2')
  await expect(page.getByTestId('reports-status')).toHaveText('2 community reports in view')

  if (isMobile) return // language buttons sit in the desktop nav
  await page.getByRole('button', { name: 'मरा', exact: true }).first().click()
  await expect(toggle).toHaveText('पडताळणी न झालेले अहवाल दाखवा (1 लपवलेले)')
  await page.getByRole('button', { name: 'हिं', exact: true }).first().click()
  await expect(toggle).toHaveText('असत्यापित रिपोर्ट दिखाएँ (1 छिपी हैं)')
  await page.getByRole('button', { name: 'Hing', exact: true }).first().click()
  await expect(toggle).toHaveText('Unverified reports dikhao (1 chhupi hain)')
  await toggle.click()
  await expect(toggle).toHaveText('Unverified reports dikh rahi hain (1)')
})

test('signed in: your own low-trust report is never hidden; with nothing hidden there is no toggle', async ({ page }) => {
  const { map } = await signedIn(page, { reports: reportsFixture().map((r) => (r.id === 'rep-hail' ? { ...r, mine: true } : r)) })
  await expect(map).toHaveAttribute('data-reports', '3', { timeout: 15_000 })
  await expect(map).toHaveAttribute('data-reports-hidden', '0')
  await expect(page.getByTestId('reports-show-low')).toHaveCount(0)
})

test('tap a report: kind, trust and why, photo, approximate time, never who', async ({ page }) => {
  await demo(page)
  await expect(page.getByTestId('weather-map')).toHaveAttribute('data-reports', '2', { timeout: 15_000 })
  // the report next to the map centre (Pune)
  await page.getByTestId('map-centre').click()
  const card = page.getByTestId('report-card')
  await expect(card).toBeVisible({ timeout: 10_000 })
  await expect(card).toHaveAttribute('data-kind', 'waterlogging')
  await expect(card).toContainText('Community report, unverified')
  await expect(page.getByTestId('report-trust')).toHaveText('High trust')
  await expect(page.getByTestId('report-by')).toHaveText(/^Reported by a resident, about (40|50) min ago$/)
  await expect(page.getByTestId('report-note')).toContainText('Knee-deep water under the bridge')
  await expect(page.getByTestId('report-photo')).toHaveAttribute('src', /\/api\/reports\/rep-water\/photo$/)
  await expect(page.getByTestId('report-why')).toContainText('Forecast model agrees')
  await expect(page.getByTestId('report-why')).toContainText('100%')
  await expect(page.getByTestId('report-counts')).toHaveText('Confirmed by 2')
  await expect(card).toContainText('Sign in to confirm or flag.')
  await expect(page.getByTestId('report-confirm')).toHaveCount(0)
})

test('signed in: report what you see at the map centre, with a photo; it appears as yours', async ({ page }) => {
  const { log, map } = await signedIn(page)
  await expect(map).toHaveAttribute('data-reports', '2', { timeout: 15_000 })
  await page.getByTestId('report-new').click()
  await expect(map).toHaveAttribute('data-report-stage', 'pick')
  await page.getByTestId('report-use-centre').click()
  await expect(map).toHaveAttribute('data-report-stage', 'form')
  await expect(page.getByTestId('report-at')).toHaveText('At 18.5204, 73.8567')
  // a kind is required
  await page.getByTestId('report-submit').click()
  await expect(page.getByTestId('report-error')).toHaveText('Pick what you see.')
  await page.getByTestId('report-kind-waterlogging').click()
  await page.getByTestId('report-note-input').fill('Water up to the wheel hubs')
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
    'base64'
  )
  await page.getByTestId('report-photo-input').setInputFiles({ name: 'street.png', mimeType: 'image/png', buffer: png })
  await expect(page.getByTestId('report-form')).toContainText('Location and all other data stored in the photo are removed.')
  await page.getByTestId('report-submit').click()
  await expect(page.getByTestId('report-sent')).toHaveText(/community report, unverified/)
  expect(log.reportPosts).toHaveLength(1) // the first click (no kind) sent nothing
  const sent = log.reportPosts[0]
  expect(sent.kind).toBe('waterlogging')
  expect(Number(sent.latitude)).toBeCloseTo(PUNE.latitude, 3)
  expect(Number(sent.longitude)).toBeCloseTo(PUNE.longitude, 3)
  expect(sent.note).toBe('Water up to the wheel hubs')
  expect(sent.photoType).toBe('image/png')
  expect(sent.auth).toBe('Bearer e2e-access-token')
  await expect(map).toHaveAttribute('data-reports', '3')
  await expect(page.getByTestId('report-card')).toHaveAttribute('data-kind', 'waterlogging')
  await expect(page.getByTestId('report-mine')).toBeVisible()
})

test('the first click without a kind sends nothing', async ({ page }) => {
  const { log } = await signedIn(page)
  await page.getByTestId('report-new').click()
  await page.getByTestId('report-use-centre').click()
  await page.getByTestId('report-submit').click()
  await expect(page.getByTestId('report-error')).toBeVisible()
  expect(log.reportPosts).toHaveLength(0)
})

test('a photo the browser cannot read is refused before upload', async ({ page }) => {
  const { log } = await signedIn(page)
  await page.getByTestId('report-new').click()
  await page.getByTestId('report-use-centre').click()
  await page.getByTestId('report-kind-hail').click()
  await page.getByTestId('report-photo-input').setInputFiles({ name: 'IMG_0001.heic', mimeType: 'image/heic', buffer: Buffer.from('not really a photo') })
  await page.getByTestId('report-submit').click()
  await expect(page.getByTestId('report-error')).toHaveText('Please use a JPEG or PNG photo.')
  expect(log.reportPosts).toHaveLength(0)
})

test('signed in: confirm a report once; your vote shows', async ({ page }) => {
  const { log, map } = await signedIn(page)
  await expect(map).toHaveAttribute('data-reports', '2', { timeout: 15_000 })
  await page.getByTestId('map-centre').click()
  await expect(page.getByTestId('report-card')).toHaveAttribute('data-kind', 'waterlogging')
  await page.getByTestId('report-confirm').click()
  await expect(page.getByTestId('report-voted')).toHaveText('You confirmed this report.')
  await expect(page.getByTestId('report-counts')).toHaveText('Confirmed by 3')
  await expect(page.getByTestId('report-flag')).toHaveCount(0)
  expect(log.votes).toEqual([{ id: 'rep-water', vote: 'confirm', auth: 'Bearer e2e-access-token' }])
})

test('rate limit and outage say what to do', async ({ page }) => {
  await signedIn(page)
  await page.route('http://localhost:8000/api/reports', (route) =>
    route.request().method() === 'POST'
      ? route.fulfill({
          status: 429,
          headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'access-control-expose-headers': 'Retry-After', 'retry-after': '42' },
          body: JSON.stringify({ code: 'rate_limited', detail: 'Too many reports.' }),
        })
      : route.fallback()
  )
  await page.getByTestId('report-new').click()
  await page.getByTestId('report-use-centre').click()
  await page.getByTestId('report-kind-heavy_rain').click()
  await page.getByTestId('report-submit').click()
  await expect(page.getByTestId('report-error')).toHaveText('You can send one report a minute and 5 an hour. Try again in 42 s.')
})

test('reports unavailable: a clear line, the map keeps working', async ({ page }) => {
  const { map } = await demo(page, { fail: { '/api/reports': 503 } })
  await expect(page.getByTestId('reports-status')).toHaveText('Community reports are unavailable right now. Try again in a minute.', { timeout: 15_000 })
  await page.getByTestId('map-layer-temperature').click()
  await expect(map).toHaveAttribute('data-layer', 'temperature')
})

test('report words follow the UI language', async ({ page, isMobile }) => {
  test.skip(isMobile, 'language buttons sit in the desktop nav')
  await demo(page)
  await expect(page.getByTestId('weather-map')).toHaveAttribute('data-reports', '2', { timeout: 15_000 })
  await page.getByTestId('map-centre').click()
  await page.getByRole('button', { name: 'मरा', exact: true }).first().click()
  await expect(page.getByTestId('report-kind')).toHaveText('पाणी साचले')
  await expect(page.getByTestId('report-card')).toContainText('नागरिक अहवाल, पडताळलेला नाही')
  await expect(page.getByTestId('map-layer-reports')).toHaveText('अहवाल')
  await page.getByRole('button', { name: 'हिं', exact: true }).first().click()
  await expect(page.getByTestId('report-trust')).toHaveText('ऊँचा भरोसा')
  await page.getByRole('button', { name: 'Hing', exact: true }).first().click()
  await expect(page.getByTestId('report-kind')).toHaveText('Paani bharaav')
})

test('phones: the card sits under the map, the panel stays reachable, no sideways scroll', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'phone layout')
  await demo(page)
  await expect(page.getByTestId('weather-map')).toHaveAttribute('data-reports', '2', { timeout: 15_000 })
  await page.getByTestId('map-centre').click()
  const frame = (await page.getByTestId('map-frame').boundingBox())!
  const card = (await page.getByTestId('report-card').boundingBox())!
  expect(card.y).toBeGreaterThanOrEqual(frame.y + frame.height - 1)
  await expect(page.getByTestId('reports-panel')).toBeVisible()
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(0)
})
