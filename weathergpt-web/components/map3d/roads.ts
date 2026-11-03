/**
 * Roads coloured by weather hazard ("traffic colours for weather", NOT traffic).
 *
 * The road lines come from the basemap's own vector tiles (OpenMapTiles
 * schema: layer "transportation", property "class"), read with
 * querySourceFeatures, so nothing extra is downloaded. Each line is cut where
 * it crosses from one hazard cell into another and every piece takes the
 * level of its cell (GET /api/map/hazard). Pieces outside the hazard cells are
 * not drawn: no data, no colour.
 *
 * Cost control: only major roads (motorway and trunk when zoomed out, then
 * primary, then secondary), a vertex budget, and recomputation only when the
 * view, the hour or the hazard type changes.
 */

import { latLngToCell } from 'h3-js'
import type { GeoJSONFeature, Map as MapLibreMap } from 'maplibre-gl'

export interface RoadPiece {
  path: [number, number][]
  level: string
  cls: string
}

/** Vector sources that follow the OpenMapTiles schema, and a plain GeoJSON override. */
const SOURCES: Array<{ source: string; sourceLayer?: string }> = [
  { source: 'openmaptiles', sourceLayer: 'transportation' }, // OpenFreeMap
  { source: 'maptiler_planet', sourceLayer: 'transportation' }, // MapTiler
  { source: 'roads' }, // a GeoJSON source with a "class" property (tests, custom data)
]

export const MAX_VERTICES = 30_000

export function roadClasses(zoom: number): string[] {
  if (zoom < 7) return ['motorway', 'trunk']
  if (zoom < 9) return ['motorway', 'trunk', 'primary']
  return ['motorway', 'trunk', 'primary', 'secondary']
}

function lines(f: GeoJSONFeature): [number, number][][] {
  const g = f.geometry
  if (g.type === 'LineString') return [g.coordinates as [number, number][]]
  if (g.type === 'MultiLineString') return g.coordinates as [number, number][][]
  return []
}

/** Extra points so a straight stretch longer than `stepDeg` cannot skip a cell. */
function densify(line: [number, number][], stepDeg: number): [number, number][] {
  const out: [number, number][] = []
  for (let i = 0; i < line.length; i++) {
    const p = line[i]
    if (i > 0) {
      const q = line[i - 1]
      const d = Math.hypot(p[0] - q[0], p[1] - q[1])
      const n = Math.floor(d / stepDeg)
      for (let k = 1; k <= n; k++) {
        const t = k / (n + 1)
        out.push([q[0] + (p[0] - q[0]) * t, q[1] + (p[1] - q[1]) * t])
      }
    }
    out.push(p)
  }
  return out
}

/**
 * Coloured road pieces for the current view. `levelOf(cell)` gives the hazard
 * level of an H3 cell at resolution `res`, or undefined outside the data.
 */
export function roadPieces(map: MapLibreMap, res: number, hexKm: number, levelOf: (cell: string) => string | undefined): RoadPiece[] {
  const classes = new Set(roadClasses(map.getZoom()))
  const stepDeg = Math.max(0.005, (hexKm / 111.32) * 0.4)
  const seen = new Set<string>()
  const pieces: RoadPiece[] = []
  let vertices = 0

  for (const { source, sourceLayer } of SOURCES) {
    if (!map.getSource(source)) continue
    let feats: GeoJSONFeature[] = []
    try {
      feats = map.querySourceFeatures(source, sourceLayer ? { sourceLayer } : undefined)
    } catch {
      continue
    }
    // the most important roads first, so the vertex budget never drops a motorway
    const order = [...classes]
    feats.sort((a, b) => order.indexOf(String(a.properties?.class)) - order.indexOf(String(b.properties?.class)))
    for (const f of feats) {
      const cls = String(f.properties?.class ?? '')
      if (!classes.has(cls)) continue
      for (const raw of lines(f)) {
        if (raw.length < 2) continue
        // the same road arrives once per tile it crosses
        const key = `${cls}:${raw[0][0].toFixed(5)},${raw[0][1].toFixed(5)}:${raw.length}`
        if (seen.has(key)) continue
        seen.add(key)
        const line = densify(raw, stepDeg)
        if (vertices + line.length > MAX_VERTICES) return pieces
        vertices += line.length
        let current: RoadPiece | null = null
        for (const pt of line) {
          const level = levelOf(latLngToCell(pt[1], pt[0], res))
          if (level === undefined) {
            current = null
            continue
          }
          if (current && current.level === level) {
            current.path.push(pt)
          } else {
            const start: [number, number] | null = current ? current.path[current.path.length - 1] : null
            current = { path: start ? [start, pt] : [pt], level, cls }
            pieces.push(current)
          }
        }
      }
    }
  }
  return pieces.filter((p) => p.path.length >= 2)
}
