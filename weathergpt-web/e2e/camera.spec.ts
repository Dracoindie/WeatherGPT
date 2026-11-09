import { expect, test } from '@playwright/test'
import { broadcastCamera } from '../components/map3d/camera'

/**
 * The broadcast camera frames the terrain as relief on every width: the
 * phone framing (zoom 8, pitch 58) and, on wide maps, a closer zoom (the same
 * ground per pixel column) and a steeper tilt. Pure logic: no page.
 */
test('phone: zoom 8, pitch 58', () => {
  expect(broadcastCamera(390, 8)).toEqual({ zoom: 8, pitch: 58, bearing: -18 })
})

test('wide screens zoom in with the width, up to 9, and tilt to 64', () => {
  const tablet = broadcastCamera(640, 8)
  expect(tablet.zoom).toBeCloseTo(8 + Math.log2(640 / 390), 5)
  expect(tablet.pitch).toBe(64)
  const desktop = broadcastCamera(1440, 8)
  expect(desktop.zoom).toBe(9)
  expect(desktop.pitch).toBe(64)
})

test('never zooms out: a closer user zoom is kept; a country view is brought in', () => {
  expect(broadcastCamera(1440, 11).zoom).toBe(11)
  expect(broadcastCamera(390, 4).zoom).toBe(8)
})
