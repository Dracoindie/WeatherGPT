import { expect, test } from '@playwright/test'
import { enterDemo, mockBackend, PUNE } from './support/mockApi'

/**
 * Screenshot-review polish: whole-word console placeholder, one sign-in line
 * for push alerts (4 languages), no WMO code for non-researchers, and GFS
 * hours as local clock times.
 */

test('console placeholder shows whole words and fits, at every frame', async ({ page }) => {
  await mockBackend(page)
  await page.goto('/')
  const span = page.locator('form.sky-console span[aria-hidden="true"] > span.truncate').first()
  await span.waitFor()
  for (let i = 0; i < 25; i++) {
    const s = await span.evaluate((el) => ({
      text: (el.textContent ?? '').trim(),
      full: el.getAttribute('data-full') ?? '',
      fits: el.scrollWidth <= el.clientWidth + 1,
    }))
    expect(s.fits).toBe(true)
    // a prefix of the example that ends at a word boundary
    expect(s.full.startsWith(s.text)).toBe(true)
    expect(s.text === '' || s.text === s.full || s.full[s.text.length] === ' ').toBe(true)
    await page.waitForTimeout(150)
  }
})

const SIGNIN: Record<string, { line: RegExp; link: string }> = {
  en: { line: /^Sign in to get push alerts\.$/, link: 'Sign in' },
  hi: { line: /^पुश अलर्ट पाने के लिए साइन इन करें।$/, link: 'साइन इन करें' },
  hinglish: { line: /^Push alerts ke liye sign in karo\.$/, link: 'sign in karo' },
  mr: { line: /^पुश सूचना मिळवण्यासाठी साइन इन करा\.$/, link: 'साइन इन करा' },
}

for (const [lang, want] of Object.entries(SIGNIN)) {
  test(`push section: one sign-in line with a link (${lang})`, async ({ page }) => {
    await page.addInitScript((l) => localStorage.setItem('wgpt:lang', l), lang)
    await mockBackend(page)
    await enterDemo(page) // demo mode has no account, so push asks to sign in
    await page.locator('a[href="/alerts"]').first().dispatchEvent('click')
    await page.waitForURL('**/alerts')
    const line = page.getByTestId('push-signin')
    await expect(line).toHaveText(want.line)
    await expect(line.getByRole('link', { name: want.link })).toHaveAttribute('href', '/login')
  })
}

async function askPune(page: import('@playwright/test').Page) {
  await page.goto('/')
  const input = page.getByRole('textbox', { name: /ask about the weather/i })
  await input.fill('Will it rain in Pune tomorrow?')
  await input.press('Enter')
  await page.getByTestId('weather-description').first().waitFor({ timeout: 20_000 })
}

test('location panel hides the WMO code unless the role is researcher', async ({ page }) => {
  await mockBackend(page)
  await askPune(page)
  await expect(page.getByTestId('wmo-code')).toHaveCount(0)
  await expect(page.getByText(/WMO \d+/)).toHaveCount(0)
  await expect(page.getByTestId('weather-description').first()).toHaveAttribute('title', /^WMO \d+$/)
})

test('researcher still sees the WMO code', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('wgpt:role', 'researcher'))
  await mockBackend(page)
  await askPune(page)
  await expect(page.getByTestId('wmo-code').first()).toHaveText(/^WMO \d+$/)
})

test('dashboard GFS table shows local clock times, with the run time as caption', async ({ page, context }) => {
  await context.grantPermissions(['geolocation'])
  await context.setGeolocation({ latitude: PUNE.latitude, longitude: PUNE.longitude })
  await mockBackend(page)
  await enterDemo(page)
  await page.getByRole('button', { name: /use my current location/i }).first().click()
  const caption = page.getByTestId('gfs-run')
  // mock run 2026-11-01 00:00 UTC; Pune is Asia/Kolkata (UTC+5:30)
  await expect(caption).toContainText('Model run')
  await expect(caption).toContainText('UTC')
  await expect(caption).toContainText('Asia/Kolkata')
  const table = page.getByRole('table', { name: /GFS/i }).filter({ visible: true })
  await expect(table.getByText('05:30', { exact: true })).toBeVisible()
  await expect(table.getByText('06:30', { exact: true })).toBeVisible()
  await expect(table.getByText(/\+\d+ h/)).toHaveCount(0)
})
