/**
 * Basemap and terrain sources for /map. No maplibre import, so the offline
 * precache (lib/offlineMap.ts) can use it without pulling the map bundle.
 *
 * Default: free, keyless sources.
 * - OpenFreeMap vector tiles (OpenMapTiles schema), "dark" style.
 * - AWS Open Data terrain tiles (Mapzen terrarium encoding).
 *
 * Optional: NEXT_PUBLIC_MAPTILER_KEY switches to MapTiler's "dataviz-dark"
 * style and terrain-rgb-v2 terrain. A MapTiler key is a browser key by design
 * (it is sent with every tile request), so it lives in a NEXT_PUBLIC_ variable;
 * restrict it to your domains in the MapTiler dashboard. If MapTiler refuses
 * the key or is down, the map falls back to the keyless sources at runtime.
 */

export const OPENFREEMAP_STYLE = 'https://tiles.openfreemap.org/styles/dark'
export const AWS_TERRAIN_TILES = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'
export const AWS_TERRAIN_ATTRIBUTION = 'Terrain: Mapzen / AWS Terrain Tiles'

export interface TerrainSource {
  tiles?: string[]
  url?: string
  encoding: 'terrarium' | 'mapbox'
  tileSize: number
  maxzoom: number
  attribution?: string
}

export interface MapSources {
  provider: 'maptiler' | 'openfreemap'
  style: string
  terrain: TerrainSource
}

export const KEYLESS: MapSources = {
  provider: 'openfreemap',
  style: OPENFREEMAP_STYLE,
  terrain: { tiles: [AWS_TERRAIN_TILES], encoding: 'terrarium', tileSize: 256, maxzoom: 13, attribution: AWS_TERRAIN_ATTRIBUTION },
}

export function mapSources(key: string | undefined = process.env.NEXT_PUBLIC_MAPTILER_KEY): MapSources {
  const k = key?.trim()
  if (!k) return KEYLESS
  const q = `key=${encodeURIComponent(k)}`
  return {
    provider: 'maptiler',
    style: `https://api.maptiler.com/maps/dataviz-dark/style.json?${q}`,
    terrain: { url: `https://api.maptiler.com/tiles/terrain-rgb-v2/tiles.json?${q}`, encoding: 'mapbox', tileSize: 256, maxzoom: 12 },
  }
}

/** Tile x/y for a lon/lat at zoom z (Web Mercator). */
export function tileXY(lon: number, lat: number, z: number): [number, number] {
  const n = 2 ** z
  const x = Math.floor(((lon + 180) / 360) * n)
  const r = (lat * Math.PI) / 180
  const y = Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n)
  return [Math.min(n - 1, Math.max(0, x)), Math.min(n - 1, Math.max(0, y))]
}

/** Every tile at zooms minZ..maxZ that covers a box. */
export function tilesFor(box: { south: number; west: number; north: number; east: number }, minZ: number, maxZ: number) {
  const out: Array<{ z: number; x: number; y: number }> = []
  for (let z = minZ; z <= maxZ; z++) {
    const [x0, y0] = tileXY(box.west, box.north, z)
    const [x1, y1] = tileXY(box.east, box.south, z)
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) out.push({ z, x, y })
  }
  return out
}

export function fillTemplate(template: string, t: { z: number; x: number; y: number }): string {
  return template.replace('{z}', String(t.z)).replace('{x}', String(t.x)).replace('{y}', String(t.y))
}
