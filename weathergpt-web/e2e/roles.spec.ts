import { expect, test, type Page } from '@playwright/test'
import { mockBackend } from './support/mockApi'
import { BOARD, FARM } from './support/roleFixtures'

/** Role modes: selector, role sent with chat, role panels, disaster board. */

async function ask(page: Page, text: string) {
  const input = page.getByRole('textbox', { name: /ask about the weather/i })
  await input.fill(text)
  await input.press('Enter')
}

async function pickRole(page: Page, isMobile: boolean, label: string) {
  if (isMobile) await page.getByRole('button', { name: /menu/i }).first().click()
  await page.getByRole('combobox', { name: 'Role' }).first().selectOption({ label })
}

test('the chosen role is sent with chat questions and remembered', async ({ page, isMobile }) => {
  const log = await mockBackend(page, { routes: { '/api/farm': FARM } })
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await pickRole(page, isMobile, 'Farmer')
  if (isMobile) await page.getByRole('button', { name: /menu/i }).first().click()
  await ask(page, 'Will it rain in Pune tomorrow?')
  await expect.poll(() => log.chat.length).toBe(1)
  expect(log.chat[0].role).toBe('farmer')
  expect(await page.evaluate(() => localStorage.getItem('wgpt:role'))).toBe('farmer')

  // Farmer panel renders the server's windows and statuses.
  await expect(page.getByText('Farm guidance · next 3 days')).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText(/06:00–10:00/)).toBeVisible()
  await expect(page.getByText(/wait and check soil moisture/)).toBeVisible()
  await expect(page.getByText(/not an official IMD/).first()).toBeVisible()
  expect(log.paths).toContain('/api/farm')
})

test('disaster board lists districts most severe first', async ({ page }) => {
  await mockBackend(page, { routes: { '/api/risk': BOARD } })
  await page.goto('/disaster')
  const items = page.getByRole('region', { name: 'Districts by severity' }).getByRole('listitem')
  await expect(items).toHaveCount(BOARD.districts.length)
  await expect(items.nth(0)).toContainText('Ratnagiri')
  await expect(items.nth(0)).toContainText('warning')
  await expect(items.last()).toContainText('Latur')
  await expect(items.last()).toContainText('unknown')
  await expect(page.getByText(/not official IMD warnings/i)).toBeVisible()
})
