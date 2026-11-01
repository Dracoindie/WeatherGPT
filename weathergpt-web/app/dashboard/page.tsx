/**
 * /dashboard — protected weather dashboard.
 *
 * Uses Lovable-sourced UI components adapted for Next.js App Router.
 * Still calls the same FastAPI /api/weather and /api/chat endpoints.
 * Auth and location logic are fully preserved.
 */

'use client'

import { useState } from 'react'
import { describeWeather, useDescribeWeather } from '@/lib/i18n/weather'
import AuthGuard from '@/components/auth/AuthGuard'
import { API_BASE } from '@/lib/api/base'
import { TopNav } from '@/components/layout/TopNav'
import { CurrentWeatherHero } from '@/components/weather/CurrentWeatherHero'
import { WeatherIntelligence } from '@/components/weather/WeatherIntelligence'
import { ChatPanel } from '@/components/chat/ChatPanel'
import { TrustStrip } from '@/components/common/TrustStrip'
import LocationPicker, { type LocationData } from '@/components/location/LocationPicker'
import { useAuthContext } from '@/context/AuthContext'
import { useDemoContext } from '@/context/DemoContext'
import { upsertProfile } from '@/lib/profile/profileService'
import type { AdvisoryResult } from '@/components/weather/WeatherIntelligence'
import { fetchForecast } from '@/lib/api/forecast'
import { ALERTS_UNAVAILABLE_MESSAGE, fetchAlerts } from '@/lib/api/alerts'
import type { DataState, WeatherResponse } from '@/components/weather/forecastTypes'
import type { WeatherAlert } from '@/types/alerts'
import { ForecastPanel } from '@/components/weather/ForecastPanel';
import { NwpPanel } from '@/components/weather/NwpPanel';

import { AlertBanner } from '@/components/alerts/AlertBanner'
import Link from 'next/link'
import { BellRing, ChartNoAxesColumnIncreasing, MapPinned, Settings2 } from 'lucide-react'


interface WeatherApiResponse {
  source: string
  timezone: string
  current: {
    temperature_2m: number
    relative_humidity_2m: number
    precipitation: number
    wind_speed_10m: number
    weather_code: number
    time: string
  }
}

type WeatherStatus = 'idle' | 'loading' | 'ready' | 'error'

export default function DashboardPage() {
  const describe = useDescribeWeather()
  const { user, session } = useAuthContext()
  const { isDemo } = useDemoContext()
  const [location, setLocation] = useState<LocationData | null>(null)
  const [weatherData, setWeatherData] = useState<WeatherApiResponse | null>(null)
  const [weatherStatus, setWeatherStatus] = useState<WeatherStatus>('idle')
  const [weatherError, setWeatherError] = useState('')
  const [advisory, setAdvisory] = useState<AdvisoryResult | null>(null)
  const [forecastState, setForecastState] = useState<DataState<WeatherResponse>>({status: 'idle'})
  const [alerts, setAlerts] = useState<WeatherAlert[]>([])
  const [alertsLoading, setAlertsLoading] = useState(false)
  const [alertsError, setAlertsError] = useState<string | null>(null)
  const [alertsStaleSince, setAlertsStaleSince] = useState<string | null>(null)

  async function handleLocationSelected(loc: LocationData) {
    setLocation(loc)
    setWeatherError('')
    setWeatherStatus('loading')

    // Persist default location to user profile
    if (user && !isDemo) {
      await upsertProfile(user.id, {
        default_latitude: loc.latitude,
        default_longitude: loc.longitude,
        default_location_name: loc.name,
        location_permission: true,
      })
    }

    // Fetch real weather from the existing backend endpoint
    try {
      const url = `${API_BASE}/api/weather?latitude=${loc.latitude}&longitude=${loc.longitude}`
      const resp = await fetch(url)
      if (!resp.ok) throw new Error(`Weather API error: ${resp.status}`)
      const data: WeatherApiResponse = await resp.json()
      setWeatherData(data)
      setWeatherStatus('ready')
      // Fetch forecast data
      try {
        setForecastState({ status: 'loading' })
        const forecastData = await fetchForecast({ latitude: loc.latitude, longitude: loc.longitude })
        const enriched = forecastData.daily.map(d => ({
          date: d.date,
          temperatureMaxC: d.max_temperature ?? 0,
          temperatureMinC: d.min_temperature ?? 0,
          precipitationMm: d.precipitation_sum ?? 0,
          precipitationProbability: d.precipitation_probability_max ?? 0,
          windSpeedKmh: d.max_wind_speed ?? 0,
          condition: describeWeather(d.weather_code, 'en') ?? 'Unknown',
          weatherCode: d.weather_code,
        }))
        setForecastState({ status: 'ready', data: { forecast: enriched } })
      } catch (err) {
        setForecastState({
          status: 'error',
          error: err instanceof Error ? err.message : 'Forecast fetch failed',
        })
      }
      // Fetch alerts
      await loadAlerts(loc)
    } catch (err: unknown) {
      setWeatherStatus('error')
      setWeatherError(
        err instanceof Error ? err.message : 'Could not fetch weather. Is the backend running?'
      )
    }
  }

  async function loadAlerts(loc: LocationData) {
    setAlertsLoading(true)
    setAlertsError(null)
    try {
      const alertData = await fetchAlerts({ latitude: loc.latitude, longitude: loc.longitude })
      setAlerts(alertData.alerts)
      setAlertsStaleSince(alertData.stale ? alertData.data_retrieved_at ?? null : null)
    } catch (err) {
      setAlerts([])
      setAlertsStaleSince(null)
      setAlertsError(err instanceof Error ? err.message : ALERTS_UNAVAILABLE_MESSAGE)
    } finally {
      setAlertsLoading(false)
    }
  }

  const conditionLabel =
    weatherData?.current.weather_code != null
      ? (describe(weatherData.current.weather_code) ?? undefined)
      : undefined

  return (
    <AuthGuard>
      <div className="min-h-screen bg-canvas">
        <TopNav />

        <main className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6 lg:py-8">
          <div className="mb-6 flex flex-col justify-between gap-4 border-b border-line pb-6 sm:flex-row sm:items-end">
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-teal">Live meteorological context</p>
              <h1 className="mt-2 font-display text-2xl font-semibold tracking-tight text-ink sm:text-3xl">Weather intelligence, where you are.</h1>
            </div>
            <LocationPicker
              onLocationSelected={handleLocationSelected}
              defaultLocation={location}
            />
          </div>

          <div className="mb-5">
            <AlertBanner
              alerts={alerts}
              locationName={location?.name}
              loading={alertsLoading}
              error={alertsError}
              staleSince={alertsStaleSince}
              onRetry={location ? () => void loadAlerts(location) : undefined}
            />
          </div>

          {weatherError && (
            <div className="mb-4 rounded-[12px] border border-coral/30 bg-coral-soft p-4 text-sm text-coral">
              Weather data is temporarily unavailable. {weatherError}
            </div>
          )}

          <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
            <div className="space-y-5">
              <CurrentWeatherHero
                status={weatherStatus}
                current={weatherData?.current}
                locationName={location?.name}
                timezone={weatherData?.timezone}
                source={weatherData?.source}
                conditionLabel={conditionLabel}
              />

            </div>
            <WeatherIntelligence advisory={advisory} />
          </div>

          <section className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
            <ChatPanel
              latitude={location?.latitude}
              longitude={location?.longitude}
              accessToken={isDemo ? undefined : session?.access_token}
              onAdvisoryChange={setAdvisory}
            />
            <aside className="min-w-0 space-y-5">
              <ForecastPanel state={forecastState} />
              <NwpPanel latitude={location?.latitude} longitude={location?.longitude} />
              <TrustStrip />
            </aside>
          </section>

          <section id="capabilities" className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="WeatherGPT capabilities">
            {[
              { id: 'map', title: 'Interactive Map', href: '/map', text: 'Interactive GIS Leaflet map with location context and live weather.', icon: MapPinned },
              { id: 'alerts', title: 'Severe Alerts', href: '/alerts', text: `${alerts.length > 0 ? `${alerts.length} active hazard alert(s) evaluated.` : 'Deterministic early warning hazard assessment.'}`, icon: BellRing },
              { id: 'climate', title: 'Climate', href: '/climate', text: 'Historical climate analysis and long-term trend modeling.', icon: ChartNoAxesColumnIncreasing },
              { id: 'settings', title: 'Settings', href: '#settings', text: 'User profile, default location, and language preferences.', icon: Settings2 },
            ].map(({ id, title, href, text, icon: Icon }) => (
              <Link href={href} key={id} className="block transition-transform hover:-translate-y-0.5">
                <article id={id} className="h-full rounded-[14px] border border-line bg-panel p-4 hover:border-line/90">
                  <Icon className="size-4 text-teal" aria-hidden="true" />
                  <h2 className="mt-4 font-display text-sm font-semibold text-ink flex items-center justify-between">
                    {title}
                    <span className="font-mono text-[10px] text-teal uppercase">Open →</span>
                  </h2>
                  <p className="mt-1 text-xs leading-relaxed text-ink-soft">{text}</p>
                </article>
              </Link>
            ))}
          </section>
        </main>
      </div>
    </AuthGuard>
  )
}
