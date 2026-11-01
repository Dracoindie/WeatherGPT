'use client'

import type { DataState, WeatherResponse } from '@/components/weather/forecastTypes'
import { GlassPanel } from '@/components/panels/GlassPanel'
import { useI18n } from '@/context/I18nContext'
import { formatDay } from '@/lib/format'
import { useDescribeWeather } from '@/lib/i18n/weather'

/**
 * 7-day forecast as a balanced grid of day cards: 2 per row on phones, 4 on
 * tablets, all 7 in one row on wide screens. No horizontal scroller (it
 * widened the mobile layout viewport in Chrome).
 */
export function ForecastPanel({ state }: { state: DataState<WeatherResponse> }) {
  const { status, data, error } = state
  const { t, language } = useI18n()
  const describe = useDescribeWeather()

  let body: React.ReactNode
  if (status === 'loading') {
    body = <p className="text-sm text-hud-dim">{t('forecast.loading')}</p>
  } else if (status === 'error') {
    body = (
      <p className="text-sm text-sev-watch">
        {t('forecast.error')} {error ? <span className="text-hud-dim">({error})</span> : null}
      </p>
    )
  } else if (!data?.forecast?.length) {
    body = <p className="text-sm text-hud-dim">{t('forecast.empty')}</p>
  } else {
    body = (
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7">
        {data.forecast.map((day, i) => (
          // 7 cards, no holes: today spans two columns on 2- and 4-column grids (1+2+2+2, 2+2 / 4).
          <li key={day.date} className={`min-w-0 rounded-xl border border-white/10 bg-black/25 p-3 ${i === 0 && data.forecast.length === 7 ? 'col-span-2 xl:col-span-1' : ''}`}>
            <p className="text-sm font-medium text-hud">{formatDay(day.date, language)}</p>
            <p className="mt-1 font-readout text-sm tabular-nums text-hud">
              {day.temperatureMaxC}° <span className="text-hud-dim">/ {day.temperatureMinC}°</span>
            </p>
            <p data-testid="weather-description" className="mt-0.5 truncate text-xs text-hud-dim" title={describe(day.weatherCode, day.condition) ?? undefined}>
              {describe(day.weatherCode, day.condition)}
            </p>
            <dl className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 font-readout text-[11px] text-hud-dim">
              <div>
                <dt className="sr-only">{t('forecast.rainChance')}</dt>
                <dd>{day.precipitationProbability}%</dd>
              </div>
              <div>
                <dt className="sr-only">{t('field.precipitation')}</dt>
                <dd>{day.precipitationMm} mm</dd>
              </div>
              <div>
                <dt className="sr-only">{t('field.wind')}</dt>
                <dd>{day.windSpeedKmh} km/h</dd>
              </div>
            </dl>
          </li>
        ))}
      </ul>
    )
  }

  return (
    <GlassPanel label={t('forecast.title')} wet={false}>
      {body}
    </GlassPanel>
  )
}
