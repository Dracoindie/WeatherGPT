/** Typed client for GET /api/air-quality (backend/api/air.py). */

import { API_BASE } from '@/lib/api/base'

export interface AirQualitySummary {
  window: string
  hours: number
  pm2_5: number | null
  pm10: number | null
  aqi: number | null
  aqi_category: AqiCategory | null
  aqi_dominant: 'pm2_5' | 'pm10' | null
  note: string
}

export type AqiCategory = 'good' | 'satisfactory' | 'moderate' | 'poor' | 'very_poor' | 'severe'
export type UvCategory = 'low' | 'moderate' | 'high' | 'very_high' | 'extreme'

export interface AirQualityReport {
  timezone: string
  last_24h: AirQualitySummary | null
  next_24h: AirQualitySummary | null
  uv_index: number | null
  uv_max_today: number | null
  uv_category: UvCategory | null
  uv_max_category: UvCategory | null
  note: string
}

export async function getAirQuality(latitude: number, longitude: number, signal?: AbortSignal): Promise<AirQualityReport> {
  let resp: Response
  try {
    resp = await fetch(`${API_BASE}/api/air-quality?latitude=${latitude}&longitude=${longitude}`, { signal })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err
    throw new Error('Could not reach the WeatherGPT backend.')
  }
  if (!resp.ok) throw new Error(resp.status === 503 ? 'Air quality data is temporarily unavailable.' : `Air quality error ${resp.status}`)
  return (await resp.json()) as AirQualityReport
}
