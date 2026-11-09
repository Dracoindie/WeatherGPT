/** GET /api/map/waterlogging (backend/maps/waterlogging.py, docs/WATERLOGGING.md). Experimental. */

import { API_BASE } from '@/lib/api/base'
import { apiFetch } from '@/lib/replay'

export type WaterlogLevel = 'low' | 'moderate' | 'high'

export interface WaterlogCell {
  cell: string
  score: number
  level: WaterlogLevel
  parts: { rain_mm: number; peak_mm_h: number; low_m: number | null; reports: number }
}

export interface Waterlogging {
  experimental: true
  note: string
  h3_resolution: number
  model_grid_km: number
  window_start: string | null
  window_end: string | null
  terrain: string
  reports_used: boolean
  cells: WaterlogCell[]
  cells_checked: number
  levels: Array<{ level: WaterlogLevel; from_score: number }>
}

/** Largest box side the backend estimates (backend/maps/waterlogging.py MAX_BOX_DEG): a city. */
export const WATERLOG_MAX_BOX_DEG = 0.3
/** The zoom "Zoom in here" goes to: about a 0.15° box on a phone, 0.25° on a laptop. */
export const WATERLOG_ZOOM = 11.5

export class WaterlogError extends Error {
  constructor(public status: number) {
    super(`Waterlogging error ${status}`)
  }
}

export async function fetchWaterlogging(
  b: { south: number; west: number; north: number; east: number },
  signal?: AbortSignal
): Promise<Waterlogging> {
  const q = new URLSearchParams({
    south: b.south.toFixed(4),
    west: b.west.toFixed(4),
    north: b.north.toFixed(4),
    east: b.east.toFixed(4),
  })
  let resp: Response
  try {
    resp = await apiFetch(`${API_BASE}/api/map/waterlogging?${q}`, { signal })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err
    throw new WaterlogError(0)
  }
  if (!resp.ok) throw new WaterlogError(resp.status)
  return resp.json()
}
