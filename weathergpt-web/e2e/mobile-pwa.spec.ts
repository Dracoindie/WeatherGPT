import { expect, test } from '@playwright/test'
import { mockBackend } from './support/mockApi'

/** Mobile layout, PWA install/offline and lite mode. */

const SKY_CANVAS = 'canvas:not(.rain-glass)'

async function ask(page: import('@playwright/test').Page, text: string) {
  const input = page.getByRole('textbox', { name: /ask about the weather/i })
  await input.fill(text)
  await input.press('Enter')
}

test('bottom nav only below the lg breakpoint', async ({ page, isMobile }) => {
  await mockBackend(page)
  await page.goto('/')
  const nav = page.getByRole('navigation', { name: 'Bottom navigation' })
  if (isMobile) {
    await expect(nav).toBeVisible()
    for (const link of await nav.getByRole('link').all()) {
      const box = await link.boundingBox()
      expect(box!.height).toBeGreaterThanOrEqual(44)
    }
    await expect(nav.getByRole('link', { name: /living sky/i })).toHaveAttribute('aria-current', 'page')
  } else {
    await expect(nav).toBeHidden()
  }
})

test('console docks above the bottom nav after the first question on phones', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'phone layout only')
  await mockBackend(page)
  await page.goto('/')
  await ask(page, 'Will it rain in Pune tomorrow?')
  await expect(page.getByText(/12\.4 mm/).first()).toBeVisible({ timeout: 20_000 })
  const form = page.locator('form.sky-console')
  const navBox = await page.getByRole('navigation', { name: 'Bottom navigation' }).boundingBox()
  const formBox = await form.boundingBox()
  // sits just above the nav, within thumb reach
  expect(formBox!.y + formBox!.height).toBeLessThanOrEqual(navBox!.y + 1)
  expect(formBox!.y).toBeGreaterThan(844 / 2)
})

test('web app manifest and icons are served', async ({ request }) => {
  const res = await request.get('/manifest.webmanifest')
  expect(res.ok()).toBe(true)
  const manifest = await res.json()
  expect(manifest).toMatchObject({ display: 'standalone', start_url: '/', short_name: 'WeatherGPT' })
  expect(manifest.icons.some((i: { purpose: string }) => i.purpose === 'maskable')).toBe(true)
  for (const icon of manifest.icons) {
    const r = await request.get(icon.src)
    expect(r.ok(), icon.src).toBe(true)
    expect(r.headers()['content-type']).toContain('image/png')
  }
  expect((await request.get('/sw.js')).ok()).toBe(true)
})

test('lite mode turns on automatically when WebGL is drawn in software (no GPU)', async ({ page, isMobile }) => {
  // What a GPU-less PC (or a CI runner) reports: the animated sky would run on the CPU.
  await page.addInitScript(() => {
    for (const Ctx of [WebGLRenderingContext, WebGL2RenderingContext]) {
      const original = Ctx.prototype.getParameter
      Ctx.prototype.getParameter = function (this: WebGLRenderingContext, p: number) {
        if (p === 0x9246 || p === 0x1f01) return 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)'
        return original.call(this, p)
      } as typeof original
    }
  })
  await mockBackend(page)
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  if (isMobile) await page.getByRole('button', { name: /menu/i }).first().click()
  else await page.getByRole('button', { name: 'Settings' }).click()
  const toggle = page.getByRole('button', { name: /lite mode/i }).first()
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
  await expect(toggle).toHaveAttribute('title', /no graphics acceleration/)
  await expect(page.locator(SKY_CANVAS)).toHaveCount(0)
})

test('lite mode turns on automatically with Save-Data and can be switched off', async ({ page, isMobile }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'connection', {
      configurable: true,
      value: { saveData: true, effectiveType: '4g', addEventListener() {}, removeEventListener() {} },
    })
  })
  await mockBackend(page)
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  // Lite mode lives in Settings (the menu on phones, the gear panel on desktop).
  if (isMobile) await page.getByRole('button', { name: /menu/i }).first().click()
  else await page.getByRole('button', { name: 'Settings' }).click()
  const toggle = page.getByRole('button', { name: /lite mode/i }).first()
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
  await expect(toggle).toContainText('auto')
  await expect(page.locator(SKY_CANVAS)).toHaveCount(0)

  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-pressed', 'false')
  await expect(page.locator(SKY_CANVAS)).toHaveCount(1, { timeout: 15_000 })
  // the manual choice is remembered
  expect(await page.evaluate(() => localStorage.getItem('wgpt:lite-mode'))).toBe('off')
})

test.describe('with the service worker', () => {
  test.use({ serviceWorkers: 'allow' })

  test('offline: app shell loads from the service worker and shows the last forecast', async ({ page, context }) => {
  // context-level mocks also intercept requests made by the service worker
  await mockBackend(context)
  await page.goto('/')
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined))
  await ask(page, 'Will it rain in Pune tomorrow?')
  await expect(page.getByText(/12\.4 mm/).first()).toBeVisible({ timeout: 20_000 })
  // let the worker finish caching the chunks the page reported
  await page.waitForTimeout(1500)

  await context.setOffline(true)
  await page.reload()
  await expect(page.getByText(/offline — showing saved data/i)).toBeVisible()
  await expect(page.getByText(/saved forecast/i)).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText(/12\.4 mm/).first()).toBeVisible()
  await context.setOffline(false)
  })

  test('offline: every main page opens from the precached app shell, not just /', async ({ page, context }) => {
    await mockBackend(context)
    await page.goto('/')
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined))
    // wait until install has precached the other pages
    await expect
      .poll(() => page.evaluate(async () => !!(await caches.match('/disaster')) && !!(await caches.match('/login'))), {
        timeout: 20_000,
      })
      .toBe(true)

    await context.setOffline(true)
    for (const [path, heading] of [
      ['/disaster', /risk|district/i],
      ['/login', /welcome back/i], // where /alerts sends a signed-out visitor

    ] as const) {
      await page.goto(path)
      await expect(page.getByRole('heading', { level: 1 }).first()).toHaveText(heading, { timeout: 15_000 })
    }
    await context.setOffline(false)
  })
})

test('no horizontal page scroll at 390 px', async ({ page, context, isMobile }) => {
  test.skip(!isMobile, 'phone layout only')
  await context.grantPermissions(['geolocation'])
  await context.setGeolocation({ latitude: 18.5204, longitude: 73.8567 })
  await mockBackend(page)
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)

  await page.goto('/')
  await ask(page, 'Will it rain in Pune tomorrow?')
  await expect(page.getByText(/12\.4 mm/).first()).toBeVisible({ timeout: 20_000 })
  expect(await overflow()).toBeLessThanOrEqual(0)

  await page.goto('/login')
  await page.getByRole('button', { name: /enter demo/i }).click()
  await page.waitForURL('**/dashboard')
  await page.getByRole('button', { name: /use my current location/i }).first().click()
  await expect(page.getByText(/heavy rain expected/i).first()).toBeVisible()
  await page.waitForTimeout(1000)
  expect(await overflow()).toBeLessThanOrEqual(0)
})
