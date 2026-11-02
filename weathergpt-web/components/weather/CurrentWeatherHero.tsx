'use client'

/**
 * Current conditions from GET /api/weather. Never invents weather data:
 * shows skeletons and empty states instead.
 */

import { CloudSun, Droplets, Gauge, Wind } from 'lucide-react'
import { GlassPanel } from '@/components/panels/GlassPanel'
import { useI18n, type Language } from '@/context/I18nContext'
import { formatClock, formatLocalTime, formatSource } from '@/lib/format'

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
  /** In a narrow column: readouts stay two per row. */
  compact?: boolean
}

function Readout({ label, value, icon }: { label: string; value: string | null; icon: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-xl border border-white/10 bg-black/25 p-3">
      <div className="sky-label flex items-center gap-1.5">
        {icon}
        <span className="truncate">{label}</span>
      </div>
      {value === null ? (
        <div className="mt-2 h-4 w-16 animate-pulse rounded bg-white/10" />
      ) : (
        <p className="mt-1.5 whitespace-nowrap font-readout text-base tabular-nums text-hud">{value}</p>
      )}
    </div>
  )
}

export function updatedLine(current: CurrentWeatherData, source: string | undefined, timezone: string | undefined, language: Language) {
  return [formatSource(source ?? 'open-meteo'), formatLocalTime(current.time, language), timezone].filter(Boolean).join(' · ')
}

export function CurrentWeatherHero({ status, current, locationName, timezone, source, conditionLabel, compact = false }: CurrentWeatherHeroProps) {
  const { t, language } = useI18n()
  const loading = status === 'loading'
  const note =
    status === 'error'
      ? t('current.error')
      : current
        ? updatedLine(current, source, timezone, language)
        : t('current.empty')

  return (
    <GlassPanel
      label={t('current.title')}
      aside={
        loading ? (
          <span className="rounded-full border border-sev-watch/40 bg-sev-watch/10 px-2 py-0.5 font-readout text-[10px] uppercase tracking-[0.16em] text-sev-watch-text">
            {t('current.syncing')}
          </span>
        ) : undefined
      }
      className="h-full"
    >
      <div className="flex flex-wrap items-start justify-between gap-5">
        <div className="min-w-0">
          {locationName && <p className="truncate text-sm font-medium text-hud">{locationName}</p>}
          <div className="mt-2 flex items-end gap-2">
            <span className={`font-hud text-7xl font-bold leading-[0.85] tabular-nums sm:text-8xl ${current ? 'text-hud' : 'text-white/15'}`}>
              {current ? Math.round(current.temperature_2m) : '--'}
            </span>
            <span className="mb-1 font-readout text-2xl text-hud-dim">°C</span>
          </div>
          {conditionLabel && current && (
            <p data-testid="weather-description" className="mt-3 text-lg font-medium text-hud">
              {conditionLabel}
            </p>
          )}
          <p className="mt-1 text-xs text-hud-dim">{note}</p>
        </div>
        <div className="grid size-20 place-items-center rounded-2xl border border-accent/30 bg-accent/10 text-accent-text sm:size-24" aria-hidden="true">
          <CloudSun className="size-10 stroke-[1.35] sm:size-12" />
        </div>
      </div>

      <div className={`mt-5 grid grid-cols-2 gap-2 ${compact ? '' : 'sm:grid-cols-4'}`}>
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
          label={t('field.humidity')}
          value={loading ? null : current ? `${current.relative_humidity_2m}%` : '—'}
          icon={<Gauge className="size-3" aria-hidden="true" />}
        />
        <Readout
          label={t('field.updated')}
          value={loading ? null : current ? formatClock(current.time) : '—'}
          icon={<span aria-hidden="true">◷</span>}
        />
      </div>
    </GlassPanel>
  )
}
