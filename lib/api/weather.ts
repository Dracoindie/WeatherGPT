/**
 * Typed client for GET /api/weather (mirrors backend/models/weather.py).
 *
 * Weather numbers are never invented here; they come from the API body.
 */

export interface CurrentWeather {
  time: string
  temperature_2m: number
  relative_humidity_2m: number
  precipitation: number
  wind_speed_10m: number
  /** degrees the wind blows from (0 = north, 90 = east) */
  wind_direction_10m: number
  weather_code: number
}

export interface HourlyWeather {
  time: string[]
  temperature_2m: number[]
  precipitation_probability: (number | null)[]
  precipitation: number[]
  wind_speed_10m: number[]
  weather_code: (number | null)[]
  relative_humidity_2m: (number | null)[]
  wind_direction_10m: (number | null)[]
}

export interface WeatherResponse {
  source: string
  latitude: number
  longitude: number
  timezone: string
  retrieved_at: string
  current: CurrentWeather
  hourly: HourlyWeather
}

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, '') ?? 'http://localhost:8000'

export class WeatherApiError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'WeatherApiError'
    this.status = status
  }
}

function isWeatherResponse(value: unknown): value is WeatherResponse {
  if (!value || typeof value !== 'object') return false
  const body = value as Record<string, unknown>
  const hourly = body.hourly as Record<string, unknown> | undefined
  return (
    typeof body.timezone === 'string' &&
    typeof body.current === 'object' &&
    body.current !== null &&
    !!hourly &&
    Array.isArray(hourly.time) &&
    Array.isArray(hourly.temperature_2m)
  )
}

export async function getWeather(
  latitude: number,
  longitude: number,
  signal?: AbortSignal
): Promise<WeatherResponse> {
  const url = new URL(`${API_BASE}/api/weather`)
  url.searchParams.set('latitude', String(latitude))
  url.searchParams.set('longitude', String(longitude))

  let response: Response
  try {
    response = await fetch(url.toString(), { signal })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err
    throw new WeatherApiError(0, 'Could not reach the weather API. Is the backend running?')
  }

  let parsed: unknown
  try {
    parsed = await response.json()
  } catch {
    throw new WeatherApiError(response.status, 'Weather API returned an unreadable response.')
  }

  if (!response.ok) {
    const detail =
      parsed &&
      typeof parsed === 'object' &&
      typeof (parsed as { detail?: unknown }).detail === 'string'
        ? (parsed as { detail: string }).detail
        : `Weather API error: ${response.status}`
    throw new WeatherApiError(response.status, detail)
  }

  if (!isWeatherResponse(parsed)) {
    throw new WeatherApiError(response.status, 'Weather API returned an invalid response.')
  }
  return parsed
}
