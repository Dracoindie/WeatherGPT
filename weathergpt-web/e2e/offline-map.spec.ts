import { expect, test, type BrowserContext } from '@playwright/test'
import { enterDemo, mockBackend } from './support/mockApi'

/**
 * Settings -> "Prepare offline map": the basemap (style, TileJSON, vector
 * tiles, sprites, fonts) and terrain for the demo region, zoom 6-10, go into
 * the "wgpt-v2-map" cache; with the network off, the service worker answers
 * map requests from it (docs/DEMO.md). Tile hosts are mocked: no network.
 */

const REGION = { name: 'Pune–Mumbai', south: 18.2, west: 72.7, north: 19.4, east: 74.3, min_zoom: 6, max_zoom: 10 }

const STYLE = {
  version: 8,
  sources: { openmaptiles: { type: 'vector', url: 'https://tiles.openfreemap.org/planet' } },
  sprite: 'https://tiles.openfreemap.org/sprites/ofm/ofm',
  glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
  layers: [
    { id: 'background', type: 'background', paint: { 'background-color': '#111827' } },
    { id: 'place', type: 'symbol', source: 'openmaptiles', 'source-layer': 'place', layout: { 'text-field': '{name}', 'text-font': ['Noto Sans Regular'] } },
  ],
}

async function mockTiles(context: BrowserContext, seen: string[]) {
  await context.route(/tiles\.openfreemap\.org/, (route) => {
    const url = route.request().url()
    seen.push(url)
    const headers = { 'access-control-allow-origin': '*' }
    if (url.includes('/styles/')) return route.fulfill({ status: 200, headers, contentType: 'application/json', body: JSON.stringify(STYLE) })
    if (url.endsWith('/planet')) {
      return route.fulfill({ status: 200, headers, contentType: 'application/json', body: JSON.stringify({ tiles: ['https://tiles.openfreemap.org/planet/v1/{z}/{x}/{y}.pbf'], minzoom: 0, maxzoom: 14 }) })
    }
    if (url.endsWith('.json')) return route.fulfill({ status: 200, headers, contentType: 'application/json', body: '{}' })
    return route.fulfill({ status: 200, headers, body: Buffer.from([1, 2, 3, 4]) })
  })
}

test.describe('offline demo map', () => {
  test.use({ serviceWorkers: 'allow' })

  test('prepare saves the region; offline, the service worker serves it', async ({ page, context, isMobile }) => {
    test.skip(isMobile, 'the settings panel button sits in the desktop nav')
    await mockBackend(context, { routes: { '/api/map/demo-region': REGION } })
    const seen: string[] = []
    await mockTiles(context, seen)
    await enterDemo(page)
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined))

    await page.getByRole('button', { name: 'Settings' }).click()
    await page.getByTestId('offline-map-prepare').click()
    await expect(page.getByTestId('offline-map-status')).toContainText(/Saved \d+ files/, { timeout: 30_000 })
    await expect(page.getByTestId('offline-map-status')).toContainText('Pune–Mumbai')

    const urls = await page.evaluate(async () => (await (await caches.open('wgpt-v2-map')).keys()).map((r) => r.url))
    // style, TileJSON, vector tiles for zoom 6-10, sprites, Latin + Devanagari glyphs, terrain, worker
    expect(urls).toContain('https://tiles.openfreemap.org/styles/dark')
    expect(urls).toContain('https://tiles.openfreemap.org/planet')
    expect(urls.some((u) => /\/planet\/v1\/10\/\d+\/\d+\.pbf$/.test(u))).toBe(true)
    expect(urls.some((u) => /\/planet\/v1\/11\//.test(u))).toBe(false) // stops at zoom 10
    expect(urls.some((u) => u.endsWith('ofm@2x.png'))).toBe(true)
    expect(urls.some((u) => u.includes('2304-2559.pbf'))).toBe(true)
    expect(urls.some((u) => /elevation-tiles-prod\/terrarium\/8\//.test(u))).toBe(true)
    expect(urls.some((u) => u.endsWith('/vendor/maplibre-gl-worker.js'))).toBe(true)
    expect(urls.length).toBeLessThan(250) // small and polite

    const tile = urls.find((u) => /elevation-tiles-prod\/terrarium\/9\//.test(u))!
    await context.setOffline(true)
    const ok = await page.evaluate(async (u) => (await fetch(u)).ok, tile)
    expect(ok).toBe(true)
    const worker = await page.evaluate(async () => (await fetch('/vendor/maplibre-gl-worker.js?v=9.9.9')).ok)
    expect(worker).toBe(true)
    await context.setOffline(false)
  })

  test('browsing never adds tiles to the offline pack', async ({ page, context }) => {
    await mockBackend(context)
    const seen: string[] = []
    await mockTiles(context, seen)
    await page.goto('/')
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined))
    await page.evaluate(() => fetch('https://tiles.openfreemap.org/planet/v1/8/181/115.pbf').then(() => undefined))
    const count = await page.evaluate(async () => (await (await caches.open('wgpt-v2-map')).keys()).length)
    expect(count).toBe(0)
  })
})
