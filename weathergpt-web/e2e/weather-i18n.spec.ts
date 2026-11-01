import { expect, test, type Page } from '@playwright/test'
import { WMO_DESCRIPTIONS } from '../lib/i18n/weatherCodes.generated'
import { enterDemo, mockBackend, PUNE } from './support/mockApi'
import { AVIATION } from './support/roleFixtures'

/**
 * Weather descriptions follow the selected UI language everywhere they appear
 * (answer panel, aviation panel, dashboard, forecast, map popup). The words
 * come from the generated table, which mirrors backend/llm/weather_codes.py.
 */

const ENGLISH = new Set(Object.values(WMO_DESCRIPTIONS.en))

const LANGS = [
  { code: 'hi', label: 'हिं' },
  { code: 'mr', label: 'मरा' },
] as const

async function expectNoEnglish(page: Page, min: number) {
  const items = page.getByTestId('weather-description')
  await expect.poll(() => items.count(), { timeout: 20_000 }).toBeGreaterThanOrEqual(min)
  for (const text of await items.allInnerTexts()) {
    const words = text.replace(/\s*\(WMO \d+\)\s*$/, '').trim()
    expect(ENGLISH.has(words), `English weather description "${words}"`).toBe(false)
    expect(words).toMatch(/[ऀ-ॿ]/) // Devanagari
  }
}

for (const { code, label } of LANGS) {
  test(`no English weather descriptions in ${code}: answer and aviation panels`, async ({ page, isMobile }) => {
    test.skip(isMobile, 'language buttons sit in the desktop nav; the mobile menu is covered elsewhere')
    await mockBackend(page, { routes: { '/api/aviation': AVIATION } })
    await page.addInitScript(() => localStorage.setItem('wgpt:role', 'aviation'))
    await page.goto('/')
    await page.getByRole('button', { name: label, exact: true }).first().click()
    const input = page.getByRole('textbox').first()
    await input.fill('Will it rain in Pune tomorrow?')
    await input.press('Enter')
    await page.getByText(/12\.4/).first().waitFor({ timeout: 20_000 })
    // answer panel (code 63) + aviation briefing (code 61)
    await expect(page.getByText(WMO_DESCRIPTIONS[code]['63']).first()).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText(new RegExp(WMO_DESCRIPTIONS[code]['61'])).first()).toBeVisible()
    await expectNoEnglish(page, 2)
  })

  test(`no English weather descriptions in ${code}: dashboard and map`, async ({ page, context, isMobile }) => {
    test.skip(isMobile, 'language buttons sit in the desktop nav; the mobile menu is covered elsewhere')
    await context.grantPermissions(['geolocation'])
    await context.setGeolocation({ latitude: PUNE.latitude, longitude: PUNE.longitude })
    await mockBackend(page)
    await enterDemo(page)
    await page.getByRole('button', { name: label, exact: true }).first().click()
    await page.getByRole('button', { name: /use my current location|मेरी|माझे|location/i }).first().click()
    // current conditions (code 61) + 7 forecast days
    await expect(page.getByTestId('weather-description').first()).toBeVisible({ timeout: 20_000 })
    await expectNoEnglish(page, 2)

    await page.locator('a[href="/map"]').first().dispatchEvent('click')
    await page.waitForURL('**/map')
    await page.getByRole('button', { name: /use my current location|मेरी|माझे|location/i }).first().click()
    await expect(page.locator('.leaflet-popup [data-testid="weather-description"]')).toBeVisible({ timeout: 20_000 })
    await expectNoEnglish(page, 1)
  })
}
