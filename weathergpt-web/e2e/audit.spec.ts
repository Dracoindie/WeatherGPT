import { test, type Page } from '@playwright/test'
import { chatResponse, enterDemo, mockBackend, PUNE } from './support/mockApi'
import { AVIATION, BOARD, COMPARE, FARM } from './support/roleFixtures'

/**
 * Design audit: every route, signed out and in a demo session, at 1440 and
 * 390 px. Opt-in, because it is for looking at, not asserting:
 *
 *   AUDIT_DIR=screenshots/audit-before npx playwright test e2e/audit.spec.ts
 *
 * Files: <AUDIT_DIR>/<project>/<signed-out|demo>-<route>.png
 */

const DIR = process.env.AUDIT_DIR
test.skip(!DIR, 'set AUDIT_DIR to run the design audit')
test.describe.configure({ mode: 'serial', timeout: 300_000 })

// Headless Chromium draws WebGL in software, where lite mode's auto setting now
// picks the CSS sky. Screenshots show what a GPU user sees: force the WebGL sky.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('wgpt:lite-mode', 'off'))
})

const ROUTES = ['/', '/dashboard', '/alerts', '/climate', '/map', '/disaster', '/login', '/signup', '/offline']

const name = (route: string) => (route === '/' ? 'home' : route.slice(1))

async function shot(page: Page, project: string, file: string) {
  await page.screenshot({ path: `${DIR}/${project}/${file}.png`, fullPage: true })
}

async function settle(page: Page) {
  await page.waitForLoadState('networkidle').catch(() => {})
  await page.waitForTimeout(1500)
}

async function pickLocation(page: Page) {
  const picker = page.getByRole('button', { name: /use my current location/i }).first()
  if (await picker.isVisible().catch(() => false)) {
    await picker.click()
    await page.waitForTimeout(2500)
  }
}

test.beforeEach(async ({ context }) => {
  await context.grantPermissions(['geolocation'])
  await context.setGeolocation({ latitude: PUNE.latitude, longitude: PUNE.longitude })
})

test('@audit signed out: every route', async ({ page }, info) => {
  await mockBackend(page, { routes: { '/api/risk': BOARD } })
  for (const route of ROUTES) {
    await page.goto(route)
    await settle(page)
    await pickLocation(page)
    await shot(page, info.project.name, `signed-out-${name(route)}`)
  }
})

test('@audit signed out: home with an answer', async ({ page }, info) => {
  await mockBackend(page, {
    chat: () => chatResponse(),
    routes: { '/api/farm': FARM, '/api/aviation': AVIATION, '/api/compare': COMPARE },
  })
  await page.goto('/')
  await settle(page)
  const input = page.getByRole('textbox', { name: /ask about the weather/i })
  await input.fill('Will it rain in Pune tomorrow?')
  await input.press('Enter')
  await page.getByText(/12\.4 mm/).first().waitFor({ timeout: 20_000 })
  await page.waitForTimeout(5000)
  await shot(page, info.project.name, 'signed-out-home-answered')
  await page.screenshot({ path: `${DIR}/${info.project.name}/signed-out-home-answered-viewport.png` })
})

test('@audit demo session: every route', async ({ page }, info) => {
  await mockBackend(page, { routes: { '/api/risk': BOARD } })
  await enterDemo(page)
  for (const route of ROUTES.filter((r) => !['/login', '/signup', '/offline'].includes(r))) {
    if (page.url().endsWith(route) === false) {
      const link = page.locator(`a[href="${route}"]`).first()
      if (await link.count()) {
        await link.dispatchEvent('click')
        await page.waitForURL(`**${route === '/' ? '/' : route}`)
      } else {
        continue
      }
    }
    await settle(page)
    await pickLocation(page)
    await shot(page, info.project.name, `demo-${name(route)}`)
  }
})
