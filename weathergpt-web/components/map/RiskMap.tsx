'use client'

/**
 * District risk map: one circle per district, coloured by severity.
 * Loaded via next/dynamic with ssr: false (Leaflet needs window).
 */

import 'leaflet/dist/leaflet.css'
import { useEffect } from 'react'
import L from 'leaflet'
import { CircleMarker, MapContainer, TileLayer, Tooltip, useMap } from 'react-leaflet'
import type { DistrictRisk, RiskLevel } from '@/lib/api/roles'

/** Same values as the --sev-* tokens in globals.css (Leaflet paths need literal colours). */
export const SEVERITY_COLOR: Record<RiskLevel, string> = {
  warning: '#f43f5e',
  watch: '#fbbf24',
  advisory: '#38bdf8',
  none: '#34d399',
  unknown: '#94a3b8',
}

/** Fit the map to the points when the set of points changes, and again when the
 * panel resizes (districts arrive one by one and the list beside it grows). */
function Fit({ points }: { points: [number, number][] }) {
  const map = useMap()
  const key = points.map((p) => p.join(',')).join(';')
  useEffect(() => {
    const pts = key ? key.split(';').map((p) => p.split(',').map(Number) as [number, number]) : []
    const fit = () => {
      map.invalidateSize()
      if (pts.length === 1) map.setView(pts[0], 8)
      else if (pts.length > 1) map.fitBounds(L.latLngBounds(pts), { padding: [24, 24] })
    }
    fit()
    const observer = new ResizeObserver(fit)
    observer.observe(map.getContainer())
    return () => observer.disconnect()
  }, [map, key])
  return null
}

export default function RiskMap({ districts }: { districts: DistrictRisk[] }) {
  const points = districts.map((d) => [d.latitude, d.longitude] as [number, number])
  return (
    <div className="relative h-full min-h-[320px] overflow-hidden rounded-xl">
      <MapContainer center={[19.5, 76]} zoom={6} scrollWheelZoom={false} className="absolute inset-0 h-full w-full">
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; CARTO'
        />
        <Fit points={points} />
        {districts.map((d) => (
          <CircleMarker
            key={d.name}
            center={[d.latitude, d.longitude]}
            radius={d.severity === 'warning' ? 13 : d.severity === 'watch' ? 11 : 9}
            pathOptions={{ color: '#020617', weight: 2, fillColor: SEVERITY_COLOR[d.severity], fillOpacity: 0.85 }}
          >
            <Tooltip>
              <strong>{d.name}</strong> · {d.severity}
              {d.headline ? <br /> : null}
              {d.headline}
            </Tooltip>
          </CircleMarker>
        ))}
      </MapContainer>
    </div>
  )
}
