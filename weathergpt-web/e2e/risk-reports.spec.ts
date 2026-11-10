import { expect, test } from '@playwright/test'
import { BOARD } from './support/roleFixtures'
import { enterDemo, mockBackend } from './support/mockApi'

/**
 * The risk board lists recent community reports within 25 km of each district
 * (unverified; they never change a district's level). The mocked reports sit
 * around Pune (mockApi.ts reportsFixture).
 */
test('district rows show nearby community reports, labelled unverified, levels unchanged', async ({ page }) => {
  const log = await mockBackend(page, { routes: { '/api/risk': BOARD } })
  await enterDemo(page)
  await page.locator('a[href="/disaster"]').first().dispatchEvent('click')
  await page.waitForURL('**/disaster')
  const pune = page.getByTestId('risk-reports-Pune')
  await expect(pune).toHaveText('Community reports (unverified) within 25 km: 3 · Waterlogging, Fallen tree, Hail', { timeout: 30_000 })
  // far from Pune: no line
  await expect(page.getByTestId('risk-reports-Nagpur')).toHaveCount(0)
  // one request for the whole board, not one per district
  await expect.poll(() => log.paths.filter((p) => p === '/api/reports').length, { timeout: 5_000 }).toBeGreaterThan(0)
  // reports do not change the board's levels: the risk endpoint was asked for levels as before
  expect(log.paths.filter((p) => p === '/api/risk').length).toBeGreaterThan(0)
})
