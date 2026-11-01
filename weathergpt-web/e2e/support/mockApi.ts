/**
 * Mock FastAPI backend, Nominatim, Supabase and map tiles for Playwright.
 *
 * Every number shown in the UI during a test comes from these fixtures, so the
 * tests check that values flow from the API to the screen unchanged.
 */

import type { Page, Route } from '@playwright/test'

export const PUNE = { name: 'Pune, Maharashtra, India', latitude: 18.5204, longitude: 73.8567 }

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
}

// 1x1 slate pixel, stretched by Leaflet to fill each tile.
const TILE = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGOQUzMBAADeAHlsAsY2AAAAAElFTkSuQmCC',
  'base64'
)

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    headers: { ...CORS, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function isoHour(base: Date, h: number) {
  return new Date(base.getTime() + h * 3600_000).toISOString().slice(0, 13) + ':00'
}

export function hourlyWeather(code = 61) {
  const start = new Date()
  start.setUTCMinutes(0, 0, 0)
  const idx = Array.from({ length: 168 }, (_, i) => i)
  return {
    source: 'open-meteo',
    latitude: PUNE.latitude,
    longitude: PUNE.longitude,
    timezone: 'Asia/Kolkata',
    retrieved_at: new Date().toISOString().slice(0, 19) + 'Z',
    current: {
      time: isoHour(start, 0),
      temperature_2m: 27.4,
      relative_humidity_2m: 78,
      precipitation: 1.2,
      wind_speed_10m: 14.2,
      wind_direction_10m: 250,
      weather_code: code,
    },
    hourly: {
      time: idx.map((i) => isoHour(start, i)),
      temperature_2m: idx.map((i) => Math.round((24 + 5 * Math.sin((i / 24) * 2 * Math.PI)) * 10) / 10),
      precipitation_probability: idx.map((i) => (i % 24 < 12 ? 70 : 20)),
      precipitation: idx.map((i) => (i % 24 < 12 ? 1.5 : 0)),
      wind_speed_10m: idx.map(() => 14),
      weather_code: idx.map((i) => (i % 24 < 12 ? code : 2)),
      relative_humidity_2m: idx.map(() => 75),
      wind_direction_10m: idx.map(() => 250),
    },
  }
}

export interface ChatOverrides {
  message?: string
  language?: 'en' | 'hi' | 'hinglish' | 'mr'
  severity?: 'low' | 'moderate' | 'high'
  intent?: Record<string, unknown>
  extra?: Record<string, unknown>
}

export function chatResponse(o: ChatOverrides = {}) {
  const high = o.severity === 'high'
  return {
    message:
      o.message ?? 'Tomorrow in Pune: 80% chance of rain, about 12.4 mm. Temperature 22.1–29.8 °C.',
    intent: {
      intent: 'forecast',
      location_name: 'Pune',
      date_reference: 'tomorrow',
      weather_parameter: 'precipitation',
      language: o.language ?? 'en',
      ...o.intent,
    },
    location: { ...PUNE, source: 'explicit_query' },
    weather: {
      source: 'open-meteo',
      location: PUNE.name,
      requested_time: '2026-11-02T00:00 to 2026-11-02T23:00',
      timezone: 'Asia/Kolkata',
      temperature_2m: null,
      temperature_min: 22.1,
      temperature_max: 29.8,
      precipitation: 12.4,
      precipitation_probability: 80,
      wind_speed_10m: 18.5,
      wind_direction_10m: 250,
      relative_humidity_2m: 82,
      weather_code: 63,
      weather_description: 'Rain',
      period_available: true,
    },
    advisory: {
      severity: o.severity ?? 'moderate',
      condition: high ? 'Heavy rainfall' : 'Rain likely',
      advisory: high ? 'Avoid travel through low-lying areas.' : 'Carry an umbrella.',
      reasons: ['There is a 80% chance of rain.'],
    },
    source: 'open-meteo',
    ...o.extra,
  }
}

function dailyForecast() {
  const daily = Array.from({ length: 7 }, (_, i) => ({
    date: new Date(Date.now() + i * 86400_000).toISOString().slice(0, 10),
    weather_code: i % 2 ? 2 : 61,
    max_temperature: 30 + i * 0.5,
    min_temperature: 21 + i * 0.3,
    precipitation_sum: i % 2 ? 0 : 6.5,
    precipitation_probability_max: i % 2 ? 15 : 70,
    max_wind_speed: 16,
  }))
  return {
    source: 'open-meteo',
    latitude: PUNE.latitude,
    longitude: PUNE.longitude,
    timezone: 'Asia/Kolkata',
    retrieved_at: new Date().toISOString(),
    daily,
  }
}

function alertsResponse() {
  return {
    latitude: PUNE.latitude,
    longitude: PUNE.longitude,
    timezone: 'Asia/Kolkata',
    retrieved_at: new Date().toISOString(),
    active_alerts_count: 1,
    alerts: [
      {
        id: 'rain-1',
        alert_type: 'rain',
        severity: 'watch',
        condition: 'Heavy rain',
        headline: 'Heavy rain expected',
        description: 'Up to 45 mm of rain in 24 hours.',
        recommended_action: 'Avoid waterlogged roads.',
        relevant_parameter: 'precipitation',
        relevant_value: 45,
        threshold_value: 35,
        unit: 'mm',
        time_window: 'next 24 h',
        source: 'open-meteo',
        created_at: new Date().toISOString(),
      },
    ],
  }
}

function climateResponse() {
  const daily = Array.from({ length: 30 }, (_, i) => ({
    date: new Date(Date.now() - (30 - i) * 86400_000).toISOString().slice(0, 10),
    temperature_max: Math.round((31 + Math.sin(i / 4) * 2) * 10) / 10,
    temperature_min: Math.round((21 + Math.cos(i / 5)) * 10) / 10,
    precipitation_sum: i % 5 === 0 ? 8 : 0,
  }))
  return {
    source: 'open-meteo-archive',
    latitude: PUNE.latitude,
    longitude: PUNE.longitude,
    timezone: 'Asia/Kolkata',
    generation_time: 1.2,
    daily,
  }
}

function nwpResponse() {
  return {
    metadata: {
      model: 'GFS',
      generationTime: '2026-11-01T00:00:00+00:00',
      latitude: PUNE.latitude,
      longitude: PUNE.longitude,
    },
    forecasts: Array.from({ length: 24 }, (_, h) => ({
      hour: h,
      temperatureC: 22 + h * 0.2,
      precipitationMm: h % 6 === 0 ? 0.4 : 0,
      windMs: 3.1,
    })),
  }
}

/** Returns a chat body, or { status, body } for an error response. */
export type ChatHandler = (body: Record<string, unknown>) => object

export interface MockOptions {
  chat?: ChatHandler
  weatherCode?: number
  /** Extra JSON routes by backend pathname, e.g. { '/api/aviation': {...} }. */
  routes?: Record<string, unknown>
  /** Fail backend paths with an HTTP status, e.g. { '/api/alerts': 503 }. */
  fail?: Record<string, number>
}

/** Requests the app sent to the mocked backend, for assertions. */
export interface MockLog {
  chat: Array<Record<string, unknown>>
  paths: string[]
}

export async function mockBackend(page: Page, opts: MockOptions = {}): Promise<MockLog> {
  const log: MockLog = { chat: [], paths: [] }

  await page.route('http://localhost:8000/**', async (route) => {
    const req = route.request()
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    const { pathname } = new URL(req.url())
    log.paths.push(pathname)
    if (opts.fail && pathname in opts.fail) {
      return json(route, { detail: 'Alerts are temporarily unavailable.' }, opts.fail[pathname])
    }
    if (opts.routes && pathname in opts.routes) return json(route, opts.routes[pathname])
    switch (pathname) {
      case '/api/chat': {
        const body = (req.postDataJSON() ?? {}) as Record<string, unknown>
        log.chat.push(body)
        const out = opts.chat ? opts.chat(body) : chatResponse()
        if ('status' in out && 'body' in out) {
          const err = out as { status: number; body: unknown }
          return json(route, err.body, err.status)
        }
        return json(route, out)
      }
      case '/api/weather':
        return json(route, hourlyWeather(opts.weatherCode))
      case '/api/forecast':
        return json(route, dailyForecast())
      case '/api/alerts':
        return json(route, alertsResponse())
      case '/api/climate':
        return json(route, climateResponse())
      case '/api/nwp':
        return json(route, nwpResponse())
      default:
        return json(route, { detail: `Not mocked: ${pathname}` }, 404)
    }
  })

  await page.route('https://nominatim.openstreetmap.org/**', (route) => {
    if (route.request().url().includes('/reverse')) {
      return json(route, {
        display_name: PUNE.name,
        address: { city: 'Pune', state: 'Maharashtra', country: 'India' },
      })
    }
    return json(route, [{ lat: String(PUNE.latitude), lon: String(PUNE.longitude), display_name: PUNE.name }])
  })

  // No Supabase session in tests; never reach the real project.
  await page.route(/supabase\.co/, (route) => json(route, {}))

  // Map tiles: a flat slate tile keeps screenshots deterministic and offline.
  await page.route(/basemaps\.cartocdn\.com|tile\.openstreetmap\.org/, (route) =>
    route.fulfill({ status: 200, headers: { 'content-type': 'image/png' }, body: TILE })
  )
  return log
}

/** Enter the in-memory demo session (no Supabase) and land on /dashboard. */
export async function enterDemo(page: Page) {
  await page.goto('/login')
  await page.getByRole('button', { name: /enter demo/i }).click()
  await page.waitForURL('**/dashboard')
}
