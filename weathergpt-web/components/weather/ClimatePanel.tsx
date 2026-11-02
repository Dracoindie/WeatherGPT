'use client'

/**
 * The last 30 days from the Open-Meteo archive (GET /api/climate): four
 * headline numbers, a temperature chart and a separate rain chart (different
 * units never share an axis), and the full daily table behind a toggle.
 * Every number is computed from the API response.
 */

import { useMemo } from 'react'
import { CloudRain, Thermometer, TrendingDown, TrendingUp } from 'lucide-react'
import type { ClimateResponse } from '@/types/climate'
import { DailyChart } from '@/components/charts/DailyChart'
import { GlassPanel } from '@/components/panels/GlassPanel'
import { fill, useI18n } from '@/context/I18nContext'
import { formatDay } from '@/lib/format'

/** Validated with the dataviz palette script on the dark surface (#0b1220). */
const HIGH = '#d9663a'
const LOW = '#2f8fdc'
const RAIN = '#2a9d8f'

interface ClimatePanelProps {
  data: ClimateResponse | null
  loading: boolean
  error: string | null
}

const nums = (xs: (number | null | undefined)[]) => xs.filter((v): v is number => typeof v === 'number' && !Number.isNaN(v))
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)
const f1 = (v: number | null) => (v == null ? '—' : v.toFixed(1))

function Stat({ icon, label, value, note }: { icon: React.ReactNode; label: string; value: string; note: string }) {
  return (
    <div className="sky-glass min-w-0 p-4">
      <p className="sky-label flex items-center gap-1.5">
        {icon}
        {label}
      </p>
      <p className="mt-2 font-hud text-2xl font-bold tabular-nums text-hud">{value}</p>
      <p className="mt-1 text-xs text-hud-dim">{note}</p>
    </div>
  )
}

export function ClimatePanel({ data, loading, error }: ClimatePanelProps) {
  const { t, language } = useI18n()

  const s = useMemo(() => {
    if (!data?.daily?.length) return null
    const d = data.daily
    const maxes = nums(d.map((r) => r.temperature_max))
    const mins = nums(d.map((r) => r.temperature_min))
    const rain = nums(d.map((r) => r.precipitation_sum))
    const half = Math.floor(d.length / 2)
    const earlier = mean(nums(d.slice(0, half).map((r) => r.temperature_max)))
    const recent = mean(nums(d.slice(d.length - half).map((r) => r.temperature_max)))
    return {
      avgMax: mean(maxes),
      avgMin: mean(mins),
      peak: maxes.length ? Math.max(...maxes) : null,
      lowest: mins.length ? Math.min(...mins) : null,
      total: rain.reduce((a, b) => a + b, 0),
      rainyDays: rain.filter((p) => p > 0.1).length,
      half,
      shift: earlier != null && recent != null && half > 0 ? recent - earlier : null,
    }
  }, [data])

  if (loading) {
    return (
      <div className="sky-glass p-8 text-center">
        <div className="mx-auto size-8 animate-spin rounded-full border-2 border-accent border-t-transparent" />
        <p className="sky-label mt-3">{t('climate.loading')}</p>
      </div>
    )
  }
  if (error) {
    return (
      <div role="alert" className="sky-glass border-sev-watch/40 p-5 text-sm">
        <p className="font-medium text-sev-watch-text">{t('climate.failed')}</p>
        <p className="mt-1 text-xs text-hud-dim">{error}</p>
      </div>
    )
  }
  if (!data || !s) {
    return <div className="sky-glass p-8 text-center text-sm text-hud-dim">{t('climate.empty')}</div>
  }

  const labels = data.daily.map((r) => formatDay(r.date, language))
  // axis: "2 Oct" (weekday dropped so labels never collide); tooltip keeps the full day
  const axis = labels.map((l) => l.replace(/^\S+\s+/, ''))
  const shiftText = s.shift == null ? '—' : `${s.shift > 0 ? '+' : ''}${s.shift.toFixed(1)}°C`

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat icon={<Thermometer className="size-3.5" />} label={t('climate.avgMax')} value={`${f1(s.avgMax)}°C`} note={fill(t('climate.peak'), { v: `${f1(s.peak)}°C` })} />
        <Stat icon={<Thermometer className="size-3.5" />} label={t('climate.avgMin')} value={`${f1(s.avgMin)}°C`} note={fill(t('climate.lowest'), { v: `${f1(s.lowest)}°C` })} />
        <Stat icon={<CloudRain className="size-3.5" />} label={t('climate.rain')} value={`${s.total.toFixed(1)} mm`} note={fill(t('climate.rainyDays'), { n: s.rainyDays })} />
        <Stat
          icon={s.shift != null && s.shift < 0 ? <TrendingDown className="size-3.5" /> : <TrendingUp className="size-3.5" />}
          label={t('climate.shift')}
          value={shiftText}
          note={fill(t('climate.shiftNote'), { n: s.half })}
        />
      </div>

      <GlassPanel wet={false} label={fill(t('climate.source'), { n: data.daily.length, tz: data.timezone })}>
        <div className="grid gap-6 xl:grid-cols-2">
          <DailyChart
            title={t('climate.tempChart')}
            labels={labels}
            axisLabels={axis}
            kind="line"
            unit="°C"
            series={[
              { key: 'max', label: t('climate.high'), color: HIGH, values: data.daily.map((r) => r.temperature_max) },
              { key: 'min', label: t('climate.low'), color: LOW, values: data.daily.map((r) => r.temperature_min) },
            ]}
          />
          <DailyChart
            title={t('climate.rainChart')}
            labels={labels}
            axisLabels={axis}
            kind="bar"
            unit="mm"
            series={[{ key: 'rain', label: t('climate.rain'), color: RAIN, values: data.daily.map((r) => r.precipitation_sum) }]}
          />
        </div>

        <details className="mt-5 border-t border-white/10 pt-4">
          <summary className="sky-label cursor-pointer select-none hover:text-hud">{t('climate.table')}</summary>
          <div className="mt-3 max-h-[420px] overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-[#081020]">
                <tr className="sky-label text-left">
                  <th className="py-2 pr-3 font-normal">{t('climate.date')}</th>
                  <th className="py-2 pr-3 text-right font-normal">{t('climate.high')} (°C)</th>
                  <th className="py-2 pr-3 text-right font-normal">{t('climate.low')} (°C)</th>
                  <th className="py-2 text-right font-normal">{t('climate.rain')} (mm)</th>
                </tr>
              </thead>
              <tbody className="font-readout tabular-nums text-hud">
                {data.daily.map((r) => (
                  <tr key={r.date} className="border-t border-white/5">
                    <td className="py-1.5 pr-3 font-sans text-hud">{formatDay(r.date, language)}</td>
                    <td className="py-1.5 pr-3 text-right">{f1(r.temperature_max ?? null)}</td>
                    <td className="py-1.5 pr-3 text-right">{f1(r.temperature_min ?? null)}</td>
                    <td className="py-1.5 text-right">{f1(r.precipitation_sum ?? null)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </GlassPanel>
    </div>
  )
}
