import { expect, test, type Page } from '@playwright/test'
import { chatResponse, CLIMATE_FACTS as CLIMATE, GFS_FACTS as GFS, mockBackend, PUNE } from './support/mockApi'

/** Unified chat: follow-up context, climate and GFS answers. */

async function ask(page: Page, text: string) {
  const input = page.getByRole('textbox', { name: /ask about the weather/i })
  await input.fill(text)
  await input.press('Enter')
}

test('a follow-up sends the previous answer as context', async ({ page }) => {
  const log = await mockBackend(page)
  await page.goto('/')
  await ask(page, 'Will it rain in Pune tomorrow?')
  await expect(page.getByText(/12\.4 mm/).first()).toBeVisible({ timeout: 20_000 })
  expect(log.chat[0].context).toBeUndefined()

  await ask(page, 'aur parso?')
  await expect.poll(() => log.chat.length).toBe(2)
  expect(log.chat[1]).toMatchObject({
    message: 'aur parso?',
    context: {
      intent: 'forecast',
      location_name: PUNE.name,
      latitude: PUNE.latitude,
      longitude: PUNE.longitude,
      date_reference: 'tomorrow',
      weather_parameter: 'precipitation',
    },
  })
})

test('climate answer shows the past-years comparison panel', async ({ page }) => {
  await mockBackend(page, {
    chat: () =>
      chatResponse({
        message: 'In Pune so far this year, the average daily high was 32.1°C against a 2016–2025 average of 31.2°C.',
        intent: { intent: 'climate', climate_period: 'this_year', weather_parameter: 'high_temperature', date_reference: 'now' },
        extra: { weather: null, advisory: null, climate: CLIMATE, source: 'open-meteo-archive' },
      }),
  })
  await page.goto('/')
  await ask(page, 'Is this year hotter than usual in Pune?')
  await expect(page.getByText(/climate · vs past years/i)).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText('usual 31.2°C')).toBeVisible()
  await expect(page.getByText('+0.9°C high')).toBeVisible()
})

test('GFS answer shows the model panel', async ({ page }) => {
  await mockBackend(page, {
    chat: () =>
      chatResponse({
        message: 'GFS model (run 2026-11-01 06:00 UTC) for Pune tomorrow: 21.6–28.1°C, 13.2 mm of precipitation.',
        intent: { intent: 'nwp', date_reference: 'tomorrow', weather_parameter: 'general' },
        extra: { weather: null, advisory: null, nwp: GFS, source: 'gfs-nomads' },
      }),
  })
  await page.goto('/')
  await ask(page, 'What does GFS say for tomorrow in Pune?')
  await expect(page.getByText(/raw model output, not an official forecast/i)).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText('21.6–28.1°', { exact: true })).toBeVisible()
})
