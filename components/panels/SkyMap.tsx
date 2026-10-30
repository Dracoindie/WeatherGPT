'use client'

/**
 * Dark map (CartoDB dark_matter) with a glowing pulse marker and a rotating
 * radar sweep. Loaded via next/dynamic with ssr: false.
 */

import 'leaflet/dist/leaflet.css'
import { useEffect, useMemo } from 'react'
import L from 'leaflet'
import { MapContainer, Marker, TileLayer, useMap } from 'react-leaflet'
import { useReducedMotion } from 'framer-motion'

interface SkyMapProps {
  latitude: number
  longitude: number
  label: string
}

function FlyTo({ latitude, longitude }: { latitude: number; longitude: number }) {
  const map = useMap()
  const reduced = useReducedMotion()
  useEffect(() => {
    if (reduced) map.setView([latitude, longitude], 10)
    else map.flyTo([latitude, longitude], 10, { duration: 1.6 })
  }, [map, latitude, longitude, reduced])
  return null
}

export default function SkyMap({ latitude, longitude, label }: SkyMapProps) {
  const icon = useMemo(
    () =>
      L.divIcon({
        className: '',
        html: '<div class="sky-marker"><span></span><span></span></div>',
        iconSize: [18, 18],
        iconAnchor: [9, 9],
      }),
    []
  )

  return (
    <div className="sky-map relative h-full min-h-[280px] overflow-hidden rounded-xl">
      <MapContainer
        center={[latitude, longitude]}
        zoom={10}
        zoomControl={false}
        attributionControl
        scrollWheelZoom={false}
        className="absolute inset-0 h-full w-full"
      >
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
          subdomains="abcd"
          maxZoom={19}
        />
        <Marker position={[latitude, longitude]} icon={icon} title={label} />
        <FlyTo latitude={latitude} longitude={longitude} />
      </MapContainer>

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
