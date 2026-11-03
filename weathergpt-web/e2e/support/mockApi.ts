/**
 * Mock FastAPI backend, Nominatim, Supabase and map tiles for Playwright.
 *
 * Every number shown in the UI during a test comes from these fixtures, so the
 * tests check that values flow from the API to the screen unchanged.
 */

import type { BrowserContext, Page, Route } from '@playwright/test'
import { deflateSync } from 'node:zlib'
import THRESHOLDS from './thresholds.json'

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

/** A flat 256x256 terrarium DEM tile (every pixel R=128,G=0,B=0 -> 0 m), so 3D terrain loads offline. */
function flatTerrainPng(): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c >>> 0
  })
  const crc = (buf: Buffer) => {
    let c = 0xffffffff
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const c = Buffer.alloc(4)
    c.writeUInt32BE(crc(td))
    return Buffer.concat([len, td, c])
  }
  const size = 256
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // RGB
  const row = Buffer.alloc(1 + size * 3)
  for (let x = 0; x < size; x++) row[1 + x * 3] = 128
  const raw = Buffer.concat(Array.from({ length: size }, () => row))
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}
const TERRAIN_TILE = flatTerrainPng()

/** Stand-in for the OpenFreeMap dark style: background and nothing else, no network. */
const MAP_STYLE = {
  version: 8,
  name: 'test',
  sources: {},
  layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#111827' } }],
}

/** GET /api/map/point for any tap. Heat index 34.4 = maps/heat_index.py for 31.4 °C / 55 %. */
export const MAP_POINT = {
  source: 'open-meteo',
  latitude: PUNE.latitude,
  longitude: PUNE.longitude,
  model_latitude: 18.523726,
  model_longitude: 73.86876,
  model_grid_km: 8,
  timezone: 'Asia/Kolkata',
  local_time: '2026-11-03T14:45',
  observed_at: '2026-11-03T14:45',
  temperature_c: 31.4,
  feels_like_c: 33.9,
  humidity_pct: 55,
  wind_speed_kmh: 14.2,
  wind_direction_deg: 250,
  precipitation_probability_pct: 40,
  precipitation_mm: 0.2,
  weather_code: 2,
  uv_index: 7.1,
  uv_category: 'high',
  aqi: 81,
  aqi_category: 'satisfactory',
  heat_index_c: 34.4,
  heat_band: 'extreme_caution',
  note: 'Model values for the grid cell, estimated; not official IMD data.',
}

/** GET /api/map/grid: 6 rows over the requested box (columns to cover its width), 72 UTC hours. */
export function mapGrid(q: URLSearchParams) {
  const rows = 6
  const south = Number(q.get('south') ?? 18.2)
  const west = Number(q.get('west') ?? 73.5)
  const north = Number(q.get('north') ?? south + 1)
  const east = Number(q.get('east') ?? west + 1)
  const step = Math.round(Math.max(0.08, (north - south) / (rows - 1)) * 1000) / 1000
  // like the backend, the grid covers the whole box: more columns when it is wide
  const cols = Math.max(2, Math.min(12, Math.ceil((east - west) / step) + 1))
  const start = new Date()
  start.setUTCMinutes(0, 0, 0)
  const times = Array.from({ length: 72 }, (_, h) => new Date(start.getTime() + h * 3600_000).toISOString().slice(0, 16) + 'Z')
  const points = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c
      const series = (f: (h: number) => number) => times.map((_, h) => Math.round(f(h) * 10) / 10)
      points.push({
        latitude: Math.round((south + r * step) * 1e4) / 1e4,
        longitude: Math.round((west + c * step) * 1e4) / 1e4,
        elevation: 550 + i,
        temperature_2m: series((h) => 24 + r * 0.8 + c * 0.4 + 4 * Math.sin((h / 24) * 2 * Math.PI)),
        relative_humidity_2m: series(() => 50 + (c % 6) * 6), // 50 % to 80 %
        apparent_temperature: series((h) => 25 + r * 0.8 + 4 * Math.sin((h / 24) * 2 * Math.PI)),
        precipitation: series((h) => (c >= 3 && h % 12 < 6 ? (c - 2) * 1.5 : 0)),
        precipitation_probability: series(() => (c >= 3 ? 70 : 10)),
        wind_speed_10m: series(() => 10 + r * 2),
        wind_direction_10m: series(() => 250),
        heat_index: series((h) => 26 + r * 2 + c + 3 * Math.sin((h / 24) * 2 * Math.PI)),
      })
    }
  }
  return {
    source: 'open-meteo',
    retrieved_at: new Date().toISOString(),
    south,
    west,
    north: south + (rows - 1) * step,
    east: west + (cols - 1) * step,
    step_deg: step,
    spacing_km: Math.round(step * 111.32 * 10) / 10,
    model_grid_km: 8,
    rows,
    cols,
    times,
    points,
    heat_index_bands: [
      { id: 'caution', label: 'Caution', min_c: 26.7 },
      { id: 'extreme_caution', label: 'Extreme caution', min_c: 32.2 },
      { id: 'danger', label: 'Danger', min_c: 39.4 },
      { id: 'extreme_danger', label: 'Extreme danger', min_c: 51.7 },
    ],
    note: 'Open-Meteo model values at grid points; the map interpolates between them. Estimated, not official IMD data.',
  }
}

// Set per mockBackend() call: the demo replay header (DEMO_REPLAY=1 backend).
let replayHeaders: Record<string, string> = {}

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    headers: { ...CORS, ...replayHeaders, 'content-type': 'application/json' },
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

export const CLIMATE_FACTS = {
  source: 'open-meteo-archive',
  location: PUNE.name,
  timezone: 'Asia/Kolkata',
  period: 'this_year',
  period_start: '2026-01-01',
  period_end: '2026-10-26',
  baseline_start_year: 2016,
  baseline_end_year: 2025,
  baseline_years: 10,
  days_with_data: 299,
  mean_temperature_max: 32.1,
  mean_temperature_min: 21.4,
  total_precipitation: 812.5,
  baseline_mean_temperature_max: 31.2,
  baseline_mean_temperature_min: 20.9,
  baseline_total_precipitation: 701.3,
  temperature_max_anomaly: 0.9,
  temperature_min_anomaly: 0.5,
  precipitation_anomaly_percent: 16,
  available: true,
}

export const GFS_FACTS = {
  source: 'gfs-nomads',
  model: 'GFS',
  run: '2026-11-01T06:00:00+00:00',
  location: PUNE.name,
  requested_time: 'tomorrow (2026-11-02T00:30 to 2026-11-02T23:30)',
  timezone: 'Asia/Kolkata',
  hours: 24,
  temperature_min: 21.6,
  temperature_max: 28.1,
  precipitation: 13.2,
  wind_speed_max: 11.8,
  period_available: true,
}

export const AIR_QUALITY = {
  timezone: 'Asia/Kolkata',
  last_24h: { window: '2026-11-01T00:00 to 2026-11-01T23:00', hours: 24, pm2_5: 48.2, pm10: 92.6, aqi: 81, aqi_category: 'satisfactory', aqi_dominant: 'pm2_5', note: 'Indian AQI computed by WeatherGPT (CPCB method) from modelled PM data; not a CPCB station reading.' },
  next_24h: { window: '2026-11-02T00:00 to 2026-11-02T23:00', hours: 24, pm2_5: 70.4, pm10: 120.1, aqi: 135, aqi_category: 'moderate', aqi_dominant: 'pm2_5', note: '' },
  uv_index: 7.4,
  uv_max_today: 8.6,
  uv_category: 'high',
  uv_max_category: 'very_high',
  note: 'AQI computed by WeatherGPT with the CPCB method from Open-Meteo (CAMS) modelled PM2.5/PM10; not a CPCB monitoring-station reading.',
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
        threshold_value: 15, // HEAVY_RAIN in backend/thresholds.py
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
  /** Answer like a DEMO_REPLAY=1 backend: every JSON response carries this recorded_at. */
  replayAt?: string
  /** Extra JSON routes by backend pathname, e.g. { '/api/aviation': {...} }. */
  routes?: Record<string, unknown>
  /** Fail backend paths with an HTTP status, e.g. { '/api/alerts': 503 }. */
  fail?: Record<string, number>
  /** /api/geocode: delay (ms) or HTTP status per district name (first part of q). */
  geocodeDelay?: Record<string, number>
  geocodeStatus?: Record<string, number>
}

interface BoardRow { name: string; latitude: number; longitude: number; [k: string]: unknown }

/** Deterministic fake coordinates inside Maharashtra for any place name. */
function fakeCoords(name: string) {
  let h = 0
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return { latitude: 16 + (h % 500) / 100, longitude: 73 + ((h >> 9) % 600) / 100 }
}

/** Requests the app sent to the mocked backend, for assertions. */
export interface MockLog {
  chat: Array<Record<string, unknown>>
  paths: string[]
}

/** Pass the BrowserContext instead of a Page when a service worker is active:
 * context routes also see requests the worker makes. */
export async function mockBackend(page: Page | BrowserContext, opts: MockOptions = {}): Promise<MockLog> {
  const log: MockLog = { chat: [], paths: [] }
  replayHeaders = opts.replayAt
    ? { 'x-weathergpt-replay': opts.replayAt, 'access-control-expose-headers': 'X-WeatherGPT-Replay' }
    : {}

  await page.route('http://localhost:8000/**', async (route) => {
    const req = route.request()
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    const { pathname } = new URL(req.url())
    log.paths.push(pathname)
    if (opts.fail && pathname in opts.fail) {
      return json(route, { detail: 'Alerts are temporarily unavailable.' }, opts.fail[pathname])
    }
    if (pathname === '/api/geocode') {
      const q = new URL(req.url()).searchParams.get('q') ?? ''
      const name = q.split(',')[0].trim()
      const delay = opts.geocodeDelay?.[name]
      if (delay) await new Promise((r) => setTimeout(r, delay))
      const status = opts.geocodeStatus?.[name]
      if (status) return json(route, { detail: 'mocked failure' }, status)
      const board = opts.routes?.['/api/risk'] as { districts?: BoardRow[] } | undefined
      const known = board?.districts?.find((d) => d.name.startsWith(name) || d.name.includes(`(${name})`))
      const at = known ? { latitude: known.latitude, longitude: known.longitude } : fakeCoords(name)
      return json(route, { query: q, name: `${name}, Maharashtra, India`, ...at })
    }
    if (pathname === '/api/risk' && opts.routes?.['/api/risk']) {
      // Answer per requested district: the fixture row by name, else a calm row.
      const board = opts.routes['/api/risk'] as { districts: BoardRow[]; [k: string]: unknown }
      const asked = ((req.postDataJSON() ?? {}) as { districts?: BoardRow[] }).districts ?? []
      const districts = asked.map(
        (d) =>
          board.districts.find((b) => b.name === d.name) ?? {
            ...d, severity: 'none', alerts_count: 0, headline: null,
            rain_24h_mm: 0, max_wind_24h_kmh: 10, max_temperature_24h_c: 30, error: null,
          }
      )
      return json(route, { ...board, districts })
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
      case '/api/alerts/thresholds':
        // generated from backend/thresholds.py; tests/test_thresholds.py checks it
        return json(route, { rules: THRESHOLDS, note: 'Generated by WeatherGPT, not official IMD warnings.' })
      case '/api/climate':
        return json(route, climateResponse())
      case '/api/nwp':
        return json(route, nwpResponse())
      case '/api/air-quality':
        return json(route, AIR_QUALITY)
      case '/api/map/point':
        return json(route, MAP_POINT)
      case '/api/map/grid':
        return json(route, mapGrid(new URL(req.url()).searchParams))
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
  // /map: OpenFreeMap style (no tiles needed) and flat AWS terrain tiles.
  await page.route(/tiles\.openfreemap\.org/, (route) =>
    route.request().url().includes('/styles/')
      ? json(route, MAP_STYLE)
      : route.fulfill({ status: 404, headers: CORS, body: '' })
  )
  await page.route(/elevation-tiles-prod/, (route) =>
    route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'image/png' }, body: TERRAIN_TILE })
  )
  return log
}

/** Enter the in-memory demo session (no Supabase) and land on /dashboard. */
export async function enterDemo(page: Page) {
  await page.goto('/login')
  await page.getByRole('button', { name: /enter demo/i }).click()
  await page.waitForURL('**/dashboard')
}
