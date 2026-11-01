import { expect, test, type Page } from '@playwright/test'
import { mockBackend } from './support/mockApi'

/**
 * Living Sky home layout: the answer panels form full rows (no holes) at
 * desktop and phone widths, the console placeholder never overflows, the
 * location WINDOW is human-readable, and the sky covers the whole page.
 */

async function answer(page: Page) {
  await mockBackend(page)
  await page.goto('/')
  const input = page.getByRole('textbox', { name: /ask about the weather/i })
  await input.fill('Will it rain in Pune tomorrow?')
  await input.press('Enter')
  await page.getByText('UV index').waitFor({ timeout: 20_000 })
  await page.waitForTimeout(1500) // stagger-in animation
}

test('answer panels fill every row of the grid (no holes)', async ({ page }) => {
  await answer(page)
  const rows = await page.locator('main section.grid').first().evaluate((grid) => {
    const box = grid.getBoundingClientRect()
    const cells = [...grid.children].map((c) => c.getBoundingClientRect())
    const byTop = new Map<number, number>()
    for (const c of cells) {
      const top = Math.round(c.top)
      byTop.set(top, Math.max(byTop.get(top) ?? 0, c.right))
    }
    return { right: box.right, rowRights: [...byTop.values()], count: cells.length }
  })
  expect(rows.count).toBeGreaterThanOrEqual(8)
  for (const r of rows.rowRights) expect(Math.abs(r - rows.right)).toBeLessThanOrEqual(2)
})

test('location WINDOW is readable, not a raw ISO range', async ({ page }) => {
  await answer(page)
  await expect(page.getByText('Mon 2 Nov, 00:00–23:00').first()).toBeVisible()
  await expect(page.getByText(/2026-11-02T00:00/)).toHaveCount(0)
})

test('console placeholder never overflows its box', async ({ page }) => {
  await mockBackend(page)
  await page.goto('/')
  const span = page.locator('form.sky-console span[aria-hidden="true"] > span.truncate').first()
  await span.waitFor()
  for (let i = 0; i < 6; i++) {
    const fits = await span.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)
    expect(fits).toBe(true)
    await page.waitForTimeout(700)
  }
})

test('the sky background covers the full page height', async ({ page }) => {
  await answer(page)
  const ok = await page.evaluate(() => {
    const sky = document.querySelector('[data-testid="static-sky"]') as HTMLElement | null
    if (!sky) return false
    const docH = document.documentElement.scrollHeight
    const skyBottom = sky.getBoundingClientRect().bottom + window.scrollY
    return skyBottom >= docH - 2
  })
  expect(ok).toBe(true)
})
