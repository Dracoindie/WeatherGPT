/**
 * Wind particles: each particle moves with the wind interpolated from the
 * grid (Open-Meteo speed and direction at the selected hour). Speed on screen
 * is proportional to the real speed; the scale is the same for every particle,
 * so a 30 km/h area visibly moves twice as fast as a 15 km/h one.
 */

import type { MapGrid } from '@/lib/api/map'
import { sample, windComponents } from './field'

export interface Particle {
  lon: number
  lat: number
  /** previous position, for the streak */
  plon: number
  plat: number
  age: number
  speed: number
}

export interface ParticleField {
  grid: MapGrid
  u: Array<number | null>
  v: Array<number | null>
  particles: Particle[]
  maxSpeed: number
}

const MAX_AGE = 90

function spawn(grid: MapGrid, p?: Particle): Particle {
  const north = grid.south + (grid.rows - 1) * grid.step_deg
  const east = grid.west + (grid.cols - 1) * grid.step_deg
  const lat = grid.south + Math.random() * (north - grid.south)
  const lon = grid.west + Math.random() * (east - grid.west)
  const out = p ?? ({} as Particle)
  out.lat = out.plat = lat
  out.lon = out.plon = lon
  out.age = Math.floor(Math.random() * MAX_AGE)
  out.speed = 0
  return out
}

export function createField(grid: MapGrid, hour: number, count: number): ParticleField {
  const { u, v } = windComponents(grid, hour)
  let maxSpeed = 0
  for (const p of grid.points) maxSpeed = Math.max(maxSpeed, p.wind_speed_10m[hour] ?? 0)
  return { grid, u, v, maxSpeed, particles: Array.from({ length: count }, () => spawn(grid)) }
}

/** Advance one frame. `degPerKmh` turns km/h into degrees per frame for the current zoom. */
export function step(field: ParticleField, degPerKmh: number): void {
  const { grid, u, v } = field
  for (const p of field.particles) {
    p.age += 1
    const du = sample(grid, u, p.lat, p.lon)
    const dv = sample(grid, v, p.lat, p.lon)
    if (du == null || dv == null || p.age > MAX_AGE) {
      spawn(grid, p)
      p.age = 0
      continue
    }
    p.plon = p.lon
    p.plat = p.lat
    const cos = Math.max(0.2, Math.cos((p.lat * Math.PI) / 180))
    p.lon += (du * degPerKmh) / cos
    p.lat += dv * degPerKmh
    p.speed = Math.hypot(du, dv)
  }
}

/** Fewer particles on phones and small screens. */
export function particleCount(width: number, mobile: boolean): number {
  if (mobile || width < 640) return 350
  if (width < 1100) return 900
  return 1500
}
