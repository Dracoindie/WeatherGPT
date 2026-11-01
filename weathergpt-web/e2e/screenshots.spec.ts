import { test, type Page } from '@playwright/test'
import { DEMO_PRESETS } from '../lib/weatherScene'
import { enterDemo, mockBackend, PUNE } from './support/mockApi'

/**
 * Screenshot pass: every sky scene and every page, at desktop (1440) and
 * mobile (390) sizes. Run with `npm run screenshots`; images land in
 * screenshots/<project>/. Not assertions: they are for looking at.
 */

test.describe.configure({ mode: 'serial', timeout: 300_000 })

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
