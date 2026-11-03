import { test, type Page } from '@playwright/test'
import { DEMO_PRESETS } from '../lib/weatherScene'
import { chatResponse, CLIMATE_FACTS, enterDemo, GFS_FACTS, mockBackend, PUNE } from './support/mockApi'
import { AVIATION, BOARD, COMPARE, FARM } from './support/roleFixtures'

/**
 * Screenshot pass: every sky scene and every page, at desktop (1440) and
 * mobile (390) sizes. Run with `npm run screenshots`; images land in
 * screenshots/<project>/. Not assertions: they are for looking at.
 */

test.describe.configure({ mode: 'serial', timeout: 300_000 })

// Headless Chromium draws WebGL in software, where lite mode's auto setting now
// picks the CSS sky. Screenshots show what a GPU user sees: force the WebGL sky.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('wgpt:lite-mode', 'off'))
})

const shot = (page: Page, project: string, name: string, fullPage = true) =>
  page.screenshot({ path: `screenshots/${project}/${name}.png`, fullPage })

/** Client-side navigation keeps the in-memory demo session alive. */
async function navigate(page: Page, href: string) {
  await page.locator(`a[href="${href}"]`).first().dispatchEvent('click')
  await page.waitForURL(`**${href}`)
}

async function pickLocation(page: Page) {
  await page.getByRole('button', { name: /use my current location/i }).first().click()
}

test.beforeEach(async ({ context }) => {
  await context.grantPermissions(['geolocation'])
  await context.setGeolocation({ latitude: PUNE.latitude, longitude: PUNE.longitude })
})

test('@screens sky scenes', async ({ page }, info) => {
  await mockBackend(page)
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(1000)
  await page.keyboard.press('d')
  for (const preset of DEMO_PRESETS) {
    await page.getByRole('button', { name: preset, exact: true }).click()
    // let the eased scene params settle
    await page.waitForTimeout(3500)
    await shot(page, info.project.name, `scene-${preset}`, false)
  }
})

test('@screens home', async ({ page }, info) => {
  await mockBackend(page)
  await page.goto('/')
  await page.waitForTimeout(2000)
  await shot(page, info.project.name, 'home-empty')

  const input = page.getByRole('textbox', { name: /ask about the weather/i })
  await input.fill('Will it rain in Pune tomorrow?')
  await input.press('Enter')
  await page.getByText(/12\.4 mm/).first().waitFor({ timeout: 20_000 })
  await page.waitForTimeout(4000)
  await shot(page, info.project.name, 'home-answered')
})

test('@screens climate and GFS answers', async ({ page }, info) => {
  await mockBackend(page, {
    chat: (body) =>
      String(body.message).includes('GFS')
        ? chatResponse({
            message: 'GFS model (run 2026-11-01 06:00 UTC) for Pune tomorrow: 21.6–28.1°C, 13.2 mm of precipitation, winds up to 11.8 km/h.',
            intent: { intent: 'nwp', date_reference: 'tomorrow' },
            extra: { weather: null, advisory: null, nwp: GFS_FACTS, source: 'gfs-nomads' },
          })
        : chatResponse({
            message: 'In Pune so far this year, the average daily high was 32.1°C against a 2016–2025 average of 31.2°C — 0.9°C warmer than usual.',
            intent: { intent: 'climate', climate_period: 'this_year', weather_parameter: 'general', date_reference: 'now' },
            extra: { weather: null, advisory: null, climate: CLIMATE_FACTS, source: 'open-meteo-archive' },
          }),
  })
  await page.goto('/')
  const input = page.getByRole('textbox', { name: /ask about the weather/i })
  for (const [q, name] of [['Is this year hotter than usual in Pune?', 'answer-climate'], ['What does GFS say for tomorrow?', 'answer-gfs']]) {
    await input.fill(q)
    await input.press('Enter')
    await page.waitForTimeout(5000)
    await shot(page, info.project.name, name)
  }
})

test('@screens role panels', async ({ page }, info) => {
  await mockBackend(page, { routes: { '/api/farm': FARM, '/api/aviation': AVIATION, '/api/compare': COMPARE } })
  for (const role of ['farmer', 'aviation', 'researcher'] as const) {
    await page.addInitScript((r) => localStorage.setItem('wgpt:role', r), role)
    await page.goto('/')
    const input = page.getByRole('textbox', { name: /ask about the weather/i })
    await input.fill('Will it rain in Pune tomorrow?')
    await input.press('Enter')
    await page.getByText(/12\.4 mm/).first().waitFor({ timeout: 20_000 })
    await page.waitForTimeout(4500)
    await shot(page, info.project.name, `role-${role}`)
  }
})

test('@screens disaster board', async ({ page }, info) => {
  await mockBackend(page, { routes: { '/api/risk': BOARD } })
  await page.goto('/disaster')
  await page.getByText('Ratnagiri').first().waitFor()
  await page.waitForTimeout(1500)
  await shot(page, info.project.name, 'disaster')
})

test('@screens auth pages', async ({ page }, info) => {
  await mockBackend(page)
  for (const path of ['login', 'signup']) {
    await page.goto(`/${path}`)
    await page.waitForTimeout(800)
    await shot(page, info.project.name, path)
  }
})

test('@screens demo-session pages', async ({ page }, info) => {
  await mockBackend(page)
  await enterDemo(page)
  await pickLocation(page)
  await page.waitForTimeout(3000)
  await shot(page, info.project.name, 'dashboard')

  for (const path of ['/alerts', '/climate', '/map']) {
    await navigate(page, path)
    await page.waitForTimeout(800)
    const picker = page.getByRole('button', { name: /use my current location/i }).first()
    if (await picker.isVisible().catch(() => false)) await picker.click()
    await page.waitForTimeout(3000)
    await shot(page, info.project.name, path.slice(1))
  }
})

test('@screens map: point card, heat layer, broadcast', async ({ page, isMobile }, info) => {
  await mockBackend(page)
  await enterDemo(page)
  await navigate(page, '/map')
  await pickLocation(page)
  const canvas = page.locator('[data-testid="weather-map"] canvas.maplibregl-canvas')
  await canvas.waitFor({ timeout: 30_000 })
  await page.getByTestId('map-legend').waitFor({ timeout: 30_000 })
  await canvas.scrollIntoViewIfNeeded()
  const box = (await canvas.boundingBox())!
  const at = { x: box.x + box.width * 0.35, y: box.y + box.height * 0.45 }
  if (isMobile) await page.touchscreen.tap(at.x, at.y)
  else await page.mouse.click(at.x, at.y)
  await page.getByTestId('map-point-temp').waitFor({ timeout: 15_000 })
  await page.waitForTimeout(1500)
  await shot(page, info.project.name, 'map-point')

  await page.getByTestId('map-layer-heat').click()
  await page.waitForTimeout(800)
  await shot(page, info.project.name, 'map-heat')

  await page.getByTestId('map-layer-rain').click()
  await page.getByTestId('map-broadcast').click()
  await page.waitForTimeout(4000)
  await shot(page, info.project.name, 'map-broadcast', false)
})
