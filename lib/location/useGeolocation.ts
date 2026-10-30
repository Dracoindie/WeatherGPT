/**
 * useGeolocation — hook for browser Geolocation API.
 *
 * Design constraints (per WeatherGPT privacy model):
 *  - Location is requested ON DEMAND only (never on mount automatically).
 *  - Uses getCurrentPosition — NOT watchPosition (no continuous tracking).
 *  - Only latitude, longitude, accuracy are collected.
 *    altitude, altitudeAccuracy, heading, speed are intentionally ignored.
 *
 * Usage:
 *   const { coords, status, error, requestLocation } = useGeolocation()
 *   <button onClick={requestLocation}>Use my current location</button>
 */

'use client'

import { useState, useCallback } from 'react'

export type GeolocationStatus =
  | 'idle'        // hook mounted, no request made
  | 'requesting'  // waiting for browser prompt
  | 'granted'     // position resolved
  | 'denied'      // user denied permission
  | 'unavailable' // device/browser doesn't support geolocation
  | 'timeout'     // position request timed out

export interface GeolocationCoords {
  latitude: number
  longitude: number
  accuracy: number  // metres
}

export interface UseGeolocationReturn {
  coords: GeolocationCoords | null
  status: GeolocationStatus
  error: string | null
  requestLocation: () => void
}

const GEO_OPTIONS: PositionOptions = {
  enableHighAccuracy: false, // battery-friendly for a web prototype
  timeout: 10_000,           // 10 seconds
  maximumAge: 60_000,        // accept a cached position up to 1 min old
}

export function useGeolocation(): UseGeolocationReturn {
  const [coords, setCoords] = useState<GeolocationCoords | null>(null)
  const [status, setStatus] = useState<GeolocationStatus>('idle')
  const [error, setError] = useState<string | null>(null)

  const requestLocation = useCallback(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setStatus('unavailable')
      setError('Your browser does not support geolocation.')
      return
    }

    setStatus('requesting')
    setError(null)

    navigator.geolocation.getCurrentPosition(
      (position) => {
        // Intentionally NOT reading altitude/heading/speed
        setCoords({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
        })
        setStatus('granted')
        setError(null)
      },
      (err) => {
        switch (err.code) {
          case GeolocationPositionError.PERMISSION_DENIED:
            setStatus('denied')
            setError(
              'Location permission was denied. You can still enter a location manually.'
            )
            break
          case GeolocationPositionError.POSITION_UNAVAILABLE:
            setStatus('unavailable')
            setError(
              'Your current position is unavailable. Please enter a location manually.'
            )
            break
          case GeolocationPositionError.TIMEOUT:
            setStatus('timeout')
            setError('Location request timed out. Please try again.')
            break
          default:
            setStatus('unavailable')
            setError('An unknown location error occurred.')
        }
      },
      GEO_OPTIONS
    )
  }, [])

  return { coords, status, error, requestLocation }
}
