/**
 * Human-friendly formatting for values the API returns raw.
 *
 * Times from the backend are local wall-clock strings without an offset
 * ("2026-11-02T00:00"). They are formatted from their parts, with no Date
 * timezone shift, so "00:00" stays "00:00" whatever the browser's zone is.
 */

import type { Language } from '@/context/I18nContext'

const LOCALE: Record<Language, string> = { en: 'en-IN', hi: 'hi-IN', hinglish: 'en-IN', mr: 'mr-IN' }

interface Parts {
  y: number
  m: number
  d: number
  hh?: string
  mm?: string
}

function parts(iso: string): Parts | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(iso.trim())
  if (!m) return null
  return { y: +m[1], m: +m[2], d: +m[3], hh: m[4], mm: m[5] }
}

/** "Mon 2 Nov" (localised weekday and month). */
export function formatDay(iso: string, language: Language = 'en'): string {
  const p = parts(iso)
  if (!p) return iso
  const s = new Date(Date.UTC(p.y, p.m - 1, p.d)).toLocaleDateString(LOCALE[language], {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  })
  return s.replace(/,/g, '')
}

/** "Mon 2 Nov, 14:00" for a local timestamp; "Mon 2 Nov" for a date. */
export function formatLocalTime(iso: string, language: Language = 'en'): string {
  const p = parts(iso)
  if (!p) return iso
  return p.hh ? `${formatDay(iso, language)}, ${p.hh}:${p.mm}` : formatDay(iso, language)
}

/** "14:00" from a local timestamp. */
export function formatClock(iso: string): string {
  const p = parts(iso)
  return p?.hh ? `${p.hh}:${p.mm}` : iso
}

/**
 * The facts window, e.g. "tomorrow (2026-11-02T00:00 to 2026-11-02T23:00)"
 * becomes "Mon 2 Nov, 00:00–23:00"; a window over two days becomes
 * "Sun 1 Nov 20:00 – Mon 2 Nov 06:00"; "now (2026-11-01T14:00)" becomes
 * "Sun 1 Nov, 14:00".
 */
export function formatWindow(requested: string | null | undefined, language: Language = 'en'): string {
  if (!requested) return ''
  const inner = /\(([^)]*)\)/.exec(requested)?.[1] ?? requested
  const [a, b] = inner.split(/\s+to\s+/)
  const pa = parts(a ?? '')
  if (!pa) return requested
  if (!b) return formatLocalTime(a, language)
  const pb = parts(b)
  if (!pb) return formatLocalTime(a, language)
  const sameDay = pa.y === pb.y && pa.m === pb.m && pa.d === pb.d
  if (sameDay) return `${formatDay(a, language)}, ${formatClock(a)}–${formatClock(b)}`
  return `${formatDay(a, language)} ${formatClock(a)} – ${formatDay(b, language)} ${formatClock(b)}`
}

const SOURCES: Record<string, string> = {
  'open-meteo': 'Open-Meteo',
  'open-meteo-archive': 'Open-Meteo archive',
  'open-meteo-air-quality': 'Open-Meteo air quality (CAMS)',
  gfs: 'NOAA GFS',
  'noaa-gfs': 'NOAA GFS',
}

/** "open-meteo" -> "Open-Meteo". */
export function formatSource(source: string | null | undefined): string {
  if (!source) return ''
  return SOURCES[source.toLowerCase()] ?? source
}

/** m/s -> km/h, one decimal. The UI shows wind in km/h everywhere. */
export function msToKmh(ms: number): number {
  return Math.round(ms * 3.6 * 10) / 10
}
