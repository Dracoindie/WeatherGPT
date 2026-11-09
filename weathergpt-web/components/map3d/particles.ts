/**
 * Wind particles: each particle moves with the wind interpolated from the
 * grid (Open-Meteo speed and direction at the selected hour). Speed on screen
 * is proportional to the real speed; the scale is the same for every particle,
 * so a 30 km/h area visibly moves twice as fast as a 15 km/h one.
 *
 * Each particle keeps its last TRAIL positions; the map draws them as short
 * segments that fade out toward the tail (a soft streak, not a hard dash).
 */

import type { MapGrid } from '@/lib/api/map'
import { sample, windComponents } from './field'

/** Positions kept per particle (TRAIL - 1 segments are drawn). */
export const TRAIL = 8

export interface Particle {
  lon: number
  lat: number
  /** [lon, lat] pairs, newest first: trail[0..1] is the current position */
  trail: Float64Array
  age: number
  speed: number
}

export interface ParticleField {
  grid: MapGrid
  u: Array<number | null>
  v: Array<number | null>
  particles: Particle[]
  maxSpeed: number
  /** where new particles are born: the visible part of the grid (set by the map each frame), else the whole grid */
  spawnBox?: { south: number; west: number; north: number; east: number }
}

const MAX_AGE = 90

function spawn(grid: MapGrid, p?: Particle, box?: ParticleField['spawnBox']): Particle {
  let south = grid.south
  let west = grid.west
  let north = grid.south + (grid.rows - 1) * grid.step_deg
  let east = grid.west + (grid.cols - 1) * grid.step_deg
  // the grid can reach far beyond the view (broadcast asks for a margin): born in view, a particle is seen
  if (box && box.south < north && box.north > south && box.west < east && box.east > west) {
    south = Math.max(south, box.south)
    north = Math.min(north, box.north)
    west = Math.max(west, box.west)
    east = Math.min(east, box.east)
  }
  const lat = south + Math.random() * (north - south)
  const lon = west + Math.random() * (east - west)
  const out = p ?? ({ trail: new Float64Array(TRAIL * 2) } as Particle)
  out.lat = lat
  out.lon = lon
  // a new particle has no tail yet: every trail point is where it starts (zero-length segments)
  for (let k = 0; k < TRAIL; k++) {
    out.trail[2 * k] = lon
    out.trail[2 * k + 1] = lat
  }
  out.age = Math.floor(Math.random() * MAX_AGE)
  out.speed = 0
  return out
}

export function createField(grid: MapGrid, hour: number, count: number, spawnBox?: ParticleField['spawnBox']): ParticleField {
  const { u, v } = windComponents(grid, hour)
  let maxSpeed = 0
  for (const p of grid.points) maxSpeed = Math.max(maxSpeed, p.wind_speed_10m[hour] ?? 0)
  return { grid, u, v, maxSpeed, spawnBox, particles: Array.from({ length: count }, () => spawn(grid, undefined, spawnBox)) }
}

/**
 * A new hour or grid: take its wind, keep the particles where they are and
 * keep their trails (rebuilding the field every hour while playing restarted
 * every streak with no tail). Particles outside a new grid respawn on the next step.
 */
export function retarget(field: ParticleField, grid: MapGrid, hour: number): void {
  const { u, v } = windComponents(grid, hour)
  let maxSpeed = 0
  for (const p of grid.points) maxSpeed = Math.max(maxSpeed, p.wind_speed_10m[hour] ?? 0)
  field.grid = grid
  field.u = u
  field.v = v
  field.maxSpeed = maxSpeed
}

/** Advance one frame. `degPerKmh` turns km/h into degrees per frame for the current zoom. */
export function step(field: ParticleField, degPerKmh: number): void {
  const { grid, u, v } = field
  for (const p of field.particles) {
    p.age += 1
    const du = sample(grid, u, p.lat, p.lon)
    const dv = sample(grid, v, p.lat, p.lon)
    if (du == null || dv == null || p.age > MAX_AGE) {
      spawn(grid, p, field.spawnBox)
      p.age = 0
      continue
    }
    const cos = Math.max(0.2, Math.cos((p.lat * Math.PI) / 180))
    p.lon += (du * degPerKmh) / cos
    p.lat += dv * degPerKmh
    p.trail.copyWithin(2, 0, (TRAIL - 1) * 2)
    p.trail[0] = p.lon
    p.trail[1] = p.lat
    p.speed = Math.hypot(du, dv)
  }
}

/**
 * Fewer particles on phones and small screens. `soft`: broadcast over a
 * weather surface, where the wind is a hint on top of the colours, at less
 * than half the density.
 */
export function particleCount(width: number, mobile: boolean, soft = false): number {
  const n = mobile || width < 640 ? 350 : width < 1100 ? 900 : 1500
  return soft ? Math.round(n * 0.4) : n
}

/** How the streaks look: broadcast over a surface is thinner and fainter. */
export interface ParticleStyle {
  width: number
  /** alpha of the head segment at the slowest and the fastest wind in view */
  minAlpha: number
  maxAlpha: number
}

export const PARTICLE_STYLE: Record<'normal' | 'soft', ParticleStyle> = {
  normal: { width: 1.5, minAlpha: 60, maxAlpha: 210 },
  soft: { width: 1, minAlpha: 40, maxAlpha: 160 },
}

/**
 * Alpha of segment k (0 = from the head to the previous point) of a particle
 * moving at `speed`: fades linearly to 0 toward the tail.
 */
export function segmentAlpha(style: ParticleStyle, k: number, speed: number, maxSpeed: number): number {
  const head = style.minAlpha + (style.maxAlpha - style.minAlpha) * Math.min(1, speed / Math.max(1, maxSpeed))
  return Math.round(head * (1 - k / (TRAIL - 1)))
}
