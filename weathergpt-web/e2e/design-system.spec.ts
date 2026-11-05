import { expect, test, type Page } from '@playwright/test'
import { enterDemo, mockBackend, PUNE } from './support/mockApi'
import { BOARD } from './support/roleFixtures'

/**
 * One design: every page renders inside AppShell (.sky-root) with the same
 * nav, an active state, a way back to Living Sky, and no Classic link.
 */

const LINKS = ['/', '/dashboard', '/map', '/alerts', '/climate', '/disaster']

async function go(page: Page, href: string) {
  await page.locator(`a[href="${href}"]`).first().dispatchEvent('click')
  await page.waitForURL(href === '/' ? /\/$/ : `**${href}`)
}

test.beforeEach(async ({ context }) => {
  await context.grantPermissions(['geolocation'])
  await context.setGeolocation({ latitude: PUNE.latitude, longitude: PUNE.longitude })
})

test('the same nav on every page, with the active page marked', async ({ page, isMobile }) => {
  await mockBackend(page, { routes: { '/api/risk': BOARD } })
  await enterDemo(page)
  for (const href of ['/dashboard', '/map', '/alerts', '/climate', '/disaster', '/']) {
    if (!page.url().endsWith(href)) await go(page, href)
    await expect(page.locator('.sky-root')).toHaveCount(1)
    await expect(page.locator('a[href="/classic"]')).toHaveCount(0)
    // logo always leads home
    await expect(page.getByRole('link', { name: /^WeatherGPT\s*SIH26068$/ })).toHaveAttribute('href', '/')
    const nav = isMobile ? page.getByRole('navigation', { name: 'Bottom navigation' }) : page.getByRole('navigation', { name: 'Primary navigation' })
    for (const l of LINKS) {
      await expect(nav.locator(`a[href="${l}"]`)).toHaveCount(1)
    }
    await expect(nav.locator(`a[href="${href}"]`)).toHaveAttribute('aria-current', 'page')
  }
})

test('settings is a real panel on desktop', async ({ page, isMobile }) => {
  test.skip(isMobile, 'settings sit in the menu on phones')
  await mockBackend(page)
  await page.goto('/')
  await page.getByRole('button', { name: 'Settings' }).click()
  const panel = page.getByRole('dialog', { name: 'Settings' })
  await expect(panel.getByRole('combobox', { name: 'Role' })).toBeVisible()
  await expect(panel.getByRole('button', { name: /lite mode/i })).toBeVisible()
  await panel.getByRole('button', { name: 'मरा' }).click()
  await page.keyboard.press('Escape')
  await expect(panel).toHaveCount(0)
  // language survives a full page load
  await page.goto('/alerts')
  await expect(page.getByRole('button', { name: 'मरा' }).first()).toHaveAttribute('aria-pressed', 'true')
})

test('/classic is gone', async ({ page }) => {
  const resp = await page.goto('/classic')
  expect(resp?.status()).toBe(404)
})

test('daily forecast: no holes when the API returns fewer than 7 days', async ({ page, context }) => {
  // Live /api/forecast returned 5 days; the grid was built for 7 and left a hole.
  await context.grantPermissions(['geolocation'])
  await context.setGeolocation({ latitude: PUNE.latitude, longitude: PUNE.longitude })
  await mockBackend(page)
  const daily = Array.from({ length: 5 }, (_, i) => ({
    date: new Date(Date.now() + i * 86400_000).toISOString().slice(0, 10),
    weather_code: 2,
    max_temperature: 31,
    min_temperature: 21,
    precipitation_sum: 0,
    precipitation_probability_max: 0,
    max_wind_speed: 12,
  }))
  await page.route('**/api/forecast**', (route) =>
    route.fulfill({ json: { source: 'open-meteo', latitude: PUNE.latitude, longitude: PUNE.longitude, timezone: 'Asia/Kolkata', retrieved_at: new Date().toISOString(), daily } })
  )
  await enterDemo(page)
  await page.getByRole('button', { name: /use my current location/i }).first().click()
  const list = page.getByTestId('forecast-days')
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    await expect(list.locator('li')).toHaveCount(5, { timeout: 15_000 })
    // every row ends at the list's right edge
    const holes = await list.evaluate((ul) => {
      const right = ul.getBoundingClientRect().right
      const rows = new Map<number, number>()
      for (const li of Array.from(ul.children)) {
        const r = li.getBoundingClientRect()
        rows.set(Math.round(r.top), Math.max(rows.get(Math.round(r.top)) ?? 0, r.right))
      }
      return [...rows.values()].filter((r) => right - r > 2).length
    })
    expect(holes, `row with a hole at ${width} px`).toBe(0)
  }
})
