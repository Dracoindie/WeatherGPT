/**
 * Typed clients for the role endpoints (backend/api/roles.py). Every number
 * shown from these comes from the API body; the rules are server-side.
 */

import { API_BASE } from '@/lib/api/base'

export interface SprayWindow {
  start: string
  end: string
  hours: number
  max_wind_kmh: number
  max_temperature_c: number
}

export interface FarmDay {
  date: string
  precipitation_mm: number
  max_precipitation_probability: number | null
  max_wind_kmh: number
  max_temperature_c: number
  harvest: 'good' | 'avoid'
  reasons: string[]
}

export interface FarmAdvice {
  timezone: string
  spray_windows: SprayWindow[]
  irrigation: {
    status: 'skip' | 'delay' | 'needed' | 'as_usual'
    rain_next_48h_mm: number
    max_precipitation_probability_24h: number | null
    max_temperature_48h_c: number
    reason: string
  }
  harvest_days: FarmDay[]
  sowing: { status: 'favourable' | 'dry' | 'wait'; rain_next_72h_mm: number; max_daily_rain_mm: number; reason: string }
  thresholds: Record<string, number>
  note: string
}

export interface AviationBriefing {
  observation_time: string
  visibility_km: number | null
  visibility_band: 'good' | 'moderate' | 'poor' | 'very_poor' | null
  cloud_cover_percent: number | null
  wind_kmh: number
  wind_kt: number
  wind_direction_deg: number
  gust_kmh: number | null
  gust_kt: number | null
  precipitation_mm: number
  weather_code: number
  weather_description: string | null
  next_hours: number
  next_min_visibility_km: number | null
  next_max_gust_kmh: number | null
  next_max_wind_kmh: number
  next_precipitation_mm: number
  next_max_weather_code: number | null
  flags: string[]
  note: string
}

export interface District {
  name: string
  latitude: number
  longitude: number
}

export type RiskLevel = 'warning' | 'watch' | 'advisory' | 'none' | 'unknown'

export interface DistrictRisk extends District {
  severity: RiskLevel
  alerts_count: number
  headline: string | null
  rain_24h_mm: number | null
  max_wind_24h_kmh: number | null
  max_temperature_24h_c: number | null
  error: string | null
}

export interface RiskBoard {
  generated_at: string
  districts: DistrictRisk[]
  note: string
}

export interface CompareRow {
  valid_time_utc: string
  open_meteo_temperature_c: number | null
  gfs_temperature_c: number | null
  open_meteo_precipitation_mm: number | null
  gfs_precipitation_mm: number | null
  open_meteo_wind_kmh: number | null
  gfs_wind_kmh: number | null
}

export interface ModelComparison {
  timezone: string
  gfs_run: string
  rows: CompareRow[]
  stats: {
    pairs: number
    temperature_bias_c: number | null
    temperature_mae_c: number | null
    wind_bias_kmh: number | null
    wind_mae_kmh: number | null
    open_meteo_precipitation_total_mm: number | null
    gfs_precipitation_total_mm: number | null
  }
  note: string
}

export class RoleApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'RoleApiError'
    this.status = status
  }
}

async function call<T>(path: string, init?: RequestInit & { signal?: AbortSignal }): Promise<T> {
  let resp: Response
  try {
    resp = await fetch(`${API_BASE}${path}`, init)
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err
    throw new RoleApiError(0, 'Could not reach the WeatherGPT backend.')
  }
  if (!resp.ok) {
    let detail = `Request failed (${resp.status})`
    try {
      const body = (await resp.json()) as { detail?: unknown }
      if (typeof body.detail === 'string') detail = body.detail
    } catch {
      // keep the generic message
    }
    throw new RoleApiError(resp.status, detail)
  }
  return (await resp.json()) as T
}

const q = (lat: number, lon: number) => `latitude=${lat}&longitude=${lon}`

export const getFarmAdvice = (lat: number, lon: number, signal?: AbortSignal) =>
  call<FarmAdvice>(`/api/farm?${q(lat, lon)}`, { signal })

export const getAviationBriefing = (lat: number, lon: number, signal?: AbortSignal) =>
  call<AviationBriefing>(`/api/aviation?${q(lat, lon)}`, { signal })

export const getModelComparison = (lat: number, lon: number, signal?: AbortSignal) =>
  call<ModelComparison>(`/api/compare?${q(lat, lon)}&hours=24`, { signal })

export const getRiskBoard = (districts: District[], signal?: AbortSignal) =>
  call<RiskBoard>('/api/risk', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ districts }),
    signal,
  })
