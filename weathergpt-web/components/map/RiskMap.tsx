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

export const SEVERITY_COLOR: Record<RiskLevel, string> = {
  warning: '#e11d48',
  watch: '#f97316',
  advisory: '#eab308',
  none: '#14b8a6',
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
    <div className="relative h-full min-h-[320px] overflow-hidden rounded-[12px] border border-line">
      <MapContainer center={[19.5, 76]} zoom={6} scrollWheelZoom={false} className="absolute inset-0 h-full w-full">
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        />
        <Fit points={points} />
        {districts.map((d) => (
          <CircleMarker
            key={d.name}
            center={[d.latitude, d.longitude]}
            radius={d.severity === 'warning' ? 13 : d.severity === 'watch' ? 11 : 9}
            pathOptions={{ color: '#0f172a', weight: 1.5, fillColor: SEVERITY_COLOR[d.severity], fillOpacity: 0.85 }}
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
