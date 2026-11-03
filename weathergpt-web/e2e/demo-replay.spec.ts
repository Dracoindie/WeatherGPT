import { expect, test } from '@playwright/test'
import { mockBackend } from './support/mockApi'

/**
 * Demo replay (DEMO_REPLAY=1, docs/DEMO.md): recorded answers must never look
 * live. Any response with X-WeatherGPT-Replay shows the badge with its time.
 */

const RECORDED = '2026-11-03T02:45:00Z' // 08:15 IST

async function ask(page: import('@playwright/test').Page) {
  await page.goto('/')
  const input = page.getByRole('textbox').first()
  await input.fill('Will it rain in Pune tomorrow?')
  await input.press('Enter')
  await page.getByTestId('weather-description').first().waitFor({ timeout: 20_000 })
}

test('replayed answers show "Replay: recorded data from <time>"', async ({ page }) => {
  await mockBackend(page, { replayAt: RECORDED })
  await ask(page)
  const badge = page.getByTestId('replay-badge')
  await expect(badge).toBeVisible()
  await expect(badge).toHaveText(/^Replay: recorded data from 3 Nov(,)? 0?8:15/i)
  await expect(badge).toHaveAttribute('title', /not live/)
})

test('live answers show no replay badge', async ({ page }) => {
  await mockBackend(page)
  await ask(page)
  await expect(page.getByTestId('replay-badge')).toHaveCount(0)
})

test('the badge stays on other pages after replayed data was shown', async ({ page }) => {
  await mockBackend(page, { replayAt: RECORDED })
  await ask(page)
  await page.locator('a[href="/alerts"]').first().dispatchEvent('click')
  await page.waitForURL('**/alerts')
  await expect(page.getByTestId('replay-badge')).toBeVisible()
})

for (const [lang, re] of [
  ['hi', /^रीप्ले: .+ का रिकॉर्ड किया गया डेटा$/],
  ['hinglish', /^Replay: .+ ka recorded data$/],
  ['mr', /^रिप्ले: .+ रोजी रेकॉर्ड केलेला डेटा$/],
] as const) {
  test(`replay badge in ${lang}`, async ({ page }) => {
    await page.addInitScript((l) => localStorage.setItem('wgpt:lang', l), lang)
    await mockBackend(page, { replayAt: RECORDED })
    await ask(page)
    await expect(page.getByTestId('replay-badge')).toHaveText(re)
  })
}
