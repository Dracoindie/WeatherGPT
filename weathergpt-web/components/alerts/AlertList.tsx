'use client'

import { AlertTriangle, Clock, MapPin, ShieldCheck } from 'lucide-react'
import { SEVERITY_TEXT_VAR, SEVERITY_VAR, SeverityBadge } from '@/components/ui/SeverityBadge'
import { ShareWhatsApp } from '@/components/common/ShareWhatsApp'
import { fill, useI18n, type TranslationKey } from '@/context/I18nContext'
import type { WeatherAlert } from '@/types/alerts'

interface AlertListProps {
  alerts: WeatherAlert[]
  locationName?: string
  loading?: boolean
  error?: string | null
}

/** Short place name: "Pune, Maharashtra, India" -> "Pune". */
export const shortPlace = (name?: string | null) => (name ? name.split(',')[0].trim() : '')

export function AlertList({ alerts, locationName, loading, error }: AlertListProps) {
  const { t } = useI18n()

  if (loading) {
    return (
      <div className="sky-glass p-8 text-center">
        <div className="mx-auto size-8 animate-spin rounded-full border-2 border-accent border-t-transparent" />
        <p className="sky-label mt-3">{t('alerts.loading')}</p>
      </div>
    )
  }

  if (error) {
    return (
      <div role="alert" className="sky-glass border-sev-watch/40 p-5 text-sm">
        <div className="flex items-center gap-2 font-medium text-sev-watch-text">
          <AlertTriangle className="size-4 shrink-0" />
          <span>{t('alerts.failed')}</span>
        </div>
        <p className="mt-1 text-xs text-hud-dim">{error}</p>
      </div>
    )
  }

  if (!alerts || alerts.length === 0) {
    return (
      <div className="sky-glass p-8 text-center">
        <div className="mx-auto grid size-12 place-items-center rounded-2xl bg-sev-none/15 text-sev-none-text">
          <ShieldCheck className="size-6" />
        </div>
        <h3 className="mt-4 font-hud text-lg font-semibold text-hud">{t('alerts.none')}</h3>
        <p className="mx-auto mt-1.5 max-w-md text-sm text-hud-dim">
          {locationName ? fill(t('alerts.noneFor'), { place: shortPlace(locationName) }) : t('alerts.pickFirst')}
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {alerts.map((alert) => {
        const color = SEVERITY_VAR[alert.severity]
        const param = t(`param.${alert.relevant_parameter}` as TranslationKey) || alert.relevant_parameter
        return (
          <article
            key={alert.id}
            className="sky-glass p-5"
            style={{ borderColor: `color-mix(in srgb, ${color} 45%, transparent)`, boxShadow: `0 0 50px -28px ${color}` }}
          >
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-white/10 pb-3.5">
              <div className="flex min-w-0 items-start gap-3">
                <span
                  className="grid size-9 shrink-0 place-items-center rounded-xl"
                  style={{ color: SEVERITY_TEXT_VAR[alert.severity], background: `color-mix(in srgb, ${color} 15%, transparent)` }}
                >
                  <AlertTriangle className="size-4" />
                </span>
                <div className="min-w-0">
                  <h3 className="font-hud text-lg font-semibold text-hud">{alert.condition}</h3>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-hud-dim">
                    {locationName && (
                      <span className="flex items-center gap-1">
                        <MapPin className="size-3 text-accent-text" />
                        {shortPlace(locationName)}
                      </span>
                    )}
                    <span className="flex items-center gap-1">
                      <Clock className="size-3" />
                      {alert.time_window}
                    </span>
                  </div>
                </div>
              </div>
              <SeverityBadge level={alert.severity} />
            </div>

            <p className="mt-3 text-sm font-medium text-hud">{alert.headline}</p>
            <p className="mt-1 text-sm leading-relaxed text-hud-dim">{alert.description}</p>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-white/10 bg-black/25 p-3">
                <span className="sky-label">{t('alerts.threshold')}</span>
                <p className="mt-1 font-readout text-sm text-hud">
                  {param}: <span style={{ color: SEVERITY_TEXT_VAR[alert.severity] }}>{alert.relevant_value} {alert.unit}</span>{' '}
                  <span className="text-hud-dim">(threshold: {alert.threshold_value} {alert.unit})</span>
                </p>
              </div>
              <div className="rounded-xl border border-white/10 bg-black/25 p-3">
                <span className="sky-label">{t('alerts.action')}</span>
                <p className="mt-1 text-sm text-hud-dim">{alert.recommended_action}</p>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <p className="text-[11px] text-hud-dim">Generated by WeatherGPT, not an official IMD warning.</p>
              <ShareWhatsApp
                text={`⚠ ${alert.condition}${locationName ? ` — ${locationName}` : ''}: ${alert.headline}. ${alert.recommended_action}`}
              />
            </div>
          </article>
        )
      })}
    </div>
  )
}
