'use client'

/**
 * Everything an inner page needs for one picked place: current weather
 * (/api/weather), the 7-day forecast (/api/forecast) and the 24 h alerts
 * (/api/alerts). Shared by /dashboard and /map so they cannot drift apart.
 * Also drives the static sky from the current weather code and local hour.
 */

import { useCallback, useState } from 'react'
import type { LocationData } from '@/components/location/LocationPicker'
import type { DataState, WeatherResponse } from '@/components/weather/forecastTypes'
import type { CurrentWeatherData } from '@/components/weather/CurrentWeatherHero'
import { useSkyFromCurrent } from '@/components/ui/AppShell'
import { useAuthContext } from '@/context/AuthContext'
import { useDemoContext } from '@/context/DemoContext'
import { API_BASE } from '@/lib/api/base'
import { ALERTS_UNAVAILABLE_MESSAGE, fetchAlerts } from '@/lib/api/alerts'
import { fetchForecast } from '@/lib/api/forecast'
import { describeWeather } from '@/lib/i18n/weather'
import { upsertProfile } from '@/lib/profile/profileService'
import type { WeatherAlert } from '@/types/alerts'

export interface WeatherApiResponse {
  source: string
  timezone: string
  current: CurrentWeatherData
}

export type WeatherStatus = 'idle' | 'loading' | 'ready' | 'error'

export function useLocationWeather() {
  const { user } = useAuthContext()
  const { isDemo } = useDemoContext()
  const [location, setLocation] = useState<LocationData | null>(null)
  const [weather, setWeather] = useState<WeatherApiResponse | null>(null)
  const [weatherStatus, setWeatherStatus] = useState<WeatherStatus>('idle')
  const [weatherError, setWeatherError] = useState('')
  const [forecast, setForecast] = useState<DataState<WeatherResponse>>({ status: 'idle' })
  const [alerts, setAlerts] = useState<WeatherAlert[]>([])
  const [alertsLoading, setAlertsLoading] = useState(false)
  const [alertsError, setAlertsError] = useState<string | null>(null)
  const [alertsStaleSince, setAlertsStaleSince] = useState<string | null>(null)

  useSkyFromCurrent(weather?.current, weather?.timezone)

  const loadAlerts = useCallback(async (loc: LocationData) => {
    setAlertsLoading(true)
    setAlertsError(null)
    try {
      const data = await fetchAlerts({ latitude: loc.latitude, longitude: loc.longitude })
      setAlerts(data.alerts)
      setAlertsStaleSince(data.stale ? data.data_retrieved_at ?? null : null)
    } catch (err) {
      setAlerts([])
      setAlertsStaleSince(null)
      setAlertsError(err instanceof Error ? err.message : ALERTS_UNAVAILABLE_MESSAGE)
    } finally {
      setAlertsLoading(false)
    }
  }, [])

  const loadForecast = useCallback(async (loc: LocationData) => {
    setForecast({ status: 'loading' })
    try {
      const data = await fetchForecast({ latitude: loc.latitude, longitude: loc.longitude })
      setForecast({
        status: 'ready',
        data: {
          forecast: data.daily.map((d) => ({
            date: d.date,
            temperatureMaxC: d.max_temperature ?? 0,
            temperatureMinC: d.min_temperature ?? 0,
            precipitationMm: d.precipitation_sum ?? 0,
            precipitationProbability: d.precipitation_probability_max ?? 0,
            windSpeedKmh: d.max_wind_speed ?? 0,
            condition: describeWeather(d.weather_code, 'en') ?? 'Unknown',
            weatherCode: d.weather_code,
          })),
        },
      })
    } catch (err) {
      setForecast({ status: 'error', error: err instanceof Error ? err.message : 'Forecast fetch failed' })
    }
  }, [])

  const selectLocation = useCallback(
    async (loc: LocationData) => {
      setLocation(loc)
      setWeatherError('')
      setWeatherStatus('loading')

      // Remember the place as the signed-in user's default (RLS: own row only).
      if (user && !isDemo) {
        await upsertProfile(user.id, {
          default_latitude: loc.latitude,
          default_longitude: loc.longitude,
          default_location_name: loc.name,
          location_permission: true,
        })
      }

      try {
        const resp = await fetch(`${API_BASE}/api/weather?latitude=${loc.latitude}&longitude=${loc.longitude}`)
        if (!resp.ok) throw new Error(`Weather API error: ${resp.status}`)
        setWeather((await resp.json()) as WeatherApiResponse)
        setWeatherStatus('ready')
      } catch (err) {
        setWeatherStatus('error')
        setWeatherError(err instanceof Error ? err.message : 'Could not fetch weather. Is the backend running?')
      }
      // Forecast and alerts load even if current conditions failed.
      await Promise.all([loadForecast(loc), loadAlerts(loc)])
    },
    [user, isDemo, loadForecast, loadAlerts]
  )

  return {
    location,
    selectLocation,
    weather,
    weatherStatus,
    weatherError,
    forecast,
    alerts,
    alertsLoading,
    alertsError,
    alertsStaleSince,
    retryAlerts: location ? () => void loadAlerts(location) : undefined,
  }
}
