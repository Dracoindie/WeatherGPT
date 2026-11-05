/**
 * "Prepare offline demo": save the basemap and terrain for the demo region
 * (GET /api/map/demo-region, defined in backend/maps/demo.py) into Cache
 * Storage, so /map still draws with no internet. The service worker
 * (public/sw.js) answers map requests from this cache only when the network
 * fails; it never adds to it while browsing.
 *
 * Kept small and polite to the free tile services: one region, zoom 6-10
 * (about 100 files), 4 requests at a time, run once by hand. Always the
 * keyless sources: with a MapTiler key the map falls back to them offline.
 *
 * Imported dynamically from the settings panel, so it adds nothing to the
 * shared bundle.
 */

import { fillTemplate, KEYLESS, tilesFor } from '@/components/map3d/sources'
import { API_BASE } from '@/lib/api/base'

/** Same name as MAP_CACHE in public/sw.js. */
export const OFFLINE_MAP_CACHE = 'wgpt-v2-map'
export const OFFLINE_MAP_KEY = 'wgpt:offline-map'
export const WORKER_URL = '/vendor/maplibre-gl-worker.js'
const GLYPH_RANGES = ['0-255', '256-511', '2304-2559'] // Latin, Latin extended, Devanagari

export interface OfflineMapInfo {
  at: string
  files: number
  bytes: number
  region: string
}

interface Region {
  name: string
  south: number
  west: number
  north: number
  east: number
  min_zoom: number
  max_zoom: number
}

interface StyleJson {
  sources?: Record<string, { type: string; url?: string; tiles?: string[]; minzoom?: number; maxzoom?: number }>
  sprite?: string | Array<{ id: string; url: string }>
  glyphs?: string
  layers?: Array<{ layout?: Record<string, unknown> }>
}

export function readOfflineMapInfo(): OfflineMapInfo | null {
  try {
    const raw = localStorage.getItem(OFFLINE_MAP_KEY)
    return raw ? (JSON.parse(raw) as OfflineMapInfo) : null
  } catch {
    return null
  }
}

function fontStacks(style: StyleJson): string[] {
  const stacks = new Set<string>()
  for (const l of style.layers ?? []) {
    let f = l.layout?.['text-font'] as unknown
    if (Array.isArray(f) && f[0] === 'literal') f = f[1]
    if (Array.isArray(f) && f.every((x) => typeof x === 'string')) stacks.add((f as string[]).join(','))
  }
  return [...stacks]
}

export async function prepareOfflineMap(onProgress: (done: number, total: number) => void): Promise<OfflineMapInfo> {
  const region = (await (await fetch(`${API_BASE}/api/map/demo-region`)).json()) as Region
  const cache = await caches.open(OFFLINE_MAP_CACHE)
  let bytes = 0
  let files = 0

  async function save(url: string): Promise<Response | null> {
    try {
      const resp = await fetch(url, { mode: 'cors' })
      if (!resp.ok) return null
      const copy = resp.clone()
      bytes += (await copy.clone().arrayBuffer()).byteLength
      await cache.put(url, copy)
      files += 1
      return resp
    } catch {
      return null
    }
  }

  // 1. the style, its TileJSONs, sprites and glyphs
  const styleResp = await save(KEYLESS.style)
  if (!styleResp) throw new Error('style unavailable')
  const style = (await styleResp.json()) as StyleJson
  const urls: string[] = []
  for (const src of Object.values(style.sources ?? {})) {
    let templates = src.tiles ?? []
    let minZ = src.minzoom ?? 0
    let maxZ = src.maxzoom ?? 22
    if (src.url) {
      const tj = await save(src.url)
      if (tj) {
        const j = (await tj.json()) as { tiles?: string[]; minzoom?: number; maxzoom?: number }
        templates = j.tiles ?? []
        minZ = j.minzoom ?? minZ
        maxZ = j.maxzoom ?? maxZ
      }
    }
    const lo = Math.max(region.min_zoom, minZ)
    const hi = Math.min(region.max_zoom, maxZ)
    for (const tpl of templates.slice(0, 1)) for (const t of tilesFor(region, lo, hi)) urls.push(fillTemplate(tpl, t))
  }
  const sprites = typeof style.sprite === 'string' ? [style.sprite] : (style.sprite ?? []).map((s) => s.url)
  for (const s of sprites) urls.push(`${s}.json`, `${s}.png`, `${s}@2x.json`, `${s}@2x.png`)
  if (style.glyphs) {
    for (const stack of fontStacks(style)) {
      for (const range of GLYPH_RANGES) urls.push(style.glyphs.replace('{fontstack}', stack).replace('{range}', range))
    }
  }
  // 2. terrain for broadcast mode, and MapLibre's worker
  for (const t of tilesFor(region, region.min_zoom, region.max_zoom)) urls.push(fillTemplate(KEYLESS.terrain.tiles![0], t))
  urls.push(WORKER_URL)

  // 3. fetch, 4 at a time
  let done = 0
  onProgress(done, urls.length)
  let next = 0
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      while (next < urls.length) {
        const url = urls[next++]
        await save(url)
        done += 1
        onProgress(done, urls.length)
      }
    })
  )

  const info: OfflineMapInfo = { at: new Date().toISOString(), files, bytes, region: region.name }
  try {
    localStorage.setItem(OFFLINE_MAP_KEY, JSON.stringify(info))
  } catch {
    // storage blocked: the files are still cached
  }
  return info
}
