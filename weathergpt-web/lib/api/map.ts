/** Typed clients for GET /api/map/point and /api/map/grid (backend/api/map.py). */

import { API_BASE } from '@/lib/api/base'
import type { AqiCategory, UvCategory } from '@/lib/api/air'
import { apiFetch } from '@/lib/replay'

export type HeatBandId = 'lower_risk' | 'caution' | 'extreme_caution' | 'danger' | 'extreme_danger'

export interface MapPoint {
  source: string
  latitude: number
  longitude: number
  model_latitude: number
  model_longitude: number
  model_grid_km: number
  timezone: string
  local_time: string
  observed_at: string
  temperature_c: number
  feels_like_c: number | null
  humidity_pct: number
  wind_speed_kmh: number
  wind_direction_deg: number
  precipitation_probability_pct: number | null
  precipitation_mm: number
  weather_code: number
  uv_index: number | null
  uv_category: UvCategory | null
  aqi: number | null
  aqi_category: AqiCategory | null
  heat_index_c: number | null
  heat_band: HeatBandId | null
  note: string
}

export interface GridPoint {
  latitude: number
  longitude: number
  elevation: number | null
  temperature_2m: Array<number | null>
  relative_humidity_2m: Array<number | null>
  apparent_temperature: Array<number | null>
  precipitation: Array<number | null>
  precipitation_probability: Array<number | null>
  wind_speed_10m: Array<number | null>
  wind_direction_10m: Array<number | null>
  heat_index: Array<number | null>
}

export interface HeatBand {
  id: Exclude<HeatBandId, 'lower_risk'>
  label: string
  min_c: number
}

export interface MapGrid {
  source: string
  retrieved_at: string
  south: number
  west: number
  north: number
  east: number
  step_deg: number
  spacing_km: number
  model_grid_km: number
  rows: number
  cols: number
  /** UTC hours, ISO with Z */
  times: string[]
  /** row-major, south to north, west to east */
  points: GridPoint[]
  heat_index_bands: HeatBand[]
  note: string
}

export interface Bounds {
  south: number
  west: number
  north: number
  east: number
}

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  let resp: Response
  try {
    resp = await apiFetch(url, { signal })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err
    throw new Error('Could not reach the WeatherGPT backend.')
  }
  if (!resp.ok) throw new Error(`Map data error ${resp.status}`)
  return (await resp.json()) as T
}

export function fetchMapPoint(latitude: number, longitude: number, signal?: AbortSignal): Promise<MapPoint> {
  return getJson(`${API_BASE}/api/map/point?latitude=${latitude.toFixed(4)}&longitude=${longitude.toFixed(4)}`, signal)
}

export function fetchMapGrid(b: Bounds, maxPoints: number, signal?: AbortSignal): Promise<MapGrid> {
  const q = new URLSearchParams({
    south: b.south.toFixed(3),
    west: b.west.toFixed(3),
    north: b.north.toFixed(3),
    east: b.east.toFixed(3),
    max_points: String(maxPoints),
  })
  return getJson(`${API_BASE}/api/map/grid?${q}`, signal)
}
