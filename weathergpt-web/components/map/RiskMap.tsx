'use client'

/**
 * District risk map: one circle per district, coloured by severity.
 * Loaded via next/dynamic with ssr: false.
 *
 * The same basemap as /map (components/map3d/sources.ts): OpenFreeMap's dark
 * style, keyless, or MapTiler's when NEXT_PUBLIC_MAPTILER_KEY is set, falling
 * back to keyless if MapTiler refuses. (The old CARTO raster tiles now answer
 * "API KEY REQUIRED".) Circles are a MapLibre circle layer coloured by the
 * --sev-* tokens; every level comes from /api/risk.
 */

import 'maplibre-gl/dist/maplibre-gl.css'
import { getVersion, LngLatBounds, Map as MapLibreMap, NavigationControl, Popup, setWorkerUrl, type GeoJSONSource } from 'maplibre-gl'
import { useEffect, useRef, useState } from 'react'
import { addMissingImageFallback, cssVar, MAPLIBRE_WORKER, tintBasemap } from '@/components/map3d/basemap'
import { KEYLESS, mapSources, type MapSources } from '@/components/map3d/sources'
import { useI18n, type TranslationKey } from '@/context/I18nContext'
import type { DistrictRisk } from '@/lib/api/roles'

const LEVELS = ['severe', 'warning', 'watch', 'advisory', 'none', 'unknown'] as const

function collection(districts: DistrictRisk[]): GeoJSON.FeatureCollection<GeoJSON.Point> {
  return {
    type: 'FeatureCollection',
    features: districts.map((d) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [d.longitude, d.latitude] },
      properties: { name: d.name, severity: d.severity, headline: d.headline ?? '' },
    })),
  }
}

export default function RiskMap({ districts }: { districts: DistrictRisk[] }) {
  const { t } = useI18n()
  const el = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)
  const label = useRef(t)
  useEffect(() => {
    label.current = t
  }, [t])

  // ------------------------------------------------------------ the map ---
  useEffect(() => {
    const container = el.current
    if (!container) return
    let map: MapLibreMap
    const sources: { current: MapSources } = { current: mapSources() }
    try {
      setWorkerUrl(`${MAPLIBRE_WORKER}?v=${getVersion()}`)
      map = new MapLibreMap({
        container,
        style: sources.current.style,
        center: [76, 19.5],
        zoom: 5,
        scrollZoom: false,
        attributionControl: { compact: true },
      })
    } catch {
      const id = window.setTimeout(() => setFailed(true), 0)
      return () => window.clearTimeout(id)
    }
    mapRef.current = map
    map.addControl(new NavigationControl({ showCompass: false }), 'top-right')
    addMissingImageFallback(map)

    const severityColor: unknown[] = ['match', ['get', 'severity']]
    for (const l of LEVELS) severityColor.push(l, cssVar(`--sev-${l}`, 'gray'))
    severityColor.push(cssVar('--sev-unknown', 'gray'))

    const addLayers = () => {
      tintBasemap(map)
      if (!map.getSource('districts')) map.addSource('districts', { type: 'geojson', data: collection([]) })
      if (!map.getLayer('districts')) {
        map.addLayer({
          id: 'districts',
          type: 'circle',
          source: 'districts',
          paint: {
            'circle-color': severityColor as never,
            'circle-radius': ['match', ['get', 'severity'], 'severe', 15, 'warning', 13, 'watch', 11, 9],
            'circle-opacity': 0.85,
            // severe is dark on the dark map: a light ring keeps it visible
            'circle-stroke-color': ['match', ['get', 'severity'], 'severe', cssVar('--sev-severe-text', 'white'), 'black'],
            'circle-stroke-width': 2,
          },
        })
      }
    }
    map.on('style.load', addLayers)
    map.on('load', () => setReady(true))
    map.on('error', (e) => {
      const status = (e.error as { status?: number } | undefined)?.status
      if (sources.current.provider === 'maptiler' && (!map.isStyleLoaded() || status === 401 || status === 403 || status === 429)) {
        sources.current = KEYLESS
        map.setStyle(KEYLESS.style)
      }
    })

    // name and level on hover (mouse) or tap
    const popup = new Popup({ closeButton: false, closeOnClick: true, offset: 12 })
    const show = (e: { features?: Array<{ properties: Record<string, string>; geometry: GeoJSON.Geometry }> }) => {
      const f = e.features?.[0]
      if (!f || f.geometry.type !== 'Point') return
      const p = f.properties
      const div = document.createElement('div')
      div.className = 'text-xs'
      const strong = document.createElement('strong')
      strong.textContent = p.name
      div.append(strong, ` · ${label.current(`severity.${p.severity}` as TranslationKey)}`)
      if (p.headline) {
        div.append(document.createElement('br'), p.headline)
      }
      popup.setLngLat(f.geometry.coordinates as [number, number]).setDOMContent(div).addTo(map)
    }
    map.on('mousemove', 'districts', (e) => {
      map.getCanvas().style.cursor = 'pointer'
      show(e as never)
    })
    map.on('mouseleave', 'districts', () => {
      map.getCanvas().style.cursor = ''
      popup.remove()
    })
    map.on('click', 'districts', (e) => show(e as never))

    const observer = new ResizeObserver(() => map.resize())
    observer.observe(container)
    return () => {
      observer.disconnect()
      popup.remove()
      mapRef.current = null
      map.remove()
    }
  }, [])

  // --------------------------------------------------- districts and fit ---
  const key = districts.map((d) => `${d.name}:${d.latitude},${d.longitude}:${d.severity}`).join(';')
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    const src = map.getSource('districts') as GeoJSONSource | undefined
    src?.setData(collection(districts))
    const pts = districts.map((d) => [d.longitude, d.latitude] as [number, number])
    if (pts.length === 1) map.jumpTo({ center: pts[0], zoom: 8 })
    else if (pts.length > 1) {
      const b = new LngLatBounds(pts[0], pts[0])
      for (const p of pts) b.extend(p)
      map.fitBounds(b, { padding: 24, animate: false, maxZoom: 9 })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ready])

  if (failed) {
    return (
      <div className="flex h-full min-h-[320px] items-center justify-center rounded-xl bg-white/[0.03] p-6 text-center text-sm text-hud-dim" role="note">
        {t('map.webgl')}
      </div>
    )
  }
  return (
    <div className="relative h-full min-h-[320px] overflow-hidden rounded-xl" data-testid="risk-map" data-ready={ready ? 'true' : 'false'} data-districts={districts.length} data-levels={districts.map((d) => d.severity).sort().join(',')}>
      {/* inline position: maplibre-gl.css sets .maplibregl-map { position: relative }, which beats the
          Tailwind class, collapses the container to 0 px and clips the canvas */}
      <div ref={el} style={{ position: 'absolute', inset: 0 }} role="region" aria-label={t('disaster.mapLabel')} />
    </div>
  )
}
