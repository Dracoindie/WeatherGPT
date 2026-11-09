/**
 * Mock FastAPI backend, Nominatim, Supabase and map tiles for Playwright.
 *
 * Every number shown in the UI during a test comes from these fixtures, so the
 * tests check that values flow from the API to the screen unchanged.
 */

import type { BrowserContext, Page, Route } from '@playwright/test'
import { deflateSync } from 'node:zlib'
import { cellToLatLng, latLngToCell, polygonToCells } from 'h3-js'
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

/**
 * Stand-in for the OpenFreeMap dark style, no network: a background and a
 * small GeoJSON road network ("roads" source with an OpenMapTiles-style
 * "class"), so the hazard road layer has real lines to colour.
 */
export const ROADS = {
  type: 'FeatureCollection',
  features: [
    // east-west motorway through Pune
    { type: 'Feature', properties: { class: 'motorway' }, geometry: { type: 'LineString', coordinates: [[72.9, 18.52], [73.5, 18.55], [73.86, 18.52], [74.3, 18.5], [74.9, 18.45]] } },
    // north-south trunk road
    { type: 'Feature', properties: { class: 'trunk' }, geometry: { type: 'LineString', coordinates: [[73.86, 17.9], [73.9, 18.52], [73.95, 19.2]] } },
    // a minor road: never coloured
    { type: 'Feature', properties: { class: 'minor' }, geometry: { type: 'LineString', coordinates: [[73.6, 18.3], [74.1, 18.8]] } },
  ],
}

const MAP_STYLE = {
  version: 8,
  name: 'test',
  sources: {
    // the credit real basemap styles carry (OpenFreeMap: OpenMapTiles, OpenStreetMap)
    roads: { type: 'geojson', data: ROADS, attribution: '<a href="https://www.openstreetmap.org/copyright" target="_blank">© OpenStreetMap contributors</a>' },
    // a point of interest whose icon the style has no sprite for, like OpenFreeMap dark's "circle-11"
    poi: { type: 'geojson', data: { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [73.86, 18.53] } }] } },
  },
  layers: [
    { id: 'background', type: 'background', paint: { 'background-color': '#111827' } },
    { id: 'roads-base', type: 'line', source: 'roads', paint: { 'line-color': '#334155', 'line-width': 1 } },
    { id: 'poi', type: 'symbol', source: 'poi', layout: { 'icon-image': 'circle-11' } },
  ],
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
  const boxSouth = Number(q.get('south') ?? 18.2)
  const boxWest = Number(q.get('west') ?? 73.5)
  const boxNorth = Number(q.get('north') ?? boxSouth + 1)
  const boxEast = Number(q.get('east') ?? boxWest + 1)
  const step = Math.round(Math.max(0.08, (boxNorth - boxSouth) / 5) * 1000) / 1000
  // like the backend's tile-aligned grid, it covers the whole box and a step beyond each edge
  const south = Math.round((boxSouth - step) * 1e4) / 1e4
  const west = Math.round((boxWest - step) * 1e4) / 1e4
  const rows = 8
  const cols = Math.max(4, Math.min(14, Math.ceil((boxEast - boxWest) / step) + 3))
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

// ---------------------------------------------------------------------------
// Hazard map fixtures (/api/map/hazard and /summary). Thresholds come from
// thresholds.json, the copy of backend/thresholds.py.
// ---------------------------------------------------------------------------

type Rule = (typeof THRESHOLDS)[number]
const RULE = (id: string): Rule => THRESHOLDS.find((r) => r.id === id) as Rule

function trigger(id: string, value: number) {
  const r = RULE(id)
  return { hazard: r.hazard, level: r.level, rule_id: r.id, label: r.label, value, threshold: r.value, comparator: r.comparator, unit: r.unit, window: r.window }
}

const CALM_FACTS = { rain_mm: 0, temp_max: 30.2, temp_min: 21.4, wind_max: 14, heat_index_max: 31.5, weather_code: 2 }
const NONE_LEVELS = { rain: 'none', heat: 'none', wind: 'none', storm: 'none', cold: 'none' }

/** Sample points: [0] calm, [1] the place (45 mm, same as the /api/alerts mock: rain watch),
 * [2] 72 mm rain warning, [3] 95 km/h storm-force wind (severe), [4] 36 °C high heat (advisory). */
export const HAZARD_POINTS = [
  { latitude: 18.4, longitude: 73.6, overall: 'none', levels: NONE_LEVELS, facts: CALM_FACTS, triggers: [] },
  { latitude: 18.5, longitude: 73.85, overall: 'watch', levels: { ...NONE_LEVELS, rain: 'watch' }, facts: { ...CALM_FACTS, rain_mm: 45 }, triggers: [trigger('heavy_rain', 45)] },
  { latitude: 18.5, longitude: 74.4, overall: 'warning', levels: { ...NONE_LEVELS, rain: 'warning' }, facts: { ...CALM_FACTS, rain_mm: 72 }, triggers: [trigger('extreme_rain', 72)] },
  { latitude: 18.5, longitude: 73.1, overall: 'severe', levels: { ...NONE_LEVELS, wind: 'severe' }, facts: { ...CALM_FACTS, wind_max: 95 }, triggers: [trigger('storm_force_wind', 95)] },
  { latitude: 19.0, longitude: 73.85, overall: 'advisory', levels: { ...NONE_LEVELS, heat: 'advisory' }, facts: { ...CALM_FACTS, temp_max: 36 }, triggers: [trigger('high_heat', 36)] },
]

function hazardTimes() {
  const start = new Date()
  start.setUTCMinutes(0, 0, 0)
  return Array.from({ length: 72 }, (_, h) => new Date(start.getTime() + h * 3600_000).toISOString().slice(0, 16) + 'Z')
}

export function mapHazard(q: URLSearchParams) {
  const south = Number(q.get('south'))
  const west = Number(q.get('west'))
  const north = Number(q.get('north'))
  const east = Number(q.get('east'))
  const hour = Math.min(48, Number(q.get('hour') ?? 0))
  const res = 5
  const place = latLngToCell(PUNE.latitude, PUNE.longitude, res)
  const cells = polygonToCells([[south, west], [north, west], [north, east], [south, east]], res).sort()
  const out: Array<[string, number]> = cells.map((cell) => {
    if (cell === place) return [cell, 1]
    const [lat, lon] = cellCentre(cell)
    if (lon > PUNE.longitude + 0.35) return [cell, 2]
    if (lon < PUNE.longitude - 0.6) return [cell, 3]
    if (lat > PUNE.latitude + 0.35) return [cell, 4]
    return [cell, 0]
  })
  const counts: Record<string, number> = { none: 0, advisory: 0, watch: 0, warning: 0, severe: 0 }
  for (const [, i] of out) counts[HAZARD_POINTS[i].overall] += 1
  const worstCell = out.find(([, i]) => i === 3)
  const times = hazardTimes()
  return {
    source: 'open-meteo',
    retrieved_at: new Date().toISOString(),
    hour,
    max_hour: 48,
    window_start: times[hour],
    window_end: times[hour + 23],
    window_hours: 24,
    times,
    h3_resolution: res,
    hex_km: 17.1,
    step_deg: 0.1,
    spacing_km: 11.1,
    model_grid_km: 8,
    levels: ['none', 'advisory', 'watch', 'warning', 'severe'],
    points: HAZARD_POINTS,
    cells: out,
    counts,
    worst: worstCell ? { cell: worstCell[0], latitude: cellCentre(worstCell[0])[0], longitude: cellCentre(worstCell[0])[1], level: 'severe', point: 3 } : null,
    rules: THRESHOLDS,
    note: 'Estimated from Open-Meteo model data (model grid ≈ 8 km) with WeatherGPT\'s thresholds; not official IMD warnings.',
  }
}

/** Around the place: 3 warning and 7 watch cells now, 72 mm at most, worst (warning) in 4 h. */
export function mapHazardSummary(q: URLSearchParams) {
  const hour = Number(q.get('hour') ?? 0)
  const times = hazardTimes()
  return {
    latitude: Number(q.get('latitude')),
    longitude: Number(q.get('longitude')),
    radius_km: 25,
    hour,
    window_start: times[hour],
    window_end: times[hour + 23],
    h3_resolution: 6,
    cells: 40,
    counts: { none: 30, advisory: 0, watch: 7, warning: 3, severe: 0 },
    max_rain_mm: 72,
    max_rain_at: { cell: 'x', latitude: 18.55, longitude: 74.05, level: 'warning', point: 2 },
    worst_now: { cell: 'x', latitude: 18.55, longitude: 74.05, level: 'warning', point: 2 },
    worst_ahead: { cell: 'x', latitude: 18.6, longitude: 74.1, level: 'warning', point: 2 },
    worst_ahead_hour: 4,
    worst_ahead_time: times[4],
    nearest_sample_km: 3.2,
    model_grid_km: 8,
    note: 'Estimated from Open-Meteo model data (model grid ≈ 8 km) with WeatherGPT\'s thresholds; not official IMD warnings.',
  }
}

function cellCentre(cell: string): [number, number] {
  return cellToLatLng(cell) as [number, number]
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

export function nwpResponse() {
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

/**
 * GET /api/route: a straight line between the requested points, 120 km in
 * 120 min, a sample every 5 km. Leaving "now" (no depart): heavy rain (watch)
 * at km 60-70 near Kasara, and the suggestion "leave 15 min later" avoids it.
 * Any explicit departure: dry all the way, already the lowest hazard.
 */
export function mapRoute(q: URLSearchParams) {
  const a = { latitude: Number(q.get('from_lat')), longitude: Number(q.get('from_lon')) }
  const b = { latitude: Number(q.get('to_lat')), longitude: Number(q.get('to_lon')) }
  const now = new Date()
  now.setSeconds(0, 0)
  const departParam = q.get('depart')
  const depart = departParam ? new Date(departParam) : now
  depart.setSeconds(0, 0)
  const wet = !departParam
  const total = 120
  const at = (km: number): [number, number] => {
    const f = km / total
    return [a.longitude + f * (b.longitude - a.longitude), a.latitude + f * (b.latitude - a.latitude)]
  }
  const iso = (d: Date) => d.toISOString().slice(0, 19) + 'Z'
  const eta = (km: number) => iso(new Date(depart.getTime() + km * 60_000))
  const levelAt = (km: number) => (wet && km >= 60 && km <= 70 ? 'watch' : 'none')
  const samples = Array.from({ length: total / 5 + 1 }, (_, i) => {
    const km = i * 5
    const [lon, lat] = at(km)
    const level = levelAt(km)
    return {
      km, latitude: lat, longitude: lon, eta: eta(km), level,
      levels: { rain: level, heat: 'none', wind: 'none', storm: 'none', cold: 'none' },
      facts: { rain_mm: level === 'watch' ? 8 : 0, temp_max: 27, temp_min: 27, wind_max: 12, heat_index_max: 28, weather_code: level === 'watch' ? 65 : 3 },
      triggers: level === 'watch' ? [{ hazard: 'rain', level: 'watch', rule_id: 'heavy_rain_hour', label: 'Heavy rain', value: 65, threshold: 65, comparator: 'in', unit: 'WMO code', window: 'that hour' }] : [],
      grid_latitude: Number(lat.toFixed(2)), grid_longitude: Number(lon.toFixed(2)),
    }
  })
  const seg = (from: number, to: number, level: string) => ({ from_km: from, to_km: to, level, path: [at(from), at((from + to) / 2), at(to)] })
  const segments = wet ? [seg(0, 57.5, 'none'), seg(57.5, 72.5, 'watch'), seg(72.5, total, 'none')] : [seg(0, total, 'none')]
  const departures = Array.from({ length: 49 }, (_, k) => ({
    depart: iso(new Date(depart.getTime() + k * 15 * 60_000)),
    worst: wet && k === 0 ? 'watch' : 'none',
    worst_km: wet && k === 0 ? 15 : total,
    complete: true,
  }))
  const [flon, flat] = at(65)
  return {
    origin: a, destination: b, distance_km: total, duration_min: total,
    depart: iso(depart), arrive: eta(total), timezone: 'Asia/Kolkata',
    worst: wet ? 'watch' : 'none', worst_km: wet ? 15 : total,
    samples, segments,
    findings: wet
      ? [{ hazard: 'rain', level: 'watch', rule_id: 'heavy_rain_hour', label: 'Heavy rain', value: 65, threshold: 65, comparator: 'in', unit: 'WMO code', from_km: 60, to_km: 70, km: 65, eta: eta(65), latitude: flat, longitude: flon, place: 'Kasara', road: 'NH160' }]
      : [],
    departures,
    current_rank_key: wet ? [2, 15, 30] : [0, total, 0],
    suggestion: wet ? { depart: departures[1].depart, worst: 'none', worst_km: total, minutes_later: 15, avoids: ['rain'], lowers: [] } : null,
    best_already: !wet,
    beyond_forecast_km: 0,
    sample_km: 5, step_deg: 0.08, spacing_km: 8.9, model_grid_km: 8,
    routing: 'OSRM', routing_host: 'router.project-osrm.org', routing_public_demo: true,
    rules: [], retrieved_at: new Date().toISOString(), recorded_at: null,
    note: 'Estimated from Open-Meteo model data (model grid ≈ 8 km) for the hour you are expected to pass each point, using OSRM travel times. Lower estimated weather hazard does not mean safe. Not official IMD warnings.',
  }
}


/**
 * Community reports near Pune (backend/api/reports.py shapes). Times are
 * relative to now, rounded down to 10 minutes like the API.
 */
export function reportsFixture() {
  const ago = (min: number) => {
    const d = new Date(Date.now() - min * 60_000)
    d.setUTCMinutes(d.getUTCMinutes() - (d.getUTCMinutes() % 10), 0, 0)
    return d.toISOString().replace('.000Z', 'Z')
  }
  const until = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString().replace(/\.\d+Z$/, 'Z')
  const base = { note: null, has_photo: false, flags: 0, my_vote: null, mine: false, reporter: 'a resident' }
  return [
    {
      ...base, id: 'rep-water', kind: 'waterlogging', latitude: 18.5204, longitude: 73.8567, has_photo: true,
      note: 'Knee-deep water under the bridge', reported_at: ago(40), expires_at: until(5), confirms: 2,
      trust: { level: 'high', score: 0.79, parts: { model: 1, nearby: 0.667, age: 0.889, reporter: 0.5, flags: 0 } },
    },
    {
      ...base, id: 'rep-tree', kind: 'fallen_tree', latitude: 18.6000, longitude: 73.9500, reported_at: ago(90),
      expires_at: until(4), confirms: 0,
      trust: { level: 'medium', score: 0.46, parts: { model: 0.35, nearby: 0, age: 0.75, reporter: 0.6, flags: 0 } },
    },
    {
      ...base, id: 'rep-hail', kind: 'hail', latitude: 18.4400, longitude: 73.7600, reported_at: ago(150),
      expires_at: until(3), confirms: 0, flags: 1,
      trust: { level: 'low', score: 0.21, parts: { model: 0.2, nearby: 0, age: 0.583, reporter: 0.5, flags: 1 } },
    },
  ]
}
type MockReport = ReturnType<typeof reportsFixture>[number] & Record<string, unknown>

/** The fields of a multipart body the report form sends (no real parser needed for the mock). */
function multipartField(body: string, name: string): string | null {
  const m = body.match(new RegExp(`name="${name}"(?:; filename="[^"]*")?\\r\\nContent-Type: [^\\r]*\\r\\n\\r\\n|name="${name}"\\r\\n\\r\\n`))
  if (!m) return null
  const start = (m.index ?? 0) + m[0].length
  const end = body.indexOf('\r\n--', start)
  return body.slice(start, end < 0 ? undefined : end)
}

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
  /** Community reports the backend lists (default reportsFixture()); [] for none. */
  reports?: MockReport[]
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
  /** POST /api/reports: what the form sent */
  reportPosts: Array<{ kind: string | null; latitude: string | null; longitude: string | null; note: string | null; photoType: string | null; auth: string | null }>
  /** POST /api/reports/{id}/vote */
  votes: Array<{ id: string; vote: string; auth: string | null }>
}

/** Pass the BrowserContext instead of a Page when a service worker is active:
 * context routes also see requests the worker makes. */
export async function mockBackend(page: Page | BrowserContext, opts: MockOptions = {}): Promise<MockLog> {
  const log: MockLog = { chat: [], paths: [], reportPosts: [], votes: [] }
  const reports: MockReport[] = (opts.reports ?? reportsFixture()).map((r) => ({ ...r }))
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
    if (pathname === '/api/reports' && req.method() === 'GET') {
      const signedIn = !!req.headers()['authorization']
      return json(route, {
        reports: reports.map((r) => (signedIn ? r : { ...r, my_vote: null, mine: false })),
        label: 'Community report, unverified. Not an official warning; it never changes forecasts or alert levels.',
        hide_after_flags: 3,
      })
    }
    if (pathname === '/api/reports' && req.method() === 'POST') {
      const auth = req.headers()['authorization'] ?? null
      const body = req.postDataBuffer()?.toString('latin1') ?? ''
      const photo = body.match(/name="photo"; filename="[^"]*"\r\nContent-Type: ([^\r]*)/)
      const entry = {
        kind: multipartField(body, 'kind'),
        latitude: multipartField(body, 'latitude'),
        longitude: multipartField(body, 'longitude'),
        note: multipartField(body, 'note'),
        photoType: photo ? photo[1] : null,
        auth,
      }
      log.reportPosts.push(entry)
      if (!auth) return json(route, { code: 'sign_in', detail: 'Sign in to report.' }, 401)
      const now = new Date()
      now.setUTCMinutes(now.getUTCMinutes() - (now.getUTCMinutes() % 10), 0, 0)
      const created = {
        id: `rep-new-${log.reportPosts.length}`, kind: entry.kind ?? 'heavy_rain',
        latitude: Number(entry.latitude), longitude: Number(entry.longitude), note: entry.note, has_photo: !!photo,
        reported_at: now.toISOString().replace('.000Z', 'Z'), expires_at: new Date(Date.now() + 6 * 3_600_000).toISOString(),
        confirms: 0, flags: 0, my_vote: null, mine: true, reporter: 'a resident',
        trust: { level: 'medium', score: 0.6, parts: { model: 0.7, nearby: 0, age: 1, reporter: 0.5, flags: 0 } },
      } as MockReport
      reports.unshift(created)
      return json(route, created, 201)
    }
    const voteMatch = pathname.match(/^\/api\/reports\/([^/]+)\/vote$/)
    if (voteMatch) {
      const auth = req.headers()['authorization'] ?? null
      const vote = ((req.postDataJSON() ?? {}) as { vote?: string }).vote ?? ''
      log.votes.push({ id: voteMatch[1], vote, auth })
      const r = reports.find((x) => x.id === voteMatch[1])
      if (!auth) return json(route, { code: 'sign_in', detail: 'Sign in.' }, 401)
      if (!r) return json(route, { code: 'gone', detail: 'Gone.' }, 404)
      if (r.mine) return json(route, { code: 'own_report', detail: 'Own report.' }, 403)
      if (r.my_vote) return json(route, { code: 'already_voted', detail: 'Already voted.' }, 409)
      Object.assign(r, vote === 'confirm' ? { confirms: r.confirms + 1 } : { flags: r.flags + 1 }, { my_vote: vote })
      return json(route, r)
    }
    if (/^\/api\/reports\/[^/]+\/photo$/.test(pathname)) {
      return route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'image/png' }, body: TILE })
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
      case '/api/map/hazard':
        return json(route, mapHazard(new URL(req.url()).searchParams))
      case '/api/map/hazard/summary':
        return json(route, mapHazardSummary(new URL(req.url()).searchParams))
      case '/api/route':
        return json(route, mapRoute(new URL(req.url()).searchParams))
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

/**
 * A signed-in Supabase session without a real project: the password grant and
 * the user lookup answer with a fake session, and the profile tables are
 * empty. Call after mockBackend (later routes win). Lands on /dashboard.
 *
 * The Next.js proxy (server side, not interceptable here) checks the session
 * cookie with Supabase; with this fake token that check simply finds no user.
 */
export const TEST_USER = { id: '0b3e8f2a-1c4d-4e5f-8a9b-0c1d2e3f4a5b', email: 'tester@example.com' }
export async function signIn(page: Page) {
  const user = {
    id: TEST_USER.id, aud: 'authenticated', role: 'authenticated', email: TEST_USER.email,
    app_metadata: { provider: 'email' }, user_metadata: {}, created_at: '2026-11-01T00:00:00Z',
  }
  await page.route(/supabase\.co\/rest\/v1\//, (route) => json(route, []))
  await page.route(/supabase\.co\/auth\/v1\/user/, (route) => json(route, user))
  await page.route(/supabase\.co\/auth\/v1\/token/, (route) =>
    json(route, {
      access_token: 'e2e-access-token', token_type: 'bearer', expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'e2e-refresh-token', user,
    })
  )
  await page.goto('/login')
  await page.locator('#signin-email').fill(TEST_USER.email)
  await page.locator('#signin-password').fill('correct-horse-battery')
  await page.locator('form button[type="submit"]').first().click()
  await page.waitForURL('**/dashboard', { timeout: 30_000 })
}
