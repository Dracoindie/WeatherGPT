/**
 * Shared basemap helpers for every MapLibre map (/map, the risk board map and
 * the console's mini map), so they all look and behave the same.
 */

import type { Map as MapLibreMap, StyleSpecification } from 'maplibre-gl'

export function cssVar(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
}

/** Living Sky tint on the OpenFreeMap dark style: navy land, deep-blue water. */
export function tintBasemap(map: MapLibreMap): void {
  const base = cssVar('--map-base', 'black')
  const water = cssVar('--map-water', 'black')
  const style = map.getStyle() as StyleSpecification | undefined
  for (const l of style?.layers ?? []) {
    try {
      if (l.type === 'background') map.setPaintProperty(l.id, 'background-color', base)
      else if (l.id === 'water' && l.type === 'fill') map.setPaintProperty(l.id, 'fill-color', water)
    } catch {
      // a layer the style does not have: nothing to tint
    }
  }
}

/** A small neutral dot (12 x 12 px at pixel ratio 2) for icons the style's sprite lacks. */
function fallbackIcon(): { width: number; height: number; data: Uint8ClampedArray } {
  const size = 12
  const data = new Uint8ClampedArray(size * size * 4)
  const c = (size - 1) / 2
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - c, y - c)
      const o = (y * size + x) * 4
      if (d <= 3.2) {
        // light slate dot with a dark rim, readable on the dark basemap
        const rim = d > 2.2
        data[o] = rim ? 15 : 203
        data[o + 1] = rim ? 23 : 213
        data[o + 2] = rim ? 42 : 225
        data[o + 3] = 230
      }
    }
  }
  return { width: size, height: size, data }
}

/**
 * Some basemap styles reference icons their sprite does not contain (the
 * OpenFreeMap dark style asks for "circle-11"), and MapLibre warns on every
 * tile. Answer `styleimagemissing` with a small neutral dot instead.
 */
export function addMissingImageFallback(map: MapLibreMap): void {
  map.on('styleimagemissing', (e: { id: string }) => {
    if (!e.id || map.hasImage(e.id)) return
    try {
      map.addImage(e.id, fallbackIcon(), { pixelRatio: 2 })
    } catch {
      // added meanwhile by another tile: fine
    }
  })
}

/** The worker URL every MapLibre map shares (copied by scripts/copy-maplibre-worker.mjs). */
/**
 * The first road or label layer of the basemap. Our own MapLibre layers (the
 * relief, the weather surface) go under it, so roads and place names stay
 * readable on top.
 */
export function firstOverlayLayer(map: MapLibreMap): string | undefined {
  const road = /road|transport|highway|street|motorway|trunk|primary|secondary|bridge|tunnel|rail/i
  return (map.getStyle()?.layers ?? []).find(
    (l) => l.type === 'symbol' || (l.type === 'line' && road.test(`${l.id} ${'source-layer' in l ? (l['source-layer'] ?? '') : ''}`))
  )?.id
}

export const MAPLIBRE_WORKER = '/vendor/maplibre-gl-worker.js'

/**
 * Small maps (MapLibre turns the attribution compact at <= 640 px, once the
 * style's credits have arrived): the credit starts expanded and folds to the
 * (i) button after 5 s or on the first user pan, zoom, rotate or tap, the
 * conditions the OSMF Attribution Guidelines allow for collapsing it. The (i)
 * button opens it again. Programmatic camera moves (the fly-to on load) do
 * not count, and the 5 s start when the compact credit appears. Cleans up on
 * map.remove().
 */
export const ATTRIBUTION_COLLAPSE_MS = 5000

export function collapseAttributionOnUse(map: MapLibreMap): void {
  const compact = () => map.getContainer().querySelector<HTMLElement>('.maplibregl-ctrl-attrib.maplibregl-compact')
  let done = false
  let timer: number | undefined
  let observer: MutationObserver | undefined
  const events = ['dragstart', 'zoomstart', 'rotatestart', 'pitchstart', 'click'] as const
  const off = () => {
    done = true
    window.clearTimeout(timer)
    observer?.disconnect()
    for (const ev of events) map.off(ev, onUser)
  }
  const collapse = () => {
    const el = compact()
    if (done || !el) return
    off()
    // the same change MapLibre makes on drag (_updateCompactMinimize)
    el.classList.remove('maplibregl-compact-show')
  }
  function onUser(e: { originalEvent?: unknown }) {
    if (e.originalEvent) collapse()
  }
  const startClock = () => {
    if (done || timer !== undefined || !compact()) return
    timer = window.setTimeout(collapse, ATTRIBUTION_COLLAPSE_MS)
  }
  for (const ev of events) map.on(ev, onUser)
  const control = map.getContainer().querySelector('.maplibregl-ctrl-attrib')
  if (control) {
    observer = new MutationObserver(startClock)
    observer.observe(control, { attributes: true, attributeFilter: ['class'] })
  }
  startClock()
  map.once('remove', off)
}
