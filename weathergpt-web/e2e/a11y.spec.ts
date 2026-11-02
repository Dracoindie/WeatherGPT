import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { enterDemo, mockBackend, PUNE } from './support/mockApi'
import { BOARD } from './support/roleFixtures'

/**
 * axe-core (WCAG 2.1 A/AA) on every route, desktop and mobile. Serious and
 * critical violations fail the test; moderate and minor ones are printed.
 */

const ROUTES = ['/', '/alerts', '/climate', '/map', '/disaster', '/login', '/signup', '/offline']
const BLOCKING = new Set(['serious', 'critical'])

async function settle(page: Page) {
  await page.waitForLoadState('networkidle').catch(() => {})
  await page.waitForTimeout(800)
}

async function scan(page: Page, label: string) {
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    // Leaflet map tiles and attribution are third-party markup.
    .exclude('.leaflet-tile-pane')
    .analyze()
  const blocking = result.violations.filter((v) => BLOCKING.has(v.impact ?? ''))
  for (const v of result.violations) {
    const where = v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')
    console.log(`[axe ${label}] ${v.impact} ${v.id} (${v.nodes.length}): ${v.help} → ${where}`)
  }
  // axe cannot compute contrast over the sky gradient/blur; it lists those as "incomplete".
  const unsure = result.incomplete.find((v) => v.id === 'color-contrast')
  if (unsure) console.log(`[axe ${label}] needs-review color-contrast (${unsure.nodes.length} nodes over gradients)`)
  expect(
    blocking.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 5).join(' | ')}`),
    `${label}: serious/critical axe violations`
  ).toEqual([])
}

test.beforeEach(async ({ context }) => {
  await context.grantPermissions(['geolocation'])
  await context.setGeolocation({ latitude: PUNE.latitude, longitude: PUNE.longitude })
})

for (const route of ROUTES) {
  test(`axe: ${route}`, async ({ page }) => {
    await mockBackend(page, { routes: { '/api/risk': BOARD } })
    await page.goto(route)
    await settle(page)
    await scan(page, route)
  })
}

test('axe: home with an answer', async ({ page }) => {
  await mockBackend(page)
  await page.goto('/')
  await settle(page)
  const input = page.getByRole('textbox', { name: /ask about the weather/i })
  await input.fill('Will it rain in Pune tomorrow?')
  await input.press('Enter')
  await page.getByRole('log').or(page.locator('[aria-live]')).first().waitFor()
  await page.waitForTimeout(3000)
  await scan(page, '/ answered')
})

test('axe: dashboard (demo session)', async ({ page }) => {
  await mockBackend(page)
  await enterDemo(page)
  await settle(page)
  await scan(page, '/dashboard')
})

test('keyboard: Tab reaches the nav and the console; Enter asks; the reply is announced', async ({ page, isMobile }) => {
  test.skip(isMobile, 'the desktop nav is the keyboard path; phones use the bottom nav by touch')
  await mockBackend(page)
  await page.goto('/')
  await settle(page)

  // Tab order starts at the logo, then the nav links, with a visible focus ring.
  await page.keyboard.press('Tab')
  const logo = page.getByRole('link', { name: /^WeatherGPT\s*SIH26068$/ })
  await expect(logo).toBeFocused()
  const outline = await logo.evaluate((el) => getComputedStyle(el).outlineStyle)
  expect(outline).not.toBe('none')
  await page.keyboard.press('Tab')
  await expect(page.locator(':focus')).toHaveAttribute('href', '/')

  // Keep tabbing until the console input has focus (no mouse).
  const input = page.getByRole('textbox', { name: /ask about the weather/i })
  for (let i = 0; i < 30 && !(await input.evaluate((el) => el === document.activeElement)); i++) {
    await page.keyboard.press('Tab')
  }
  await expect(input).toBeFocused()
  await page.keyboard.type('Will it rain in Pune tomorrow?')
  await page.keyboard.press('Enter')

  // The persistent live region carries the full reply text once it arrives.
  const announcer = page.getByTestId('reply-announcer')
  await expect(announcer).toHaveAttribute('aria-live', 'polite')
  await expect(announcer).not.toBeEmpty({ timeout: 20_000 })
})
