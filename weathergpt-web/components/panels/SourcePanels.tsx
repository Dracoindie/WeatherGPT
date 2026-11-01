'use client'

/**
 * Panels for the non-forecast chat sources. Every number is a field of the
 * API's ClimateFacts / NwpFacts; nothing is derived here except signs.
 */

import { motion } from 'framer-motion'
import { Cpu, History } from 'lucide-react'
import type { ClimateFacts, NwpFacts } from '@/lib/api/chat'
import { useI18n } from '@/context/I18nContext'
import { cn } from '@/lib/utils'
import { formatValue } from './CountUp'
import { GlassPanel } from './GlassPanel'
import { panelItem } from './WeatherPanels'

function Row({ label, now, usual, unit }: { label: string; now: number | null; usual: number | null; unit: string }) {
  if (now == null) return null
  return (
    <div className="grid grid-cols-[1fr_auto_auto] items-baseline gap-3 border-b border-white/5 py-2 last:border-0">
      <dt className="text-sm text-hud-dim">{label}</dt>
      <dd className="font-hud text-xl font-semibold text-hud">
        {formatValue(now)}
        <span className="ml-0.5 font-readout text-xs text-hud-dim">{unit}</span>
      </dd>
      <dd className="w-28 whitespace-nowrap text-right font-readout text-xs text-hud-dim">
        {usual != null ? `usual ${formatValue(usual)}${unit}` : ''}
      </dd>
    </div>
  )
}

function Delta({ value, unit, warmIsUp = true }: { value: number | null; unit: string; warmIsUp?: boolean }) {
  if (value == null) return null
  const up = value > 0
  const tone = value === 0 ? 'text-hud-dim' : up === warmIsUp ? 'text-orange-300' : 'text-sky-300'
  return (
    <span className={cn('font-readout text-xs', tone)}>
      {up ? '+' : value < 0 ? '−' : '±'}
      {formatValue(Math.abs(value))}
      {unit}
    </span>
  )
}

export function ClimateComparePanel({ facts }: { facts: ClimateFacts }) {
  const { t } = useI18n()
  return (
    <motion.div variants={panelItem} className="sm:col-span-2">
      <GlassPanel label={t('panel.climate')} className="h-full" aside={<History className="size-4 text-accent" />}>
        {!facts.available ? (
          <p className="text-sm text-hud-dim">Not enough archive data to compare with past years.</p>
        ) : (
          <>
            <p className="font-readout text-[11px] uppercase tracking-[0.16em] text-hud-dim">
              {facts.period_start} → {facts.period_end} · vs {facts.baseline_start_year}–{facts.baseline_end_year}
            </p>
            <dl className="mt-2">
              <Row label="Avg daily high" now={facts.mean_temperature_max} usual={facts.baseline_mean_temperature_max} unit="°C" />
              <Row label="Avg daily low" now={facts.mean_temperature_min} usual={facts.baseline_mean_temperature_min} unit="°C" />
              <Row label="Rainfall" now={facts.total_precipitation} usual={facts.baseline_total_precipitation} unit=" mm" />
            </dl>
            <p className="mt-3 flex flex-wrap gap-3">
              <Delta value={facts.temperature_max_anomaly} unit="°C high" />
              <Delta value={facts.temperature_min_anomaly} unit="°C low" />
              {facts.precipitation_anomaly_percent != null && (
                <Delta value={facts.precipitation_anomaly_percent} unit="% rain" warmIsUp={false} />
              )}
            </p>
            <p className="mt-2 text-[11px] text-hud-dim">
              Open-Meteo archive · {facts.days_with_data} days · {facts.baseline_years} baseline years
            </p>
          </>
        )}
      </GlassPanel>
    </motion.div>
  )
}

/** A missing model value shows as a dash, never as a made-up number. */
const fmt = (v: number | null) => (v == null ? '—' : formatValue(v))

export function GfsPanel({ facts }: { facts: NwpFacts }) {
  const { t } = useI18n()
  const run = new Date(facts.run)
  return (
    <motion.div variants={panelItem} className="sm:col-span-2 xl:col-span-1">
      <GlassPanel label={t('panel.gfs')} className="h-full" aside={<Cpu className="size-4 text-accent" />}>
        {!facts.period_available ? (
          <p className="text-sm text-hud-dim">This window is beyond the 48-hour GFS output used here.</p>
        ) : (
          <>
            <dl className="grid grid-cols-3 gap-3">
              <div>
                <dt className="font-readout text-[10px] uppercase tracking-[0.18em] text-hud-dim">Temp</dt>
                <dd className="font-hud text-lg font-semibold">
                  {fmt(facts.temperature_min)}–{fmt(facts.temperature_max)}°
                </dd>
              </div>
              <div>
                <dt className="font-readout text-[10px] uppercase tracking-[0.18em] text-hud-dim">Rain</dt>
                <dd className="font-hud text-lg font-semibold">
                  {fmt(facts.precipitation)}
                  <span className="ml-0.5 text-xs text-hud-dim">mm</span>
                </dd>
              </div>
              <div>
                <dt className="font-readout text-[10px] uppercase tracking-[0.18em] text-hud-dim">Wind max</dt>
                <dd className="font-hud text-lg font-semibold">
                  {fmt(facts.wind_speed_max)}
                  <span className="ml-0.5 text-xs text-hud-dim">km/h</span>
                </dd>
              </div>
            </dl>
            <p className="mt-3 text-[11px] text-hud-dim">
              Run {Number.isNaN(run.getTime()) ? facts.run : run.toISOString().slice(0, 13).replace('T', ' ') + ':00 UTC'} ·{' '}
              {facts.hours} h · raw model output, not an official forecast
            </p>
          </>
        )}
      </GlassPanel>
    </motion.div>
  )
}
