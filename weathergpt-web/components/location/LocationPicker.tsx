/**
 * LocationPicker — "Use my current location" component.
 *
 * Behaviour:
 *  - Renders a primary "Use my current location" button.
 *  - On click, calls requestLocation() from useGeolocation.
 *  - On success: reverse-geocodes the coordinates and calls onLocationSelected.
 *  - On denial or error: shows an inline message and offers a manual text input.
 *  - On manual entry: validates the city via Nominatim forward geocoding.
 *  - NEVER blocks the app when permission is denied.
 *
 * Props:
 *  onLocationSelected(lat, lng, name) — called when any location is confirmed.
 *  defaultLocation                   — pre-fill if the user already has one.
 */

'use client'

import { useState, useEffect, useRef } from 'react'
import { useGeolocation } from '@/lib/location/useGeolocation'
import { reverseGeocode } from '@/lib/location/reverseGeocode'
import { Crosshair, MapPin, PencilLine, Search } from 'lucide-react'

export interface LocationData {
  latitude: number
  longitude: number
  name: string
}

interface LocationPickerProps {
  onLocationSelected: (loc: LocationData) => void
  defaultLocation?: LocationData | null
}

export default function LocationPicker({
  onLocationSelected,
  defaultLocation,
}: LocationPickerProps) {
  const { coords, status, error: geoError, requestLocation } = useGeolocation()
  const [resolvedName, setResolvedName] = useState<string>(
    defaultLocation?.name ?? ''
  )
  const [manualInput, setManualInput] = useState('')
  const [manualError, setManualError] = useState('')
  const [geocoding, setGeocoding] = useState(false)
  const [showManual, setShowManual] = useState(false)

  // When geolocation succeeds, reverse-geocode and surface result
  const processedCoords = useRef<string | null>(null)

  useEffect(() => {
    const coordsKey = coords ? `${coords.latitude},${coords.longitude}` : null
    if (status === 'granted' && coords && processedCoords.current !== coordsKey) {
      processedCoords.current = coordsKey
      const fetchGeocode = async () => {
        // Yield to avoid calling setState synchronously in effect body
        await Promise.resolve()
        setGeocoding(true)
        try {
          const result = await reverseGeocode(coords.latitude, coords.longitude)
          setResolvedName(result.displayName)
          onLocationSelected({
            latitude: coords.latitude,
            longitude: coords.longitude,
            name: result.displayName,
          })
        } finally {
          setGeocoding(false)
        }
      }
      fetchGeocode()
    }
  }, [status, coords, onLocationSelected])

  // Manual city → geocode via Nominatim forward search
  async function handleManualSubmit(e: React.FormEvent) {
    e.preventDefault()
    const q = manualInput.trim()
    if (!q) return

    setManualError('')
    setGeocoding(true)
    try {
      const params = new URLSearchParams({ q, format: 'json', limit: '1' })
      const resp = await fetch(
        `https://nominatim.openstreetmap.org/search?${params}`,
        { headers: { 'User-Agent': 'WeatherGPT-SIH2026/0.1' } }
      )
      const results = await resp.json()
      if (!results?.length) {
        setManualError('Location not found. Please try a different name.')
        return
      }
      const r = results[0]
      const lat = parseFloat(r.lat)
      const lng = parseFloat(r.lon)
      const name = r.display_name.split(',').slice(0, 3).join(', ')
      setResolvedName(name)
      onLocationSelected({ latitude: lat, longitude: lng, name })
      setShowManual(false)
      setManualInput('')
    } catch {
      setManualError('Could not search for that location. Please try again.')
    } finally {
      setGeocoding(false)
    }
  }

  const isRequesting = status === 'requesting'
  const hasDenied = status === 'denied' || status === 'unavailable' || status === 'timeout'

  return (
    <div className="w-full rounded-[14px] border border-line bg-panel p-3 shadow-sm sm:w-[360px]">
      <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.16em] text-fog">Location context</p>

      {/* Resolved location display */}
      {resolvedName && !showManual && (
        <div className="flex items-center justify-between gap-2 rounded-[10px] bg-teal-soft px-3 py-2">
          <span className="flex min-w-0 items-center gap-2 text-sm font-medium text-ink">
            <MapPin className="size-4 shrink-0 text-teal" aria-hidden="true" />
            <span className="truncate">{resolvedName}</span>
          </span>
          <button
            type="button"
            onClick={() => setShowManual(true)}
            className="shrink-0 text-xs font-medium text-teal underline-offset-2 hover:underline"
          >
            Change
          </button>
        </div>
      )}

      {/* Primary GPS button */}
      {!resolvedName && !showManual && (
        <button
          onClick={requestLocation}
          disabled={isRequesting || geocoding}
          className="flex w-full items-center justify-center gap-2 rounded-[10px] bg-ink px-4 py-2.5 text-sm font-medium text-panel transition-colors hover:bg-ink/90 disabled:opacity-60"
        >
          {isRequesting || geocoding ? (
            <>
              <span className="animate-spin">⌛</span> Detecting location…
            </>
          ) : (
            <><Crosshair className="size-4" aria-hidden="true" /> Use my current location</>
          )}
        </button>
      )}

      {/* Geolocation error message */}
      {geoError && (
        <p className="mt-2 text-xs text-amber">{geoError}</p>
      )}

      {/* Show manual entry when: denied, or user clicks "Change" */}
      {(hasDenied || showManual) && !geocoding && (
        <>
          <form onSubmit={handleManualSubmit} className="flex gap-2">
            <input
              type="text"
              value={manualInput}
              onChange={(e) => setManualInput(e.target.value)}
              placeholder="Enter city or place…"
              className="min-w-0 flex-1 rounded-[10px] border border-line bg-canvas px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-teal/30"
            />
            <button
              type="submit"
              disabled={!manualInput.trim() || geocoding}
              className="grid size-9 place-items-center rounded-[10px] bg-ink text-panel hover:bg-ink/90 disabled:opacity-50"
            >
              <Search className="size-4" aria-hidden="true" />
            </button>
          </form>
          {manualError && (
            <p className="mt-1 text-xs text-red-500">{manualError}</p>
          )}
          {!hasDenied && (
            <button
              onClick={() => { setShowManual(false); setManualInput('') }}
              className="mt-2 text-xs text-ink-soft underline"
            >
              Cancel
            </button>
          )}
        </>
      )}

      {/* Fallback: also offer manual if user doesn't want GPS */}
      {!resolvedName && !showManual && !isRequesting && !geocoding && (
        <button
          onClick={() => setShowManual(true)}
          className="mt-2 flex items-center gap-1 text-xs text-ink-soft underline hover:text-ink"
        >
          <PencilLine className="size-3" aria-hidden="true" /> Enter location manually instead
        </button>
      )}
    </div>
  )
}
