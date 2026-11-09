'use client'

import type { DataState, WeatherResponse } from '@/components/weather/forecastTypes'
import { GlassPanel } from '@/components/panels/GlassPanel'
import { useI18n } from '@/context/I18nContext'
import { formatDay } from '@/lib/format'
import { fillRows } from '@/lib/gridFill'
import { useDescribeWeather } from '@/lib/i18n/weather'
import { cn } from '@/lib/utils'

// Literal class names so Tailwind generates them.
const BASE_SPAN: Record<number, string> = { 1: 'col-span-1', 2: 'col-span-2' }
const SM_SPAN: Record<number, string> = { 1: 'sm:col-span-1', 2: 'sm:col-span-2', 3: 'sm:col-span-3', 4: 'sm:col-span-4' }
const XL_COLS: Record<number, string> = {
  1: 'xl:grid-cols-1',
  2: 'xl:grid-cols-2',
  3: 'xl:grid-cols-3',
  4: 'xl:grid-cols-4',
  5: 'xl:grid-cols-5',
  6: 'xl:grid-cols-6',
  7: 'xl:grid-cols-7',
}

/**
 * The daily forecast as a balanced grid of day cards: 2 per row on phones, 4 on
 * tablets, all days in one row on wide screens, with no holes for any number
 * of days. No horizontal scroller (it widened the mobile layout viewport in
 * Chrome).
 *
 * `side`: on large screens the panel sits in a side column (/map, under
 * Current conditions), so the days become compact rows, one per line.
 */
export function ForecastPanel({ state, side = false }: { state: DataState<WeatherResponse>; side?: boolean }) {
  const { status, data, error } = state
  const { t, language } = useI18n()
  const describe = useDescribeWeather()

  let body: React.ReactNode
  if (status === 'loading') {
    body = <p className="text-sm text-hud-dim">{t('forecast.loading')}</p>
  } else if (status === 'error') {
    body = (
      <p className="text-sm text-sev-watch-text">
        {t('forecast.error')} {error ? <span className="text-hud-dim">({error})</span> : null}
      </p>
    )
  } else if (!data?.forecast?.length) {
    body = <p className="text-sm text-hud-dim">{t('forecast.empty')}</p>
  } else {
    // No holes for any number of days (the API may return fewer than 7):
    // balanced spans on the 2- and 4-column grids, one row of n on wide screens.
    const slots = data.forecast.map((d) => ({ key: d.date, span: 1 }))
    const base = fillRows(slots, 2)
    const sm = fillRows(slots, 4)
    body = (
      <ul
        data-testid="forecast-days"
        className={cn('grid grid-cols-2 gap-2 sm:grid-cols-4', side ? 'lg:grid-cols-1 lg:gap-1.5' : XL_COLS[Math.min(7, data.forecast.length)])}
      >
        {data.forecast.map((day, i) => (
          <li
            key={day.date}
            className={cn(
              `min-w-0 rounded-xl border border-white/10 bg-black/25 p-3 ${BASE_SPAN[base[i]]} ${SM_SPAN[sm[i]]}`,
              side ? 'lg:col-span-1 lg:flex lg:flex-wrap lg:items-baseline lg:gap-x-3 lg:px-3 lg:py-2' : 'xl:col-span-1'
            )}
          >
            <p className={cn('text-sm font-medium text-hud', side && 'lg:w-24 lg:shrink-0')}>{formatDay(day.date, language)}</p>
            <p className={cn('mt-1 font-readout text-sm tabular-nums text-hud', side && 'lg:mt-0 lg:shrink-0')}>
              {day.temperatureMaxC}° <span className="text-hud-dim">/ {day.temperatureMinC}°</span>
            </p>
            <p
              data-testid="weather-description"
              className={cn('mt-0.5 truncate text-xs text-hud-dim', side && 'lg:mt-0 lg:min-w-0 lg:flex-1')}
              title={describe(day.weatherCode, day.condition) ?? undefined}
            >
              {describe(day.weatherCode, day.condition)}
            </p>
            <dl className={cn('mt-2 flex flex-wrap gap-x-3 gap-y-0.5 font-readout text-[11px] text-hud-dim', side && 'lg:mt-0.5 lg:w-full lg:pl-[6.75rem]')}>
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
