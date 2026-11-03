'use client'

/**
 * Glass card for a tapped map point. Every number is from GET /api/map/point;
 * nothing is computed here except unit-free formatting.
 */

import { Navigation, X } from 'lucide-react'
import { askHref } from '@/components/console/AskCard'
import { AQI_LABEL, UV_LABEL } from '@/components/panels/AirPanels'
import { SkyLinkButton } from '@/components/ui/SkyButton'
import { fill, useI18n, type TranslationKey } from '@/context/I18nContext'
import type { MapPoint } from '@/lib/api/map'
import { formatLocalTime } from '@/lib/format'
import { useDescribeWeather } from '@/lib/i18n/weather'
import { cn } from '@/lib/utils'
import { compass } from './field'

export type PointState =
  | { status: 'loading'; latitude: number; longitude: number }
  | { status: 'ready'; latitude: number; longitude: number; data: MapPoint }
  | { status: 'error'; latitude: number; longitude: number }

const num = (v: number | null | undefined, digits = 1) => (v == null ? '—' : String(Math.round(v * 10 ** digits) / 10 ** digits))

function Row({ label, value, sub, testId }: { label: string; value: string; sub?: string; testId?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] uppercase tracking-wide text-hud-dim">{label}</dt>
      <dd className="font-readout text-base text-hud" data-testid={testId}>
        {value}
        {sub && <span className="ml-1 font-skybody text-xs text-hud-dim">{sub}</span>}
      </dd>
    </div>
  )
}

export function MapPointCard({ point, onClose, className }: { point: PointState; onClose: () => void; className?: string }) {
  const { t } = useI18n()
  const coords = `${point.latitude.toFixed(3)}°, ${point.longitude.toFixed(3)}°`

  return (
    <section
      className={cn('sky-glass map-overlay p-4', className)}
      data-testid="map-point-card"
      aria-live="polite"
      aria-label={t('map.point.title')}
    >
      <header className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="sky-label">{t('map.point.title')}</h3>
          <p className="font-readout text-xs text-hud-dim">{coords}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-full p-1.5 text-hud-dim hover:bg-white/10 hover:text-hud"
          aria-label={t('map.point.close')}
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </header>

      {point.status === 'loading' && <p className="text-sm text-hud-dim">{t('map.point.loading')}</p>}
      {point.status === 'error' && <p className="text-sm text-hud">{t('map.point.error')}</p>}
      {point.status === 'ready' && <PointBody data={point.data} />}
    </section>
  )
}

function PointBody({ data }: { data: MapPoint }) {
  const { t, language } = useI18n()
  const describe = useDescribeWeather()
  const dir = compass(data.wind_direction_deg)
  const band = data.heat_band
  return (
    <>
      <p className="mb-3 flex items-baseline gap-2">
        <span className="font-hud text-4xl text-hud" data-testid="map-point-temp">
          {num(data.temperature_c)}°C
        </span>
        <span className="text-sm text-hud-dim">{describe(data.weather_code) ?? ''}</span>
      </p>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5">
        <Row label={t('map.point.feels')} value={data.feels_like_c == null ? '—' : `${num(data.feels_like_c)}°C`} testId="map-point-feels" />
        <Row label={t('map.point.humidity')} value={`${num(data.humidity_pct, 0)}%`} testId="map-point-humidity" />
        <div className="min-w-0">
          <dt className="text-[11px] uppercase tracking-wide text-hud-dim">{t('map.point.wind')}</dt>
          <dd className="flex items-center gap-1.5 font-readout text-base text-hud" data-testid="map-point-wind">
            {/* the arrow points where the wind blows TO */}
            <Navigation
              className="h-3.5 w-3.5 shrink-0 text-accent-text"
              style={{ transform: `rotate(${data.wind_direction_deg + 180}deg)` }}
              aria-hidden
            />
            {num(data.wind_speed_kmh)} km/h
          </dd>
          <dd className="text-xs text-hud-dim">
            {fill(t('map.point.windFrom'), { dir: t(`map.dir.${dir}` as TranslationKey) })} · {num(data.wind_direction_deg, 0)}°
          </dd>
        </div>
        <Row
          label={t('map.point.rain')}
          value={data.precipitation_probability_pct == null ? '—' : `${num(data.precipitation_probability_pct, 0)}%`}
          testId="map-point-rain"
        />
        <Row
          label={t('map.point.aqi')}
          value={num(data.aqi, 0)}
          sub={data.aqi_category ? AQI_LABEL[data.aqi_category][language] : undefined}
          testId="map-point-aqi"
        />
        <Row
          label={t('map.point.uv')}
          value={num(data.uv_index)}
          sub={data.uv_category ? UV_LABEL[data.uv_category][language] : undefined}
          testId="map-point-uv"
        />
        <Row label={t('map.point.local')} value={formatLocalTime(data.local_time, language)} testId="map-point-time" />
        {band && (
          <Row
            label={t('map.point.heat')}
            value={data.heat_index_c == null ? '—' : `${num(data.heat_index_c)}°C`}
            sub={t(`map.heat.${band}` as TranslationKey)}
            testId="map-point-heat"
          />
        )}
      </dl>
      {band && <p className="mt-2 text-xs text-hud">{t(`map.heatAdvice.${band}` as TranslationKey)}</p>}
      <p className="mt-3 text-[11px] leading-snug text-hud-dim">{fill(t('map.point.cell'), { km: data.model_grid_km })}</p>
      <SkyLinkButton
        href={askHref(t('ask.q.now'), { latitude: data.latitude, longitude: data.longitude })}
        variant="subtle"
        className="mt-3 w-full justify-center"
      >
        {t('map.point.ask')}
      </SkyLinkButton>
    </>
  )
}
