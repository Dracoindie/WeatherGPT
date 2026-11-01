'use client'

/**
 * /map: the picked place on the map with its current conditions and 24 h
 * alert status. Data loading is shared with /dashboard (useLocationWeather).
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

const InteractiveMap = dynamic(() => import('@/components/map/InteractiveMap').then((m) => m.InteractiveMap), {
  ssr: false,
  loading: () => <div className="h-full min-h-[360px] animate-pulse rounded-xl bg-white/[0.03]" />,
})

export default function MapPage() {
  const { t } = useI18n()
  const describe = useDescribeWeather()
  const w = useLocationWeather()
  const code = w.weather?.current.weather_code
  const conditionLabel = code != null ? describe(code) ?? undefined : undefined

  return (
    <AppShell>
      <AuthGuard>
        <PageHeader
          eyebrow={t('map.eyebrow')}
          title={t('map.title')}
          description={t('map.intro')}
          actions={<LocationPicker onLocationSelected={w.selectLocation} defaultLocation={w.location} />}
        />

        {!w.location ? (
          <div className="sky-glass p-8 text-center text-sm text-hud-dim">{t('map.pick')}</div>
        ) : (
          <div className="space-y-5">
            <AlertBanner
              alerts={w.alerts}
              locationName={w.location.name}
              loading={w.alertsLoading}
              error={w.alertsError}
              staleSince={w.alertsStaleSince}
              onRetry={w.retryAlerts}
            />

            {w.weatherError && (
              <div role="alert" className="sky-glass border-sev-watch/40 p-4 text-sm text-hud">
                {t('dashboard.unavailable')} <span className="text-hud-dim">{w.weatherError}</span>
              </div>
            )}

            <div className="grid gap-5 lg:grid-cols-3">
              <GlassPanel wet={false} className="flex min-h-[420px] flex-col p-2 sm:p-2 lg:col-span-2">
                <div className="min-h-0 flex-1">
                  <InteractiveMap
                    latitude={w.location.latitude}
                    longitude={w.location.longitude}
                    locationName={w.location.name}
                    alertsCount={w.alerts.length}
                    conditionLabel={conditionLabel}
                    alertsText={fill(t('map.alerts'), { n: w.alerts.length })}
                    normalText={t('map.normal')}
                  />
                </div>
              </GlassPanel>
              <div className="min-w-0">
                <CurrentWeatherHero
                  status={w.weatherStatus}
                  current={w.weather?.current}
                  locationName={w.location.name}
                  timezone={w.weather?.timezone}
                  source={w.weather?.source}
                  conditionLabel={conditionLabel}
                  compact
                />
              </div>
            </div>

            <ForecastPanel state={w.forecast} />
            <TrustStrip />
          </div>
        )}
      </AuthGuard>
    </AppShell>
  )
}
