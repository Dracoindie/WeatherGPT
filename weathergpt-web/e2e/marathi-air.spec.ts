import { expect, test } from '@playwright/test'
import { chatResponse, mockBackend } from './support/mockApi'

/** Marathi UI + replies, and the AQI / UV panels. */

test('Marathi UI toggle and a Marathi reply', async ({ page, isMobile }) => {
  await mockBackend(page, {
    chat: () =>
      chatResponse({
        message: 'Pune मध्ये उद्या एकूण पाऊस 12.4 मिमी आणि पावसाची कमाल शक्यता 80% आहे (Open-Meteo).',
        language: 'mr',
      }),
  })
  await page.goto('/')
  if (isMobile) await page.getByRole('button', { name: /menu/i }).first().click()
  await page.getByRole('button', { name: 'मरा' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('आकाशाला विचारा')
  if (isMobile) await page.getByRole('button', { name: /मेनू/ }).first().click()
  const input = page.getByRole('textbox', { name: 'हवामानाबद्दल विचारा' })
  await input.fill('पुण्यात उद्या पाऊस पडेल का?')
  await input.press('Enter')
  await expect(page.getByText(/पावसाची कमाल शक्यता 80%/).first()).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText('WeatherGPT · mr')).toBeVisible()
})

test('AQI and UV panels show the API values with their bands', async ({ page }) => {
  const log = await mockBackend(page)
  await page.goto('/')
  const input = page.getByRole('textbox', { name: /ask about the weather/i })
  await input.fill('Will it rain in Pune tomorrow?')
  await input.press('Enter')
  await expect(page.getByText('Air quality · India AQI')).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText('Satisfactory')).toBeVisible()
  await expect(page.getByText(/PM2\.5 48\.2 · PM10 92\.6/)).toBeVisible()
  await expect(page.getByText(/Next 24 h: AQI 135/)).toBeVisible()
  await expect(page.getByText(/not a CPCB station reading/)).toBeVisible()
  await expect(page.getByText('UV index')).toBeVisible()
  await expect(page.getByText(/Max today 8\.6/)).toBeVisible()
  expect(log.paths).toContain('/api/air-quality')
})
