/** Typed client for GET /api/route (backend/api/route.py, docs/ROUTES.md). */

import { API_BASE } from '@/lib/api/base'
import type { HazardLevel, HazardTrigger } from '@/lib/api/map'
import { apiFetch } from '@/lib/replay'

export type RouteLevel = HazardLevel | 'unknown'
export type RouteHazard = 'rain' | 'heat' | 'wind' | 'storm' | 'cold'

export interface RouteSample {
  km: number
  latitude: number
  longitude: number
  eta: string
  level: RouteLevel
  levels: Record<RouteHazard, RouteLevel>
  facts: Record<string, number | null> | null
  triggers: HazardTrigger[]
  grid_latitude: number
  grid_longitude: number
}

export interface RouteSegment {
  from_km: number
  to_km: number
  level: RouteLevel
  path: Array<[number, number]>
}

export interface RouteFinding {
  hazard: RouteHazard
  level: HazardLevel
  rule_id: string
  label: string
  value: number
  threshold: number
  comparator: string
  unit: string
  from_km: number
  to_km: number
  km: number
  eta: string
  latitude: number
  longitude: number
  place: string | null
  road: string | null
}

export interface DepartureOption {
  depart: string
  worst: RouteLevel
  worst_km: number
  complete: boolean
}

export interface RouteSuggestion {
  depart: string
  worst: RouteLevel
  worst_km: number
  minutes_later: number
  avoids: RouteHazard[]
  lowers: RouteHazard[]
}

export interface RouteReport {
  origin: { latitude: number; longitude: number }
  destination: { latitude: number; longitude: number }
  distance_km: number
  duration_min: number
  depart: string
  arrive: string
  timezone: string | null
  worst: RouteLevel
  worst_km: number
  samples: RouteSample[]
  segments: RouteSegment[]
  findings: RouteFinding[]
  departures: DepartureOption[]
  suggestion: RouteSuggestion | null
  best_already: boolean
  beyond_forecast_km: number
  sample_km: number
  step_deg: number
  spacing_km: number
  model_grid_km: number
  routing: string
  routing_host: string
  routing_public_demo: boolean
  recorded_at: string | null
  note: string
}

/** status 0: backend unreachable; 422: no route / bad request; 503: routing or weather down */
export class RouteError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message)
  }
}

export interface RouteEnd {
  latitude: number
  longitude: number
}

export async function fetchRoute(from: RouteEnd, to: RouteEnd, depart: Date | null, signal?: AbortSignal): Promise<RouteReport> {
  const q = new URLSearchParams({
    from_lat: from.latitude.toFixed(5),
    from_lon: from.longitude.toFixed(5),
    to_lat: to.latitude.toFixed(5),
    to_lon: to.longitude.toFixed(5),
  })
  if (depart) q.set('depart', depart.toISOString())
  let resp: Response
  try {
    resp = await apiFetch(`${API_BASE}/api/route?${q}`, { signal })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err
    throw new RouteError(0, 'Could not reach the WeatherGPT backend.')
  }
  if (!resp.ok) {
    let detail = `Route error ${resp.status}`
    try {
      const body = (await resp.json()) as { detail?: unknown }
      if (typeof body.detail === 'string') detail = body.detail
    } catch {
      // keep the generic message
    }
    throw new RouteError(resp.status, detail)
  }
  return (await resp.json()) as RouteReport
}
