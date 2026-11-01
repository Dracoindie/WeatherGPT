/**
 * Typed client for POST /api/chat.
 *
 * Fetch stays here — UI components must not call the backend directly.
 * Weather numbers are never invented here; they come from the API body.
 */

export type ChatIntentType = 'current_weather' | 'forecast' | 'unknown'
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
  | 'trusted_user_default'

export interface ChatIntent {
  intent: ChatIntentType
  location_name: string | null
  date_reference: DateReference
  weather_parameter: WeatherParameter
  language: ResponseLanguage
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

export interface ChatRequest {
  message: string
  latitude?: number
  longitude?: number
}

export interface ChatResponse {
  message: string
  intent: ChatIntent
  location: ResolvedLocation | null
  weather: WeatherFacts | null
  advisory: AdvisoryResult | null
  source: string
}

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, '') ?? 'http://localhost:8000'

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
