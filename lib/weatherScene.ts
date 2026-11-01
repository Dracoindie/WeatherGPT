/**
 * Weather → sky scene mapping for the Living Sky renderer.
 *
 * Inputs are only values returned by the backend (WMO weather_code,
 * precipitation, precipitation_probability, wind_speed_10m,
 * wind_direction_10m, temperature).
 * Outputs are purely visual parameters (0..1 intensities, colours) — they are
 * never displayed as weather numbers.
 */

import type { DateReference, WeatherFacts } from '@/lib/api/chat'
import type { HourlyWeather } from '@/lib/api/weather'

export type SceneKind = 'clear' | 'clouds' | 'fog' | 'rain' | 'snow' | 'storm'
export type TimePhase = 'dawn' | 'day' | 'golden' | 'night'
export type RGB = [number, number, number]

export interface SceneParams {
  kind: SceneKind
  /** 0..1 cloud coverage */
  cloudCover: number
  /** 0..1 how dark/heavy the clouds are */
  cloudDarkness: number
  /** 0..1 rain particle density */
  rain: number
  /** 0..1 snow particle density */
  snow: number
  /** 0..1 fog layer opacity */
  fog: number
  /** 0..1 lightning activity */
  storm: number
  /** km/h — drives drift speed and rain slant */
  windKmh: number
  /** screen-space direction the wind blows toward: +x = right, +y = up (unit vector) */
  windX: number
  windY: number
  /** 0..1 heat shimmer strength (only when temperature ≥ 35 °C) */
  heat: number
  /** local hour of day at the location, 0..24 (fractional) */
  hour: number
}

export const NUMERIC_KEYS = [
  'cloudCover',
  'cloudDarkness',
  'rain',
  'snow',
  'fog',
  'storm',
  'windKmh',
  'windX',
  'windY',
  'heat',
] as const satisfies readonly (keyof SceneParams)[]

export const HEAT_THRESHOLD_C = 35

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

function base(hour: number): SceneParams {
  return {
    kind: 'clear',
    cloudCover: 0.08,
    cloudDarkness: 0,
    rain: 0,
    snow: 0,
    fog: 0,
    storm: 0,
    windKmh: 8,
    windX: 1,
    windY: 0,
    heat: 0,
    hour,
  }
}

/**
 * Screen vector for a meteorological wind direction (degrees the wind blows
 * FROM). The viewer faces north, so an easterly (90°) drifts left and a
 * southerly (180°) drifts up toward the horizon. Unknown → default rightward.
 */
export function windVector(fromDeg: number | null | undefined): { x: number; y: number } {
  if (fromDeg == null || !Number.isFinite(fromDeg)) return { x: 1, y: 0 }
  const rad = (fromDeg * Math.PI) / 180
  return { x: -Math.sin(rad), y: -Math.cos(rad) }
}

function withWind(s: SceneParams, fromDeg: number | null | undefined): SceneParams {
  const v = windVector(fromDeg)
  s.windX = v.x
  s.windY = v.y
  return s
}

// ---------------------------------------------------------------------------
// Time of day
// ---------------------------------------------------------------------------

/** Local hour (fractional) in an IANA timezone. Falls back to the browser zone. */
export function localHour(timezone?: string | null, at: Date = new Date()): number {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone || undefined,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(at)
    const h = Number(parts.find((p) => p.type === 'hour')?.value ?? '0')
    const m = Number(parts.find((p) => p.type === 'minute')?.value ?? '0')
    return h + m / 60
  } catch {
    return at.getHours() + at.getMinutes() / 60
  }
}

/** Open-Meteo hourly times are local wall times ("2026-10-30T14:00"). */
export function hourOfTimestamp(ts: string): number {
  const match = /T(\d{2}):(\d{2})/.exec(ts)
  if (!match) return 12
  return Number(match[1]) + Number(match[2]) / 60
}

export function timePhase(hour: number): TimePhase {
  if (hour >= 5 && hour < 7.5) return 'dawn'
  if (hour >= 7.5 && hour < 16.5) return 'day'
  if (hour >= 16.5 && hour < 19) return 'golden'
  return 'night'
}

/** Hour used for the ambience of a forecast period (not a weather fact). */
function hourForDateReference(ref: DateReference, timezone: string): number {
  if (ref === 'tonight') return 22
  if (ref === 'this_afternoon') return 15
  return localHour(timezone)
}

// ---------------------------------------------------------------------------
// Weather → scene
// ---------------------------------------------------------------------------

function rainIntensity(rateMmPerHour: number): number {
  if (rateMmPerHour <= 0) return 0
  // 0.1 mm/h → ~0.2 (light), 2.5 → ~0.5 (moderate), 8+ → 1 (heavy)
  return clamp01(0.18 + rateMmPerHour / 8)
}

function heatFrom(tempC: number | null | undefined): number {
  if (tempC == null || tempC < HEAT_THRESHOLD_C) return 0
  return clamp01(0.35 + (tempC - HEAT_THRESHOLD_C) / 8)
}

/** Scene from a WMO Weather Interpretation Code (WW). */
export function sceneFromCode(
  code: number,
  hour: number,
  windKmh: number,
  rateMmPerHour = 0
): SceneParams {
  const s = base(hour)
  s.windKmh = windKmh
  if (code <= 1) {
    s.kind = 'clear'
    s.cloudCover = code === 0 ? 0.04 : 0.18
  } else if (code <= 3) {
    s.kind = 'clouds'
    s.cloudCover = code === 2 ? 0.5 : 0.88
    s.cloudDarkness = code === 2 ? 0.1 : 0.35
  } else if (code === 45 || code === 48) {
    s.kind = 'fog'
    s.cloudCover = 0.6
    s.cloudDarkness = 0.15
    s.fog = code === 48 ? 0.95 : 0.8
  } else if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) {
    s.kind = 'rain'
    s.cloudCover = 0.92
    s.cloudDarkness = 0.55
    const byCode =
      code === 51 || code === 56 ? 0.22
        : code === 53 ? 0.32
        : code === 55 || code === 57 ? 0.42
        : code === 61 || code === 66 || code === 80 ? 0.5
        : code === 63 || code === 81 ? 0.72
        : 0.95
    s.rain = Math.max(byCode, rainIntensity(rateMmPerHour))
  } else if ((code >= 71 && code <= 77) || code === 85 || code === 86) {
    s.kind = 'snow'
    s.cloudCover = 0.9
    s.cloudDarkness = 0.25
    s.snow = code === 71 || code === 85 ? 0.45 : code === 75 || code === 86 ? 1 : 0.7
  } else if (code >= 95) {
    s.kind = 'storm'
    s.cloudCover = 1
    s.cloudDarkness = 0.9
    s.rain = Math.max(0.85, rainIntensity(rateMmPerHour))
    s.storm = code === 95 ? 0.7 : 1
  } else {
    s.kind = 'clouds'
    s.cloudCover = 0.6
    s.cloudDarkness = 0.2
  }
  return s
}

interface Conditions {
  rateMmPerHour: number | null
  probability: number | null
  windKmh: number | null
  tempC: number | null
}

/** Scene when no weather_code is available (forecast periods, hourly scrub). */
export function sceneFromConditions(c: Conditions, hour: number): SceneParams {
  const s = base(hour)
  const rate = c.rateMmPerHour ?? 0
  const prob = c.probability ?? 0
  const wind = c.windKmh ?? 8
  s.windKmh = wind

  const cold = c.tempC != null && c.tempC <= 1
  const wet = rate >= 0.1 || prob >= 60

  if (wet && rate >= 2 && prob >= 70 && wind >= 35) {
    s.kind = 'storm'
    s.cloudCover = 1
    s.cloudDarkness = 0.88
    s.rain = Math.max(0.75, rainIntensity(rate))
    s.storm = clamp01(0.55 + wind / 150)
  } else if (wet && cold) {
    s.kind = 'snow'
    s.cloudCover = 0.9
    s.cloudDarkness = 0.25
    s.snow = clamp01(0.35 + rate / 4)
  } else if (wet) {
    s.kind = 'rain'
    s.cloudCover = clamp01(0.7 + prob / 300)
    s.cloudDarkness = clamp01(0.35 + rate / 10)
    s.rain = Math.max(rainIntensity(rate), prob >= 60 ? 0.25 : 0)
  } else if (prob >= 30) {
    s.kind = 'clouds'
    s.cloudCover = clamp01(0.35 + prob / 120)
    s.cloudDarkness = clamp01(prob / 200)
  } else {
    s.kind = 'clear'
    s.cloudCover = clamp01(0.06 + prob / 150)
  }
  s.heat = heatFrom(c.tempC)
  return s
}

/** Number of hours covered by "label (start to end)" in WeatherFacts.requested_time. */
function periodHours(requestedTime: string): number {
  const match = /\((\S+) to (\S+)\)/.exec(requestedTime)
  if (!match) return 1
  const start = Date.parse(match[1])
  const end = Date.parse(match[2])
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return 1
  return Math.round((end - start) / 3_600_000) + 1
}

export function sceneFromFacts(facts: WeatherFacts, ref: DateReference): SceneParams {
  const hour = hourForDateReference(ref, facts.timezone)
  const hours = periodHours(facts.requested_time)
  const rate = facts.precipitation != null ? facts.precipitation / hours : null
  const wind = facts.wind_speed_10m ?? 8
  const temp = facts.temperature_max ?? facts.temperature_2m

  if (facts.weather_code != null) {
    const s = sceneFromCode(facts.weather_code, hour, wind, rate ?? 0)
    s.heat = heatFrom(temp)
    return withWind(s, facts.wind_direction_10m)
  }
  const s = sceneFromConditions(
    {
      rateMmPerHour: rate,
      probability: facts.precipitation_probability,
      windKmh: facts.wind_speed_10m,
      tempC: temp,
    },
    hour
  )
  return withWind(s, facts.wind_direction_10m)
}

export function sceneFromHourly(hourly: HourlyWeather, index: number): SceneParams {
  const hour = hourOfTimestamp(hourly.time[index] ?? '')
  const rate = hourly.precipitation[index] ?? null
  const wind = hourly.wind_speed_10m[index] ?? null
  const temp = hourly.temperature_2m[index] ?? null
  // Hourly weather_code (when the backend sends it) beats the derived scene.
  const code = hourly.weather_code?.[index]
  if (code != null) {
    const s = sceneFromCode(code, hour, wind ?? 8, rate ?? 0)
    s.heat = heatFrom(temp)
    return withWind(s, hourly.wind_direction_10m?.[index])
  }
  const s = sceneFromConditions(
    {
      rateMmPerHour: rate,
      probability: hourly.precipitation_probability[index] ?? null,
      windKmh: wind,
      tempC: temp,
    },
    hour
  )
  return withWind(s, hourly.wind_direction_10m?.[index])
}

export function defaultScene(): SceneParams {
  const s = base(localHour())
  s.cloudCover = 0.22
  return s
}

// ---------------------------------------------------------------------------
// Demo presets (visual only — never shown as weather data)
// ---------------------------------------------------------------------------

export type DemoPreset =
  | 'clear'
  | 'clouds'
  | 'rain'
  | 'storm'
  | 'snow'
  | 'fog'
  | 'heatwave'
  | 'night'

export const DEMO_PRESETS: readonly DemoPreset[] = [
  'clear',
  'clouds',
  'rain',
  'storm',
  'snow',
  'fog',
  'heatwave',
  'night',
]

export function demoScene(preset: DemoPreset, windKmh: number): SceneParams {
  const day = 13
  switch (preset) {
    case 'clear':
      return { ...sceneFromCode(0, day, windKmh) }
    case 'clouds':
      return { ...sceneFromCode(3, day, windKmh) }
    case 'rain':
      return { ...sceneFromCode(63, day, windKmh) }
    case 'storm':
      return { ...sceneFromCode(99, day, windKmh) }
    case 'snow':
      return { ...sceneFromCode(75, day, windKmh) }
    case 'fog':
      return { ...sceneFromCode(45, 8, windKmh) }
    case 'heatwave':
      return { ...sceneFromCode(0, 14, windKmh), heat: 1 }
    case 'night':
      return { ...sceneFromCode(1, 23, windKmh) }
  }
}

// ---------------------------------------------------------------------------
// Sky palette (shared by the WebGL sky and the reduced-motion CSS fallback)
// ---------------------------------------------------------------------------

const PALETTES: Record<TimePhase, { top: RGB; bottom: RGB }> = {
  dawn: { top: [0.16, 0.2, 0.42], bottom: [0.98, 0.58, 0.45] },
  day: { top: [0.1, 0.36, 0.78], bottom: [0.55, 0.8, 0.98] },
  golden: { top: [0.2, 0.17, 0.42], bottom: [1.0, 0.55, 0.22] },
  night: { top: [0.012, 0.02, 0.07], bottom: [0.05, 0.09, 0.2] },
}

const mix = (a: number, b: number, t: number) => a + (b - a) * t
const mixRGB = (a: RGB, b: RGB, t: number): RGB => [
  mix(a[0], b[0], t),
  mix(a[1], b[1], t),
  mix(a[2], b[2], t),
]

/** Smoothly blended palette for a fractional hour. */
function phaseColors(hour: number): { top: RGB; bottom: RGB } {
  // keyframes: [hour, phase]
  const keys: [number, TimePhase][] = [
    [0, 'night'],
    [4.5, 'night'],
    [6, 'dawn'],
    [8, 'day'],
    [16, 'day'],
    [18, 'golden'],
    [19.5, 'night'],
    [24, 'night'],
  ]
  const h = ((hour % 24) + 24) % 24
  for (let i = 0; i < keys.length - 1; i++) {
    const [h0, p0] = keys[i]
    const [h1, p1] = keys[i + 1]
    if (h >= h0 && h <= h1) {
      const t = h1 === h0 ? 0 : (h - h0) / (h1 - h0)
      return {
        top: mixRGB(PALETTES[p0].top, PALETTES[p1].top, t),
        bottom: mixRGB(PALETTES[p0].bottom, PALETTES[p1].bottom, t),
      }
    }
  }
  return PALETTES.night
}

export interface SkyPalette {
  top: RGB
  bottom: RGB
  /** -1 (below horizon) .. 1 (zenith) */
  sunElevation: number
  /** 0..1 */
  starAlpha: number
}

export function skyPalette(scene: Pick<SceneParams, 'hour' | 'cloudCover' | 'cloudDarkness' | 'fog'>): SkyPalette {
  const { top, bottom } = phaseColors(scene.hour)
  // Sun rises ~6, peaks 12:30, sets ~19
  const sunElevation = Math.sin(((scene.hour - 6) / 13) * Math.PI)
  const overcast = Math.min(1, scene.cloudCover * 0.6 + scene.cloudDarkness * 0.5 + scene.fog * 0.4)
  const grey: RGB = sunElevation > 0 ? [0.42, 0.46, 0.52] : [0.05, 0.06, 0.09]
  return {
    top: mixRGB(top, mixRGB(grey, [0.18, 0.2, 0.24], 0.5), overcast * 0.75),
    bottom: mixRGB(bottom, grey, overcast * 0.8),
    sunElevation,
    starAlpha: Math.max(0, Math.min(1, -sunElevation * 3)) * (1 - overcast),
  }
}

export const toCss = (c: RGB, alpha = 1) =>
  `rgba(${Math.round(c[0] * 255)}, ${Math.round(c[1] * 255)}, ${Math.round(c[2] * 255)}, ${alpha})`
