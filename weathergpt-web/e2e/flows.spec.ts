import { expect, test, type Page } from '@playwright/test'
import { chatResponse, enterDemo, mockBackend, PUNE } from './support/mockApi'

/** Main user flows against a mocked backend. */

const REPLY = 'Tomorrow in Pune: 80% chance of rain, about 12.4 mm. Temperature 22.1–29.8 °C.'

async function ask(page: Page, text: string) {
  const input = page.getByRole('textbox', { name: /ask about the weather/i })
  await input.fill(text)
  await input.press('Enter')
}

async function openLanguageToggle(page: Page, isMobile: boolean) {
  // The toggle lives in the menu below the sm breakpoint.
  if (isMobile) await page.getByRole('button', { name: /menu/i }).first().click()
}

test.describe('Living Sky home', () => {
  test('asks a question and shows the grounded reply and panels', async ({ page }) => {
    const log = await mockBackend(page)
    await page.goto('/')
    await ask(page, 'Will it rain in Pune tomorrow?')

    await expect(page.getByText(REPLY).first()).toBeVisible({ timeout: 20_000 })
    expect(log.chat[0]).toMatchObject({ message: 'Will it rain in Pune tomorrow?' })

    // Values on the panels are the API values, unchanged.
    await expect(page.getByText(PUNE.name).first()).toBeVisible()
    await expect(page.getByText('12.4', { exact: true }).first()).toBeVisible()
    await expect(page.getByText('Carry an umbrella.').first()).toBeVisible()
    // The hourly timeline is fetched for the answered location.
    await expect.poll(() => log.paths.includes('/api/weather')).toBe(true)
  })

  test('quick chip sends its text', async ({ page }) => {
    const log = await mockBackend(page)
    await page.goto('/')
    await page.getByRole('button', { name: 'Will it rain in Pune tomorrow?' }).click()
    await expect.poll(() => log.chat.length).toBe(1)
    expect(log.chat[0].message).toBe('Will it rain in Pune tomorrow?')
  })

  test('use my location sends browser coordinates', async ({ page, context }) => {
    await context.grantPermissions(['geolocation'])
    await context.setGeolocation({ latitude: PUNE.latitude, longitude: PUNE.longitude })
    const log = await mockBackend(page)
    await page.goto('/')
    await page.getByRole('button', { name: /use my location/i }).first().click()
    await expect.poll(() => log.chat.length).toBe(1)
    expect(log.chat[0]).toMatchObject({ latitude: PUNE.latitude, longitude: PUNE.longitude })
  })

  test('shows a clear error when the backend fails', async ({ page }) => {
    await mockBackend(page, { chat: () => ({ status: 502, body: { detail: 'Weather provider unavailable' } }) })
    await page.goto('/')
    await ask(page, 'Pune weather?')
    await expect(page.getByRole('alert').filter({ hasText: 'Weather provider unavailable' })).toBeVisible()
  })

  test('location-less question asks for a location', async ({ page }) => {
    await mockBackend(page, {
      chat: () => ({
        ...chatResponse({ message: 'Which place? Name a city or share your location.' }),
        location: null,
        weather: null,
        advisory: null,
      }),
    })
    await page.goto('/')
    await ask(page, 'Will it rain?')
    await expect(page.getByText('Which place? Name a city or share your location.').first()).toBeVisible({ timeout: 20_000 })
  })

  test('language toggle switches the UI to Hindi and Hinglish', async ({ page, isMobile }) => {
    await mockBackend(page)
    await page.goto('/')
    await openLanguageToggle(page, isMobile)
    await page.getByRole('button', { name: 'हिं' }).click()
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('आकाश से पूछें')
    // the mobile menu stays open after a language switch
    await page.getByRole('button', { name: 'Hing' }).click()
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Aasmaan se poocho')
  })

  test('demo scene controls change the sky and show the badge', async ({ page, isMobile }) => {
    test.skip(isMobile, 'presenter controls are keyboard-driven')
    await mockBackend(page)
    await page.goto('/')
    await page.waitForLoadState('networkidle') // key handler attaches on hydration
    await page.keyboard.press('d')
    await page.getByRole('button', { name: 'storm' }).click()
    await expect(page.getByText(/demo mode · storm/i)).toBeVisible()
  })
})

test.describe('Signed-out demo session', () => {
  test('dashboard loads forecast and alerts for a picked location', async ({ page, context }) => {
    await context.grantPermissions(['geolocation'])
    await context.setGeolocation({ latitude: PUNE.latitude, longitude: PUNE.longitude })
    const log = await mockBackend(page)
    await enterDemo(page)
    await page.getByRole('button', { name: /use my current location/i }).first().click()
    await expect.poll(() => log.paths.includes('/api/forecast')).toBe(true)
    await expect.poll(() => log.paths.includes('/api/alerts')).toBe(true)
    await expect(page.getByText(/heavy rain expected/i).first()).toBeVisible()
  })

  test('dashboard says alerts are unavailable instead of "conditions normal"', async ({ page, context }) => {
    await context.grantPermissions(['geolocation'])
    await context.setGeolocation({ latitude: PUNE.latitude, longitude: PUNE.longitude })
    const log = await mockBackend(page, { fail: { '/api/alerts': 503 } })
    await enterDemo(page)
    await page.getByRole('button', { name: /use my current location/i }).first().click()
    const banner = page.getByRole('status').filter({ hasText: /temporarily unavailable/i })
    await expect(banner).toBeVisible()
    await expect(page.getByText(/conditions normal/i)).toHaveCount(0)

    // Retry re-requests alerts.
    const before = log.paths.filter((p) => p === '/api/alerts').length
    await banner.getByRole('button', { name: /retry/i }).click()
    await expect.poll(() => log.paths.filter((p) => p === '/api/alerts').length).toBe(before + 1)
  })

  test('dashboard questions open in the Living Sky console with the picked place', async ({ page, context }) => {
    await context.grantPermissions(['geolocation'])
    await context.setGeolocation({ latitude: PUNE.latitude, longitude: PUNE.longitude })
    const log = await mockBackend(page)
    await enterDemo(page)
    await page.getByRole('button', { name: /use my current location/i }).first().click()
    // no second chat box on the dashboard
    await expect(page.getByRole('textbox', { name: /ask about the weather/i })).toHaveCount(0)
    await page.getByRole('link', { name: 'Will it rain tomorrow?' }).click()
    await page.waitForURL((u) => u.pathname === '/')
    await expect.poll(() => log.chat.length).toBe(1)
    expect(log.chat[0].message).toBe('Will it rain tomorrow?')
    expect(log.chat[0].latitude).toBeCloseTo(PUNE.latitude, 3)
    expect(log.chat[0].longitude).toBeCloseTo(PUNE.longitude, 3)
    await expect(page.getByText(/12\.4 mm/).first()).toBeVisible({ timeout: 20_000 })
  })

  test('protected pages redirect to login without a session', async ({ page }) => {
    await mockBackend(page)
    await page.goto('/alerts')
    await page.waitForURL('**/login')
  })
})
