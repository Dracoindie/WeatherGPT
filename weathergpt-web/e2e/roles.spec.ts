import { expect, test, type Page } from '@playwright/test'
import { mockBackend } from './support/mockApi'
import { BOARD, FARM } from './support/roleFixtures'

/** Role modes: selector, role sent with chat, role panels, disaster board. */

async function ask(page: Page, text: string) {
  const input = page.getByRole('textbox', { name: /ask about the weather/i })
  await input.fill(text)
  await input.press('Enter')
}

async function pickRole(page: Page, isMobile: boolean, label: string) {
  if (isMobile) await page.getByRole('button', { name: /menu/i }).first().click()
  await page.getByRole('combobox', { name: 'Role' }).first().selectOption({ label })
}

test('the chosen role is sent with chat questions and remembered', async ({ page, isMobile }) => {
  const log = await mockBackend(page, { routes: { '/api/farm': FARM } })
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await pickRole(page, isMobile, 'Farmer')
  if (isMobile) await page.getByRole('button', { name: /menu/i }).first().click()
  await ask(page, 'Will it rain in Pune tomorrow?')
  await expect.poll(() => log.chat.length).toBe(1)
  expect(log.chat[0].role).toBe('farmer')
  expect(await page.evaluate(() => localStorage.getItem('wgpt:role'))).toBe('farmer')

  // Farmer panel renders the server's windows and statuses.
  await expect(page.getByText('Farm guidance · next 3 days')).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText(/06:00–10:00/)).toBeVisible()
  await expect(page.getByText(/wait and check soil moisture/)).toBeVisible()
  await expect(page.getByText(/not an official IMD/).first()).toBeVisible()
  expect(log.paths).toContain('/api/farm')
})

const DEFAULT_COUNT = 15

test('disaster board lists districts most severe first', async ({ page }) => {
  const log = await mockBackend(page, { routes: { '/api/risk': BOARD } })
  await page.goto('/disaster')
  const items = page.getByRole('region', { name: 'Districts by severity' }).getByRole('listitem')
  await expect(items).toHaveCount(DEFAULT_COUNT)
  await expect(items.nth(0)).toContainText('Ratnagiri')
  await expect(items.nth(0)).toContainText(/warning/i)
  await expect(items.last()).toContainText('Latur')
  await expect(items.last()).toContainText(/unknown/i)
  await expect(page.getByText(/not official IMD warnings/i)).toBeVisible()
  // Coordinates come from our geocoder, never hard-coded, never Nominatim from the browser.
  expect(log.paths.filter((p) => p === '/api/geocode')).toHaveLength(DEFAULT_COUNT)
})

test('disaster board shows each district as soon as it is located', async ({ page }) => {
  await mockBackend(page, {
    routes: { '/api/risk': BOARD },
    geocodeDelay: { Nagpur: 4000 },
    geocodeStatus: { Palghar: 404, Nanded: 503 },
  })
  await page.goto('/disaster')
  const region = page.getByRole('region', { name: 'Districts by severity' })
  // Ratnagiri is shown while Nagpur is still being looked up.
  await expect(region.getByText('Ratnagiri')).toBeVisible()
  await expect(page.getByTestId('risk-pending')).toContainText('Nagpur')
  // Then Nagpur arrives and the pending list empties.
  await expect(page.getByTestId('risk-pending')).toHaveCount(0, { timeout: 15_000 })
  await expect(region.locator('li', { hasText: 'Nagpur' })).toContainText(/no active alerts/i)
  // Failures are explained, not dropped.
  await expect(region.locator('li', { hasText: 'Palghar' })).toContainText(/place not found/i)
  await expect(region.locator('li', { hasText: 'Nanded' })).toContainText(/location service unavailable/i)
})

test('disaster map: the /map basemap (no CARTO tiles), circles coloured by each district level', async ({ page }) => {
  const carto: string[] = []
  page.on('request', (r) => {
    if (/carto(cdn)?\.com/.test(r.url())) carto.push(r.url())
  })
  await mockBackend(page, { routes: { '/api/risk': BOARD } })
  await page.goto('/disaster')
  const map = page.getByTestId('risk-map')
  await expect(map.locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 30_000 })
  await expect(map).toHaveAttribute('data-ready', 'true', { timeout: 30_000 })
  await expect(page.getByRole('region', { name: 'Districts by severity' }).getByRole('listitem')).toHaveCount(DEFAULT_COUNT)
  // the circles carry the board's levels (warning for Ratnagiri), not all "unknown"
  await expect(map).toHaveAttribute('data-levels', /warning/)
  // the canvas fills the panel (maplibre-gl.css once collapsed the container to 0 px and clipped it)
  const box = (await map.boundingBox())!
  const canvas = (await map.locator('canvas.maplibregl-canvas').boundingBox())!
  expect(box.height).toBeGreaterThanOrEqual(300)
  // not stretched to the list's height (~1600 px with 15 districts): the fit would zoom out to half of India
  expect(box.height).toBeLessThanOrEqual(760)
  expect(Math.abs(canvas.height - box.height)).toBeLessThanOrEqual(2)
  expect(Math.abs(canvas.width - box.width)).toBeLessThanOrEqual(2)
  expect(carto).toEqual([])
})
