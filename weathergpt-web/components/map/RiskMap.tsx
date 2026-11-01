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

function Fit({ points }: { points: [number, number][] }) {
  const map = useMap()
  useEffect(() => {
    if (points.length === 1) map.setView(points[0], 8)
    else if (points.length > 1) map.fitBounds(L.latLngBounds(points), { padding: [24, 24] })
  }, [map, points])
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
