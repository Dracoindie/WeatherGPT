/**
 * Grid helpers for the /map layers. Pure functions over GET /api/map/grid.
 *
 * The surface between grid points is a smooth (bicubic, clamped) interpolation,
 * labelled as such on the map; every value at a grid point is the API's.
 * Colours are the validated --map-* ramps from app/globals.css, scaled by
 * scaleRange (the legend shows the same range and says which scale).
 */

import type { GridPoint, HeatBand, MapGrid } from '@/lib/api/map'

export type LayerId = 'temperature' | 'humidity' | 'wind' | 'rain' | 'heat'
export const LAYERS: LayerId[] = ['temperature', 'humidity', 'wind', 'rain', 'heat']

type SeriesKey = 'temperature_2m' | 'relative_humidity_2m' | 'wind_speed_10m' | 'precipitation' | 'heat_index'

export const LAYER_SERIES: Record<LayerId, SeriesKey> = {
  temperature: 'temperature_2m',
  humidity: 'relative_humidity_2m',
  wind: 'wind_speed_10m',
  rain: 'precipitation',
  heat: 'heat_index',
}

export const LAYER_UNIT: Record<LayerId, string> = {
  temperature: '°C',
  humidity: '%',
  wind: 'km/h',
  rain: 'mm',
  heat: '°C',
}

const RAMP_TOKEN: Record<LayerId, string> = {
  temperature: '--map-temp',
  humidity: '--map-humidity',
  wind: '--map-wind',
  rain: '--map-rain',
  heat: '--map-heat',
}

export type RGB = [number, number, number]

export function hexToRgb(hex: string): RGB {
  const h = hex.trim().replace('#', '')
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6)
  const n = parseInt(full, 16)
  if (Number.isNaN(n)) return [255, 255, 255]
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** A CSS custom property from :root as RGB (tokens, not hex, in components). */
export function tokenRgb(name: string, fallback: RGB = [255, 255, 255]): RGB {
  if (typeof document === 'undefined') return fallback
  const v = getComputedStyle(document.documentElement).getPropertyValue(name)
  return v ? hexToRgb(v) : fallback
}

/** Stops per ramp (--map-<layer>-0 … -n-1 in globals.css). */
const RAMP_STOPS: Record<LayerId, number> = { temperature: 3, humidity: 4, wind: 4, rain: 4, heat: 4 }
const stops = (layer: LayerId) => Array.from({ length: RAMP_STOPS[layer] }, (_, i) => i)

export function rampFor(layer: LayerId): RGB[] {
  return stops(layer).map((i) => tokenRgb(`${RAMP_TOKEN[layer]}-${i}`))
}

export function rampCss(layer: LayerId): string {
  return `linear-gradient(90deg, ${stops(layer).map((i) => `var(${RAMP_TOKEN[layer]}-${i})`).join(', ')})`
}

/** One series' values at an hour, row-major like grid.points. */
export function valuesAt(grid: MapGrid, layer: LayerId, hour: number): Array<number | null> {
  const key = LAYER_SERIES[layer]
  return grid.points.map((p) => (p[key] as Array<number | null>)[hour] ?? null)
}

/** Min and max of a series over every point and every hour (a stable legend). */
export function seriesRange(grid: MapGrid, layer: LayerId): { min: number; max: number } | null {
  const key = LAYER_SERIES[layer]
  let min = Infinity
  let max = -Infinity
  for (const p of grid.points) {
    for (const v of p[key] as Array<number | null>) {
      if (v == null) continue
      if (v < min) min = v
      if (v > max) max = v
    }
  }
  return Number.isFinite(min) ? { min, max } : null
}

/** Min and max over every point at one hour: the colour scale of that hour's surface and legend.
 * (The 72 h range would be dominated by the day-night swing, so one hour's
 * spatial differences used only a sliver of the ramp and looked like one colour.) */
export function hourRange(grid: MapGrid, layer: LayerId, hour: number): { min: number; max: number } | null {
  let min = Infinity
  let max = -Infinity
  for (const v of valuesAt(grid, layer, hour)) {
    if (v == null) continue
    if (v < min) min = v
    if (v > max) max = v
  }
  return Number.isFinite(min) ? { min, max } : null
}

/**
 * The colour scale of the surface and its legend. Paused: the range at the
 * hour shown, so one hour's spatial differences use the whole ramp. Playing
 * (fixed): the range over all hours, held still, so a colour change while
 * the hours run is a real change and not the scale moving. Rain always uses
 * the full range (one dry hour would have no range at all).
 */
export function scaleRange(grid: MapGrid, layer: LayerId, hour: number, fixed: boolean): { min: number; max: number } | null {
  return fixed || layer === 'rain' ? seriesRange(grid, layer) : hourRange(grid, layer, hour)
}

/** Bilinear interpolation at (lat, lon); null outside the grid or next to a missing value. */
export function sample(grid: MapGrid, values: Array<number | null>, lat: number, lon: number): number | null {
  const fr = (lat - grid.south) / grid.step_deg
  const fc = (lon - grid.west) / grid.step_deg
  if (fr < 0 || fc < 0 || fr > grid.rows - 1 || fc > grid.cols - 1) return null
  const r0 = Math.min(Math.floor(fr), grid.rows - 2)
  const c0 = Math.min(Math.floor(fc), grid.cols - 2)
  const tr = fr - r0
  const tc = fc - c0
  const at = (r: number, c: number) => values[r * grid.cols + c]
  const a = at(r0, c0)
  const b = at(r0, c0 + 1)
  const c = at(r0 + 1, c0)
  const d = at(r0 + 1, c0 + 1)
  if (a == null || b == null || c == null || d == null) return null
  return (a * (1 - tc) + b * tc) * (1 - tr) + (c * (1 - tc) + d * tc) * tr
}

const catmullRom = (p0: number, p1: number, p2: number, p3: number, t: number) =>
  0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t)

/**
 * Smooth interpolation at (lat, lon): bicubic (Catmull-Rom) through the 4 x 4
 * nearest grid points, clamped to the four surrounding values so it never
 * shows a value outside the data around it. Falls back to bilinear next to a
 * missing value; null outside the grid.
 */
export function sampleSmooth(grid: MapGrid, values: Array<number | null>, lat: number, lon: number): number | null {
  const fr = (lat - grid.south) / grid.step_deg
  const fc = (lon - grid.west) / grid.step_deg
  if (fr < 0 || fc < 0 || fr > grid.rows - 1 || fc > grid.cols - 1) return null
  const r0 = Math.min(Math.floor(fr), grid.rows - 2)
  const c0 = Math.min(Math.floor(fc), grid.cols - 2)
  const tr = fr - r0
  const tc = fc - c0
  const at = (r: number, c: number) => values[Math.max(0, Math.min(grid.rows - 1, r)) * grid.cols + Math.max(0, Math.min(grid.cols - 1, c))]
  const rows: number[] = []
  for (let dr = -1; dr <= 2; dr++) {
    const p = [at(r0 + dr, c0 - 1), at(r0 + dr, c0), at(r0 + dr, c0 + 1), at(r0 + dr, c0 + 2)]
    if (p.some((v) => v == null)) return sample(grid, values, lat, lon)
    rows.push(catmullRom(p[0]!, p[1]!, p[2]!, p[3]!, tc))
  }
  const v = catmullRom(rows[0], rows[1], rows[2], rows[3], tr)
  const corners = [at(r0, c0)!, at(r0, c0 + 1)!, at(r0 + 1, c0)!, at(r0 + 1, c0 + 1)!]
  return Math.max(Math.min(...corners), Math.min(Math.max(...corners), v))
}

export function rampColor(ramp: RGB[], t: number): RGB {
  const x = Math.max(0, Math.min(1, t)) * (ramp.length - 1)
  const i = Math.min(Math.floor(x), ramp.length - 2)
  const f = x - i
  const a = ramp[i]
  const b = ramp[i + 1]
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]
}

/** Index of the heat band (0 = Caution … 3 = Extreme danger), -1 below Caution. */
export function heatBandIndex(bands: HeatBand[], value: number | null): number {
  if (value == null) return -1
  let idx = -1
  bands.forEach((b, i) => {
    if (value >= b.min_c) idx = i
  })
  return idx
}

/**
 * RGBA pixels for a layer at an hour, rows north -> south (image order).
 * Rain below 0.1 mm and heat below Caution are left transparent.
 */
export function fieldPixels(
  grid: MapGrid,
  layer: LayerId,
  hour: number,
  ramp: RGB[],
  width: number,
  height: number,
  alpha = 255,
  fixed = false
): Uint8ClampedArray {
  const values = valuesAt(grid, layer, hour)
  const range = scaleRange(grid, layer, hour, fixed)
  const out = new Uint8ClampedArray(width * height * 4)
  if (!range) return out
  const span = range.max - range.min || 1
  const north = grid.south + (grid.rows - 1) * grid.step_deg
  const east = grid.west + (grid.cols - 1) * grid.step_deg
  for (let y = 0; y < height; y++) {
    const lat = north - ((north - grid.south) * y) / (height - 1)
    for (let x = 0; x < width; x++) {
      const lon = grid.west + ((east - grid.west) * x) / (width - 1)
      const v = sampleSmooth(grid, values, lat, lon)
      if (v == null) continue
      let rgb: RGB
      if (layer === 'heat') {
        const band = heatBandIndex(grid.heat_index_bands, v)
        if (band < 0) continue
        rgb = ramp[Math.min(band, ramp.length - 1)]
      } else if (layer === 'rain') {
        if (v < 0.1) continue
        rgb = rampColor(ramp, range.max > 0 ? v / range.max : 0)
      } else {
        rgb = rampColor(ramp, (v - range.min) / span)
      }
      const o = (y * width + x) * 4
      out[o] = rgb[0]
      out[o + 1] = rgb[1]
      out[o + 2] = rgb[2]
      out[o + 3] = alpha
    }
  }
  return out
}

/**
 * Fade the surface's alpha to 0 toward its four edges (smoothstep over
 * `frac` of the width and of the height), in place. In the tilted broadcast
 * view the far edge of the surface is on screen; a hard edge there reads as a
 * rectangle floating over the terrain. Colours are untouched.
 */
export function featherEdges(px: Uint8ClampedArray, width: number, height: number, frac: number): Uint8ClampedArray {
  if (frac <= 0) return px
  const smooth = (t: number) => (t >= 1 ? 1 : t * t * (3 - 2 * t))
  const fx = Math.max(1, frac * (width - 1))
  const fy = Math.max(1, frac * (height - 1))
  for (let y = 0; y < height; y++) {
    const ay = smooth(Math.min(y, height - 1 - y) / fy)
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4 + 3
      if (px[o] === 0) continue
      px[o] = Math.round(px[o] * ay * smooth(Math.min(x, width - 1 - x) / fx))
    }
  }
  return px
}

/** How many distinct colours (to 1/16 per channel) the opaque pixels use: a
 * surface where every cell got the same colour has 1. */
export function distinctColors(px: Uint8ClampedArray): number {
  const seen = new Set<number>()
  for (let o = 0; o < px.length; o += 4) {
    if (px[o + 3] === 0) continue
    seen.add(((px[o] >> 4) << 8) | ((px[o + 1] >> 4) << 4) | (px[o + 2] >> 4))
  }
  return seen.size
}

/** Wind as a vector the air moves TOWARD (km/h east, km/h north). Direction is "from", meteorological. */
export function windVector(speedKmh: number, fromDeg: number): [number, number] {
  const rad = (fromDeg * Math.PI) / 180
  return [-speedKmh * Math.sin(rad), -speedKmh * Math.cos(rad)]
}

/** u and v components at an hour, row-major. */
export function windComponents(grid: MapGrid, hour: number): { u: Array<number | null>; v: Array<number | null> } {
  const u: Array<number | null> = []
  const v: Array<number | null> = []
  for (const p of grid.points as GridPoint[]) {
    const s = p.wind_speed_10m[hour]
    const d = p.wind_direction_10m[hour]
    if (s == null || d == null) {
      u.push(null)
      v.push(null)
    } else {
      const [a, b] = windVector(s, d)
      u.push(a)
      v.push(b)
    }
  }
  return { u, v }
}

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const
export type Compass = (typeof COMPASS)[number]

export function compass(deg: number): Compass {
  return COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8]
}
