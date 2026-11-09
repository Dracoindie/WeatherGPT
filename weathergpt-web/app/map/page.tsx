'use client'

/**
 * /map: the live weather map (MapLibre GL + deck.gl, components/map3d). Tap
 * anywhere for point weather; layers, a 72-hour time slider and broadcast
 * mode. The picked place keeps its alert status, current conditions and
 * forecast (useLocationWeather, shared with /dashboard).
 */

import dynamic from 'next/dynamic'
import AuthGuard from '@/components/auth/AuthGuard'
import { AlertBanner } from '@/components/alerts/AlertBanner'
import { TrustStrip } from '@/components/common/TrustStrip'
import LocationPicker from '@/components/location/LocationPicker'
import { GlassPanel } from '@/components/panels/GlassPanel'
import { AppShell } from '@/components/ui/AppShell'
import { PageHeader } from '@/components/ui/PageHeader'
import { CurrentWeatherHero } from '@/components/weather/CurrentWeatherHero'
import { ForecastPanel } from '@/components/weather/ForecastPanel'
import { fill, useI18n } from '@/context/I18nContext'
import { useDescribeWeather } from '@/lib/i18n/weather'
import { useLocationWeather } from '@/lib/useLocationWeather'

// maplibre-gl and deck.gl load only here, only in the browser.
const WeatherMap = dynamic(() => import('@/components/map3d/WeatherMap').then((m) => m.WeatherMap), {
  ssr: false,
  loading: () => <div className="h-[60svh] min-h-[320px] animate-pulse rounded-xl bg-white/[0.03] sm:h-full sm:min-h-[460px]" />,
})

export default function MapPage() {
  const { t } = useI18n()
  const describe = useDescribeWeather()
  const w = useLocationWeather()
  const code = w.weather?.current.weather_code
  const conditionLabel = code != null ? describe(code) ?? undefined : undefined
  const loc = w.location

  return (
    <AppShell>
      <AuthGuard>
        <PageHeader
          eyebrow={t('map.eyebrow')}
          title={t('map.title')}
          description={t('map.intro')}
          actions={<LocationPicker onLocationSelected={w.selectLocation} defaultLocation={w.location} />}
        />

        <div className="space-y-5">
          {loc && (
            <AlertBanner
              alerts={w.alerts}
              locationName={loc.name}
              loading={w.alertsLoading}
              error={w.alertsError}
              staleSince={w.alertsStaleSince}
              onRetry={w.retryAlerts}
            />
          )}

          {w.weatherError && (
            <div role="alert" className="sky-glass border-sev-watch/40 p-4 text-sm text-hud">
              {t('dashboard.unavailable')} <span className="text-hud-dim">{w.weatherError}</span>
            </div>
          )}

          {/* large screens: the map on the left over two rows; Current conditions
              and the 7-day forecast stacked on the right, so the column has no
              empty space under the conditions. Phones: map, conditions, forecast. */}
          <div className="grid gap-5 lg:grid-cols-3">
            <GlassPanel wet={false} className={loc ? 'min-w-0 p-2 sm:p-3 lg:col-span-2 lg:row-span-2' : 'min-w-0 p-2 sm:p-3 lg:col-span-3'}>
              <WeatherMap
                place={loc ? { latitude: loc.latitude, longitude: loc.longitude, name: loc.name } : null}
                conditionLabel={conditionLabel}
                statusText={
                  loc && !w.alertsLoading
                    ? w.alerts.length > 0
                      ? fill(t('map.alerts'), { n: w.alerts.length })
                      : t('map.normal')
                    : undefined
                }
                statusTone={w.alerts.length > 0 ? 'warning' : 'none'}
                timezone={w.weather?.timezone}
              />
            </GlassPanel>
            {loc && (
              <div className="min-w-0">
                <CurrentWeatherHero
                  status={w.weatherStatus}
                  current={w.weather?.current}
                  locationName={loc.name}
                  timezone={w.weather?.timezone}
                  source={w.weather?.source}
                  conditionLabel={conditionLabel}
                  compact
                />
              </div>
            )}
            {loc && (
              <div className="min-w-0 lg:col-start-3" data-testid="map-forecast">
                <ForecastPanel state={w.forecast} side />
              </div>
            )}
          </div>

          {!loc && <div className="sky-glass p-6 text-center text-sm text-hud-dim">{t('map.pick')}</div>}
          <TrustStrip />
        </div>
      </AuthGuard>
    </AppShell>
  )
}
