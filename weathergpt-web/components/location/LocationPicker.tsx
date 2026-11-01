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
import { Crosshair, LoaderCircle, MapPin, PencilLine, Search } from 'lucide-react'
import { useI18n } from '@/context/I18nContext'

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
  const { t } = useI18n()
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
        setManualError(t('location.notFound'))
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
      setManualError(t('location.searchFailed'))
    } finally {
      setGeocoding(false)
    }
  }

  const isRequesting = status === 'requesting'
  const hasDenied = status === 'denied' || status === 'unavailable' || status === 'timeout'

  return (
    <div className="sky-glass w-full p-3 sm:w-[360px]">
      <p className="sky-label mb-2 flex items-center gap-1.5">
        <MapPin className="size-3 text-accent" aria-hidden="true" /> {t('location.context')}
      </p>

      {resolvedName && !showManual && (
        <div className="flex items-center justify-between gap-2 rounded-xl border border-accent/25 bg-accent/10 px-3 py-2">
          <span className="min-w-0 truncate text-sm font-medium text-hud" title={resolvedName}>
            {resolvedName}
          </span>
          <button
            type="button"
            onClick={() => setShowManual(true)}
            className="shrink-0 font-readout text-[11px] uppercase tracking-[0.14em] text-accent hover:underline"
          >
            {t('location.change')}
          </button>
        </div>
      )}

      {!resolvedName && !showManual && (
        <button
          type="button"
          onClick={requestLocation}
          disabled={isRequesting || geocoding}
          className="sky-btn sky-btn-primary w-full"
        >
          {isRequesting || geocoding ? (
            <>
              <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> {t('location.detecting')}
            </>
          ) : (
            <>
              <Crosshair className="size-4" aria-hidden="true" /> {t('location.button')}
            </>
          )}
        </button>
      )}

      {geoError && <p className="mt-2 text-xs text-sev-watch">{geoError}</p>}

      {(hasDenied || showManual) && !geocoding && (
        <>
          <form onSubmit={handleManualSubmit} className="flex gap-2">
            <input
              type="text"
              value={manualInput}
              onChange={(e) => setManualInput(e.target.value)}
              placeholder={t('location.placeholder')}
              aria-label={t('location.placeholder')}
              className="sky-input min-w-0 flex-1"
            />
            <button
              type="submit"
              disabled={!manualInput.trim() || geocoding}
              aria-label={t('location.search')}
              className="sky-btn sky-btn-primary size-11 shrink-0 px-0"
            >
              <Search className="size-4" aria-hidden="true" />
            </button>
          </form>
          {manualError && <p className="mt-1.5 text-xs text-sev-warning">{manualError}</p>}
          {!hasDenied && (
            <button
              type="button"
              onClick={() => {
                setShowManual(false)
                setManualInput('')
              }}
              className="mt-2 text-xs text-hud-dim underline hover:text-hud"
            >
              {t('location.cancel')}
            </button>
          )}
        </>
      )}

      {!resolvedName && !showManual && !isRequesting && !geocoding && (
        <button
          type="button"
          onClick={() => setShowManual(true)}
          className="mt-2 flex items-center gap-1 text-xs text-hud-dim underline hover:text-hud"
        >
          <PencilLine className="size-3" aria-hidden="true" /> {t('location.manualInstead')}
        </button>
      )}
    </div>
  )
}
