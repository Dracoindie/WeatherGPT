'use client'

/**
 * CurrentWeatherHero — adapted from Lovable.
 * Accepts real WeatherFacts from the existing /api/weather backend response.
 * Never invents weather data — shows skeleton/empty states instead.
 */

import { Panel, PanelLabel, Skeleton, StateNote } from '@/components/common/Panel'
import { useI18n } from '@/context/I18nContext'
import { CloudSun, Droplets, Gauge, Wind } from 'lucide-react'

// Shape of the existing /api/weather response current block
export interface CurrentWeatherData {
  temperature_2m: number
  relative_humidity_2m: number
  precipitation: number
  wind_speed_10m: number
  weather_code: number
  time: string
}

export type WeatherHeroStatus = 'idle' | 'loading' | 'ready' | 'error'

interface CurrentWeatherHeroProps {
  status: WeatherHeroStatus
  current?: CurrentWeatherData | null
  locationName?: string
  timezone?: string
  source?: string
  conditionLabel?: string
}

function Readout({ label, value, icon }: { label: string; value: string | null; icon: React.ReactNode }) {
  return (
    <div className="bg-panel p-3.5">
      <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.15em] text-fog">
        {icon}
        {label}
      </div>
      {value === null ? (
        <Skeleton className="mt-3 h-3 w-16" />
      ) : (
        <p className="mt-2 font-mono text-sm font-medium tabular-nums text-ink">{value}</p>
      )}
    </div>
  )
}

export function CurrentWeatherHero({
  status,
  current,
  locationName,
  timezone,
  source,
  conditionLabel,
}: CurrentWeatherHeroProps) {
  const { t } = useI18n()
  const loading = status === 'loading'

  const note =
    status === 'error'
      ? t('current.error')
      : status === 'idle'
        ? t('current.empty')
        : current
          ? `${source ?? 'Open-Meteo'} · ${current.time}`
          : t('current.empty')

  return (
    <Panel aria-label={t('current.title')} className="overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-5">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <PanelLabel>{t('current.title')}</PanelLabel>
            {loading && (
              <span className="rounded-full bg-amber-soft px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wide text-amber">
                Live sync
              </span>
            )}
          </div>
          {locationName && (
            <p className="mt-1 text-sm font-medium text-ink">{locationName}</p>
          )}
          <div className="mt-3 flex items-end gap-3">
            <span
              className={`font-mono text-7xl font-medium leading-[0.82] tracking-[-0.08em] tabular-nums sm:text-8xl ${
                current ? 'text-ink' : 'text-ink/[0.12]'
              }`}
            >
              {current ? Math.round(current.temperature_2m) : '--'}
            </span>
            <span
              className={`mb-1 font-mono text-2xl font-medium ${current ? 'text-ink-soft' : 'text-ink/[0.2]'}`}
            >
              °C
            </span>
          </div>
          {conditionLabel && current && (
            <p className="mt-3 text-base font-medium text-ink">{conditionLabel}</p>
          )}
          <StateNote className="mt-2">{note}</StateNote>
          {timezone && (
            <p className="mt-1 font-mono text-[10px] text-fog">{timezone}</p>
          )}
        </div>

        <div className="grid size-20 place-items-center rounded-[18px] bg-teal-soft text-teal sm:size-24" aria-hidden="true">
          <CloudSun className="size-10 stroke-[1.35] sm:size-12" />
        </div>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-[12px] bg-line sm:grid-cols-4">
        <Readout
          label={t('field.precipitation')}
          value={loading ? null : current ? `${current.precipitation} mm` : '—'}
          icon={<Droplets className="size-3" aria-hidden="true" />}
        />
        <Readout
          label={t('field.wind')}
          value={loading ? null : current ? `${current.wind_speed_10m} km/h` : '—'}
          icon={<Wind className="size-3" aria-hidden="true" />}
        />
        <Readout
          label="Humidity"
          value={loading ? null : current ? `${current.relative_humidity_2m}%` : '—'}
          icon={<Gauge className="size-3" aria-hidden="true" />}
        />
        <Readout
          label={t('field.updated')}
          value={
            loading
              ? null
              : current
                ? new Date(current.time).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })
                : '—'
          }
          icon={<span aria-hidden="true">◷</span>}
        />
      </div>
    </Panel>
  )
}
