/**
 * Community reports (backend/api/reports.py, docs/REPORTS.md).
 * Every report is "community report, unverified"; reports never change
 * forecasts or alert levels. The API never returns who reported.
 */

import { API_BASE } from '@/lib/api/base'
import { apiFetch } from '@/lib/replay'

export const REPORT_KINDS = ['heavy_rain', 'waterlogging', 'hail', 'strong_wind', 'fallen_tree', 'landslide', 'road_blocked'] as const
export type ReportKind = (typeof REPORT_KINDS)[number]
export type ReportGroup = 'rain' | 'wind' | 'ground'
export const REPORT_GROUP: Record<ReportKind, ReportGroup> = {
  heavy_rain: 'rain',
  waterlogging: 'rain',
  hail: 'rain',
  strong_wind: 'wind',
  fallen_tree: 'wind',
  landslide: 'ground',
  road_blocked: 'ground',
}
export type TrustLevel = 'low' | 'medium' | 'high'
export type Vote = 'confirm' | 'flag'

export interface Report {
  id: string
  kind: ReportKind
  latitude: number
  longitude: number
  note: string | null
  has_photo: boolean
  reported_at: string
  expires_at: string
  confirms: number
  flags: number
  trust: {
    level: TrustLevel
    score: number
    parts: { model: number; nearby: number; age: number; reporter: number; flags: number }
  }
  my_vote: Vote | null
  mine: boolean
  reporter: string
}

export interface ReportList {
  reports: Report[]
  label: string
  hide_after_flags: number
}

export interface Box {
  south: number
  west: number
  north: number
  east: number
}

/**
 * Low-trust reports are hidden until the viewer asks for them ("Show
 * unverified reports"). Your own report always shows, so it never seems lost.
 * The level is the backend's (thresholds.py), never recomputed here.
 */
export const hiddenByDefault = (r: Report): boolean => r.trust.level === 'low' && !r.mine

/** The backend's error codes; the UI words each one (report.err.<code>). */
export type ReportErrorCode =
  | 'sign_in'
  | 'rate_limited'
  | 'bad_kind'
  | 'box_too_large'
  | 'photo_format'
  | 'photo_too_large'
  | 'photo_too_many_pixels'
  | 'own_report'
  | 'already_voted'
  | 'gone'
  | 'unavailable'
  | 'not_configured'
  | 'offline'

export class ReportError extends Error {
  constructor(
    public code: ReportErrorCode,
    public status: number,
    public retryAfter: number | null = null
  ) {
    super(code)
  }
}

/** Largest box side the backend lists (backend/api/reports.py MAX_BOX_DEG). */
export const MAX_BOX_DEG = 15

const auth = (token?: string | null): Record<string, string> => (token ? { Authorization: `Bearer ${token}` } : {})

async function failure(resp: Response): Promise<ReportError> {
  let code: ReportErrorCode = 'unavailable'
  try {
    const body = (await resp.json()) as { code?: ReportErrorCode }
    if (body.code) code = body.code
  } catch {
    /* not JSON */
  }
  const retry = Number(resp.headers.get('Retry-After'))
  return new ReportError(code, resp.status, Number.isFinite(retry) && retry > 0 ? retry : null)
}

async function call(url: string, init: RequestInit): Promise<Response> {
  try {
    return await apiFetch(url, init)
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err
    throw new ReportError('offline', 0)
  }
}

export async function fetchReports(box: Box, token?: string | null, signal?: AbortSignal): Promise<ReportList> {
  const q = new URLSearchParams({
    south: box.south.toFixed(4),
    west: box.west.toFixed(4),
    north: box.north.toFixed(4),
    east: box.east.toFixed(4),
  })
  const resp = await call(`${API_BASE}/api/reports?${q}`, { headers: auth(token), signal })
  if (!resp.ok) throw await failure(resp)
  return resp.json()
}

export async function createReport(
  input: { kind: ReportKind; latitude: number; longitude: number; note?: string; photo?: Blob | null },
  token: string
): Promise<Report> {
  const form = new FormData()
  form.set('kind', input.kind)
  form.set('latitude', input.latitude.toFixed(5))
  form.set('longitude', input.longitude.toFixed(5))
  if (input.note?.trim()) form.set('note', input.note.trim())
  if (input.photo) form.set('photo', input.photo, 'photo.jpg')
  const resp = await call(`${API_BASE}/api/reports`, { method: 'POST', body: form, headers: auth(token) })
  if (!resp.ok) throw await failure(resp)
  return resp.json()
}

export async function voteReport(id: string, vote: Vote, token: string): Promise<Report> {
  const resp = await call(`${API_BASE}/api/reports/${encodeURIComponent(id)}/vote`, {
    method: 'POST',
    headers: { ...auth(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ vote }),
  })
  if (!resp.ok) throw await failure(resp)
  return resp.json()
}

export function reportPhotoUrl(id: string): string {
  return `${API_BASE}/api/reports/${encodeURIComponent(id)}/photo`
}

/**
 * The photo as a JPEG the backend can read. JPEG and PNG go as they are (the
 * server re-encodes and strips metadata anyway); anything else (HEIC from an
 * iPhone, WebP …) is drawn on a canvas and exported as JPEG, when the browser
 * can decode it. Returns null when it cannot ("please use a JPEG/PNG photo").
 */
export async function photoForUpload(file: File): Promise<Blob | null> {
  if (file.type === 'image/jpeg' || file.type === 'image/png') return file
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, 1600 / bitmap.width)
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close()
    return await new Promise<Blob | null>((resolve) => canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.85))
  } catch {
    return null
  }
}
