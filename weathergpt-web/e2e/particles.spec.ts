import { expect, test } from '@playwright/test'
import type { MapGrid } from '../lib/api/map'
import { createField, PARTICLE_STYLE, particleCount, retarget, segmentAlpha, step, TRAIL } from '../components/map3d/particles'

/**
 * Wind particles leave a short trail that fades toward the tail, and in
 * broadcast over a weather surface they are thinner, fainter and sparser.
 * Pure logic: no page.
 */

/** 3 x 3 points, 1 degree apart, a steady 20 km/h wind from the west at every hour. */
function westerly(): MapGrid {
  const points = []
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 3; c++)
      points.push({ latitude: 18 + r, longitude: 73 + c, wind_speed_10m: [20], wind_direction_10m: [270] })
  return { south: 18, west: 73, rows: 3, cols: 3, step_deg: 1, points } as unknown as MapGrid
}

test('the trail keeps the last positions, newest first, and starts with no tail', () => {
  const f = createField(westerly(), 0, 20)
  // a new particle: every trail point is its start (zero-length segments, nothing drawn)
  for (const q of f.particles) for (let k = 0; k < TRAIL; k++) expect([q.trail[2 * k], q.trail[2 * k + 1]]).toEqual([q.lon, q.lat])
  // one particle in the middle of the grid, far from its edges, freshly born
  const p = f.particles[0]
  p.age = 0
  p.lon = 74
  p.lat = 19
  for (let k = 0; k < TRAIL; k++) p.trail.set([74, 19], 2 * k)
  const start = p.lon
  step(f, 0.001)
  step(f, 0.001)
  // westerly: it moves east; point 0 is now, point 1 one frame ago, point 2 the start
  expect(p.trail[0]).toBe(p.lon)
  expect(p.trail[0]).toBeGreaterThan(p.trail[2])
  expect(p.trail[2]).toBeGreaterThan(p.trail[4])
  expect(p.trail[4]).toBeCloseTo(start, 10)
})

test('segment alpha fades to 0 toward the tail and grows with speed', () => {
  const s = PARTICLE_STYLE.normal
  const head = segmentAlpha(s, 0, 20, 20)
  expect(head).toBe(s.maxAlpha)
  expect(segmentAlpha(s, TRAIL - 1, 20, 20)).toBe(0)
  for (let k = 1; k < TRAIL; k++) expect(segmentAlpha(s, k, 20, 20)).toBeLessThan(segmentAlpha(s, k - 1, 20, 20))
  expect(segmentAlpha(s, 0, 5, 20)).toBeLessThan(head)
})

test('broadcast over a surface: thinner, fainter and under half the particles', () => {
  expect(PARTICLE_STYLE.soft.width).toBeLessThan(PARTICLE_STYLE.normal.width)
  expect(PARTICLE_STYLE.soft.maxAlpha).toBeLessThan(PARTICLE_STYLE.normal.maxAlpha)
  for (const [w, mobile] of [[1440, false], [900, false], [390, true]] as const) {
    expect(particleCount(w, mobile, true)).toBeLessThan(particleCount(w, mobile) / 2)
    expect(particleCount(w, mobile, true)).toBeGreaterThan(0)
  }
})

test('new particles are born inside the visible part of the grid', () => {
  const f = createField(westerly(), 0, 200)
  f.spawnBox = { south: 18.5, west: 73.5, north: 19, east: 74 }
  for (const p of f.particles) p.age = 1000 // all expire on the next step
  step(f, 0.0001)
  for (const p of f.particles) {
    expect(p.lat).toBeGreaterThanOrEqual(18.5)
    expect(p.lat).toBeLessThanOrEqual(19)
    expect(p.lon).toBeGreaterThanOrEqual(73.5)
    expect(p.lon).toBeLessThanOrEqual(74)
  }
})

test('a new hour keeps the particles and their trails, with the new wind', () => {
  const f = createField(westerly(), 0, 50)
  for (let i = 0; i < 3; i++) step(f, 0.0005)
  const before = f.particles.map((p) => Array.from(p.trail))
  const calm = westerly()
  for (const pt of calm.points as unknown as Array<{ wind_speed_10m: number[] }>) pt.wind_speed_10m = [5]
  retarget(f, calm, 0)
  expect(f.maxSpeed).toBe(5)
  expect(f.particles.map((p) => Array.from(p.trail))).toEqual(before)
})
