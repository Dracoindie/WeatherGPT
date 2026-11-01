/**
 * /dashboard: one place at a glance (current conditions, the 24 h alert
 * status, 7-day forecast, GFS). The chat lives in the Living Sky console;
 * the Ask card links there with the picked coordinates.
 */

'use client'

import AuthGuard from '@/components/auth/AuthGuard'
import { AlertBanner } from '@/components/alerts/AlertBanner'
import { TrustStrip } from '@/components/common/TrustStrip'
import { AskCard } from '@/components/console/AskCard'
import LocationPicker from '@/components/location/LocationPicker'
import { AppShell } from '@/components/ui/AppShell'
import { PageHeader } from '@/components/ui/PageHeader'
import { CurrentWeatherHero } from '@/components/weather/CurrentWeatherHero'
import { ForecastPanel } from '@/components/weather/ForecastPanel'
import { NwpPanel } from '@/components/weather/NwpPanel'
import { useI18n } from '@/context/I18nContext'
import { useDescribeWeather } from '@/lib/i18n/weather'
import { useLocationWeather } from '@/lib/useLocationWeather'

export default function DashboardPage() {
  const { t } = useI18n()
  const describe = useDescribeWeather()
  const w = useLocationWeather()
  const code = w.weather?.current.weather_code
  const conditionLabel = code != null ? describe(code) ?? undefined : undefined

  return (
    <AppShell>
      <AuthGuard>
        <PageHeader
          eyebrow={t('dashboard.eyebrow')}
          title={t('dashboard.title')}
          description={t('dashboard.intro')}
          actions={<LocationPicker onLocationSelected={w.selectLocation} defaultLocation={w.location} />}
        />

        {!w.location ? (
          <div className="sky-glass p-8 text-center text-sm text-hud-dim">{t('dashboard.pick')}</div>
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
              <div className="min-w-0 lg:col-span-2">
                <CurrentWeatherHero
                  status={w.weatherStatus}
                  current={w.weather?.current}
                  locationName={w.location.name}
                  timezone={w.weather?.timezone}
                  source={w.weather?.source}
                  conditionLabel={conditionLabel}
                />
              </div>
              <div className="min-w-0">
                <AskCard place={w.location.name} coords={w.location} />
              </div>
            </div>

            <ForecastPanel state={w.forecast} />
            <NwpPanel latitude={w.location.latitude} longitude={w.location.longitude} />
            <TrustStrip />
          </div>
        )}
      </AuthGuard>
    </AppShell>
  )
}
