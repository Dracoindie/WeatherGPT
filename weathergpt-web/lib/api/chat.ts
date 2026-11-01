/**
 * Typed client for POST /api/chat.
 *
 * Fetch stays here — UI components must not call the backend directly.
 * Weather numbers are never invented here; they come from the API body.
 */

import { API_BASE } from '@/lib/api/base'
import type { UserRole } from '@/lib/role'

/** climate: past-years comparison (archive). nwp: raw GFS model output. */
export type ChatIntentType = 'current_weather' | 'forecast' | 'climate' | 'nwp' | 'unknown'
export type ClimatePeriod = 'last_30_days' | 'this_month' | 'this_year'
export type DateReference =
  | 'now'
  | 'today'
  | 'tomorrow'
  | 'day_after_tomorrow'
  | 'tonight'
  | 'this_afternoon'
  | 'monday'
  | 'tuesday'
  | 'wednesday'
  | 'thursday'
  | 'friday'
  | 'saturday'
  | 'sunday'
export type WeatherParameter =
  | 'temperature'
  | 'high_temperature'
  | 'precipitation'
  | 'heavy_rain'
  | 'rain_likelihood'
  | 'wind'
  | 'strong_wind'
  | 'storm'
  | 'humidity'
  | 'advisory'
  | 'general'
export type ResponseLanguage = 'en' | 'hi' | 'hinglish'
export type LocationSource =
  | 'explicit_query'
  | 'request_coordinates'
  | 'conversation_context'
  | 'trusted_user_default'

export interface ChatIntent {
  intent: ChatIntentType
  location_name: string | null
  date_reference: DateReference
  weather_parameter: WeatherParameter
  language: ResponseLanguage
  climate_period?: ClimatePeriod | null
}

export interface WeatherFacts {
  source: string
  location: string
  requested_time: string
  timezone: string
  temperature_2m: number | null
  temperature_min: number | null
  temperature_max: number | null
  precipitation: number | null
  precipitation_probability: number | null
  wind_speed_10m: number | null
  /** degrees the wind blows from, at the period's peak-wind hour */
  wind_direction_10m: number | null
  relative_humidity_2m: number | null
  weather_code: number | null
  weather_description: string | null
  period_available: boolean
}

/** Recent period vs the same dates in earlier years (Open-Meteo archive). */
export interface ClimateFacts {
  source: string
  location: string
  timezone: string
  period: ClimatePeriod
  period_start: string
  period_end: string
  baseline_start_year: number
  baseline_end_year: number
  baseline_years: number
  days_with_data: number
  mean_temperature_max: number | null
  mean_temperature_min: number | null
  total_precipitation: number | null
  baseline_mean_temperature_max: number | null
  baseline_mean_temperature_min: number | null
  baseline_total_precipitation: number | null
  temperature_max_anomaly: number | null
  temperature_min_anomaly: number | null
  precipitation_anomaly_percent: number | null
  available: boolean
}

/** GFS output summarised over the requested window. */
export interface NwpFacts {
  source: string
  model: string
  run: string
  location: string
  requested_time: string
  timezone: string
  hours: number
  temperature_min: number | null
  temperature_max: number | null
  precipitation: number | null
  /** km/h */
  wind_speed_max: number | null
  period_available: boolean
}

export interface ResolvedLocation {
  name: string
  latitude: number
  longitude: number
  source: LocationSource
}

export interface AdvisoryResult {
  severity: 'low' | 'moderate' | 'high'
  condition: string
  advisory: string
  reasons: string[]
}

/** Slots of the previous answer, so follow-ups ("aur parso?") can fill gaps. */
export interface ChatContext {
  intent?: ChatIntentType
  location_name?: string
  latitude?: number
  longitude?: number
  date_reference?: DateReference
  weather_parameter?: WeatherParameter
  climate_period?: ClimatePeriod | null
}

export interface ChatRequest {
  message: string
  latitude?: number
  longitude?: number
  context?: ChatContext
  /** what the reply emphasises; never changes the numbers */
  role?: UserRole
}

export interface ChatResponse {
  message: string
  intent: ChatIntent
  location: ResolvedLocation | null
  weather: WeatherFacts | null
  climate?: ClimateFacts | null
  nwp?: NwpFacts | null
  advisory: AdvisoryResult | null
  source: string
}

/** Follow-up context from an answered question (only answers with a location). */
export function contextFrom(res: ChatResponse | null | undefined): ChatContext | undefined {
  if (!res?.location) return undefined
  return {
    intent: res.intent.intent,
    location_name: res.location.name,
    latitude: res.location.latitude,
    longitude: res.location.longitude,
    date_reference: res.intent.date_reference,
    weather_parameter: res.intent.weather_parameter,
    climate_period: res.intent.climate_period ?? null,
  }
}


export class ChatApiError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ChatApiError'
    this.status = status
  }
}

function isChatResponse(value: unknown): value is ChatResponse {
  if (!value || typeof value !== 'object') return false
  const body = value as Record<string, unknown>
  return typeof body.message === 'string' && typeof body.source === 'string'
}

export async function postChat(
  body: ChatRequest,
  accessToken?: string | null
): Promise<ChatResponse> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`
  }

  let response: Response
  try {
    response = await fetch(`${API_BASE}/api/chat`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })
  } catch {
    throw new ChatApiError(0, 'Could not reach the chat API. Is the backend running?')
  }

  let parsed: unknown
  try {
    parsed = await response.json()
  } catch {
    throw new ChatApiError(
      response.status,
      'Chat API returned an unreadable response.'
    )
  }

  if (!response.ok) {
    const detail =
      parsed &&
      typeof parsed === 'object' &&
      typeof (parsed as { detail?: unknown }).detail === 'string'
        ? (parsed as { detail: string }).detail
        : `Chat API error: ${response.status}`
    throw new ChatApiError(response.status, detail)
  }

  if (!isChatResponse(parsed)) {
    throw new ChatApiError(response.status, 'Chat API returned an invalid response.')
  }

  return parsed
}
