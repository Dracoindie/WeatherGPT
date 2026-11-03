import { expect, test } from '@playwright/test'
import { fillTemplate, KEYLESS, mapSources, tilesFor, tileXY } from '../components/map3d/sources'

/**
 * Basemap/terrain source choice (components/map3d/sources.ts), no browser.
 * NEXT_PUBLIC_MAPTILER_KEY is inlined at build time, so the choice is tested
 * as a pure function; the runtime fallback (MapTiler refuses -> keyless) is in
 * WeatherMap's error handler.
 */

test('no key: the keyless OpenFreeMap style and AWS terrarium terrain', () => {
  for (const key of [undefined, '', '   ']) {
    const s = mapSources(key)
    expect(s).toEqual(KEYLESS)
    expect(s.style).toBe('https://tiles.openfreemap.org/styles/dark')
    expect(s.terrain.encoding).toBe('terrarium')
  }
})

test('with a key: MapTiler style and terrain-rgb, key URL-encoded', () => {
  const s = mapSources(' ab c&d ')
  expect(s.provider).toBe('maptiler')
  expect(s.style).toBe('https://api.maptiler.com/maps/dataviz-dark/style.json?key=ab%20c%26d')
  expect(s.terrain.url).toBe('https://api.maptiler.com/tiles/terrain-rgb-v2/tiles.json?key=ab%20c%26d')
  expect(s.terrain.encoding).toBe('mapbox')
})

test('tile maths for the offline pack', () => {
  expect(tileXY(0, 0, 1)).toEqual([1, 1])
  expect(tileXY(-180, 85, 2)).toEqual([0, 0])
  // Pune at zoom 8: OSM tile 180/114 (standard slippy-map formula)
  expect(tileXY(73.8567, 18.5204, 8)).toEqual([180, 114])
  const tiles = tilesFor({ south: 18.2, west: 72.7, north: 19.4, east: 74.3 }, 6, 10)
  expect(tiles.length).toBeGreaterThan(10)
  expect(tiles.length).toBeLessThan(80)
  expect(Math.min(...tiles.map((t) => t.z))).toBe(6)
  expect(Math.max(...tiles.map((t) => t.z))).toBe(10)
  expect(fillTemplate('https://x/{z}/{x}/{y}.png', { z: 8, x: 180, y: 115 })).toBe('https://x/8/180/115.png')
})
