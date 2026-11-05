'use client'

/**
 * The console's dark mini map with a glowing pulse marker and a rotating radar
 * sweep. Loaded via next/dynamic with ssr: false.
 *
 * The same basemap as /map (components/map3d/sources.ts): OpenFreeMap's dark
 * style, keyless, or MapTiler's when NEXT_PUBLIC_MAPTILER_KEY is set, falling
 * back to keyless if MapTiler refuses. (The old CARTO raster tiles now answer
 * "API KEY REQUIRED".)
 */

import 'maplibre-gl/dist/maplibre-gl.css'
import { useReducedMotion } from 'framer-motion'
import { getVersion, Map as MapLibreMap, Marker, setWorkerUrl } from 'maplibre-gl'
import { useEffect, useRef, useState } from 'react'
import { addMissingImageFallback, MAPLIBRE_WORKER, tintBasemap } from '@/components/map3d/basemap'
import { KEYLESS, mapSources, type MapSources } from '@/components/map3d/sources'

interface SkyMapProps {
  latitude: number
  longitude: number
  label: string
}

export default function SkyMap({ latitude, longitude, label }: SkyMapProps) {
  const el = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const markerRef = useRef<Marker | null>(null)
  const reduced = useReducedMotion()
  const [failed, setFailed] = useState(false)
  const start = useRef({ latitude, longitude, label })

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
        center: [start.current.longitude, start.current.latitude],
        zoom: 10,
        scrollZoom: false,
        attributionControl: { compact: true },
      })
    } catch {
      const id = window.setTimeout(() => setFailed(true), 0)
      return () => window.clearTimeout(id)
    }
    mapRef.current = map
    addMissingImageFallback(map)
    map.on('style.load', () => tintBasemap(map))
    map.on('error', (e) => {
      const status = (e.error as { status?: number } | undefined)?.status
      if (sources.current.provider === 'maptiler' && (!map.isStyleLoaded() || status === 401 || status === 403 || status === 429)) {
        sources.current = KEYLESS
        map.setStyle(KEYLESS.style)
      }
    })
    const dot = document.createElement('div')
    dot.className = 'sky-marker'
    dot.innerHTML = '<span></span><span></span>'
    dot.title = start.current.label
    markerRef.current = new Marker({ element: dot }).setLngLat([start.current.longitude, start.current.latitude]).addTo(map)
    const observer = new ResizeObserver(() => map.resize())
    observer.observe(container)
    return () => {
      observer.disconnect()
      markerRef.current = null
      mapRef.current = null
      map.remove()
    }
  }, [])

  // follow the place
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    markerRef.current?.setLngLat([longitude, latitude])
    const title = markerRef.current?.getElement()
    if (title) title.title = label
    if (reduced) map.jumpTo({ center: [longitude, latitude], zoom: 10 })
    else map.flyTo({ center: [longitude, latitude], zoom: 10, duration: 1600 })
  }, [latitude, longitude, label, reduced])

  return (
    <div className="sky-map relative h-full min-h-[280px] overflow-hidden rounded-xl" data-testid="sky-map">
      {failed ? (
        <div className="absolute inset-0 bg-white/[0.03]" />
      ) : (
        // inline position: maplibre-gl.css's .maplibregl-map { position: relative } beats the class
        <div ref={el} style={{ position: 'absolute', inset: 0 }} aria-label={label} role="img" />
      )}

      {/* radar sweep + range rings, centred on the marker */}
      <div className="pointer-events-none absolute inset-0 z-[500] grid place-items-center" aria-hidden="true">
        <div className="relative aspect-square h-[160%] max-h-none rounded-full">
          <div
            className="absolute inset-0 rounded-full"
            style={{
              background: 'conic-gradient(from 0deg, color-mix(in srgb, var(--sky-accent) 45%, transparent), transparent 55deg)',
              animation: 'sky-radar 4s linear infinite',
              mixBlendMode: 'screen',
            }}
          />
          {[0.25, 0.5, 0.75].map((r) => (
            <div
              key={r}
              className="absolute rounded-full border border-accent/20"
              style={{ inset: `${(1 - r) * 50}%` }}
            />
          ))}
        </div>
      </div>
      <div className="pointer-events-none absolute inset-0 z-[500] bg-[radial-gradient(circle,transparent_45%,rgba(2,4,10,0.75))]" />
    </div>
  )
}
