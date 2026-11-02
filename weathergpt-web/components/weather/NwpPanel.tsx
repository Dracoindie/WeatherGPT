'use client'

/**
 * NOAA GFS (GET /api/nwp) for the next 12 hours. The API returns wind in m/s;
 * the UI shows km/h everywhere, so it is converted here (msToKmh).
 */

import { useEffect, useState } from 'react'
import { fetchNwp, NwpUnavailableError } from '@/lib/api/nwp'
import type { NwpResponse } from '@/types/nwp'
import { GlassPanel } from '@/components/panels/GlassPanel'
import { fill, useI18n } from '@/context/I18nContext'
import { formatLocalTime, msToKmh, zonedClock } from '@/lib/format'

interface NwpPanelProps {
  latitude: number | undefined
  longitude: number | undefined
  hours?: number
  /** IANA zone of the location (Open-Meteo `timezone`); hours show as local clock times */
  timezone?: string
}

export function NwpPanel({ latitude, longitude, hours = 12, timezone }: NwpPanelProps) {
  const { t, language } = useI18n()
  const [data, setData] = useState<NwpResponse | null>(null)
  const [error, setError] = useState('')
  const [unavailable, setUnavailable] = useState(false)

  useEffect(() => {
    if (latitude === undefined || longitude === undefined) return
    fetchNwp(latitude, longitude)
      .then((resp) => setData(resp))
      .catch((e) => {
        if (e instanceof NwpUnavailableError) setUnavailable(true)
        else setError(e.message)
      })
  }, [latitude, longitude])

  let body: React.ReactNode
  if (unavailable) body = <p className="text-sm text-hud-dim">{t('gfs.unavailable')}</p>
  else if (error) body = <p className="text-sm text-hud-dim">{t('gfs.error')}</p>
  else if (!data) body = <p className="text-sm text-hud-dim">{t('gfs.loading')}</p>
  else {
    const run = data.metadata.generationTime.replace(/\+00:00$|Z$/, '')
    const shown = data.forecasts.slice(0, hours)
    // Valid time = run + lead hour, shown as the location's clock ("17:00");
    // "+3 h" only if the zone is unknown.
    const when = (h: number) => {
      const z = timezone ? zonedClock(data.metadata.generationTime, h, timezone) : null
      return z ? { label: z.clock, title: `${z.full} (${timezone})` } : { label: `+${h} h`, title: undefined }
    }
    body = (
      <>
        <p className="text-xs text-hud-dim" data-testid="gfs-run">
          {fill(t('gfs.run'), { time: formatLocalTime(run, language) })}
          {timezone && <> · {fill(t('gfs.localTimes'), { tz: timezone })}</>}
        </p>
        {/* Phones: one row per hour. Wider screens: hours run left to right. */}
        <table className="mt-3 w-full text-sm md:hidden" aria-label={t('gfs.title')}>
          <thead>
            <tr className="sky-label text-left">
              <th className="pb-2 font-normal">{t('gfs.hour')}</th>
              <th className="pb-2 text-right font-normal">°C</th>
              <th className="pb-2 text-right font-normal">mm</th>
              <th className="pb-2 text-right font-normal">km/h</th>
            </tr>
          </thead>
          <tbody className="font-readout tabular-nums text-hud">
            {shown.map((f) => (
              <tr key={f.hour} className="border-t border-white/5">
                <td className="py-1.5 text-hud-dim" title={when(f.hour).title}>{when(f.hour).label}</td>
                <td className="py-1.5 text-right">{f.temperatureC.toFixed(1)}</td>
                <td className="py-1.5 text-right">{f.precipitationMm.toFixed(1)}</td>
                <td className="py-1.5 text-right">{msToKmh(f.windMs).toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-3 hidden overflow-x-auto md:block">
          <table className="w-full min-w-[720px] text-sm" aria-label={t('gfs.title')}>
            <tbody className="font-readout tabular-nums">
              <tr>
                <th scope="row" className="sky-label w-28 py-1.5 pr-3 text-left font-normal">{t('gfs.hour')}</th>
                {shown.map((f) => (
                  <td key={f.hour} className="whitespace-nowrap px-1 py-1.5 text-center text-hud-dim" title={when(f.hour).title}>
                    {when(f.hour).label}
                  </td>
                ))}
              </tr>
              <tr className="border-t border-white/5">
                <th scope="row" className="sky-label py-1.5 pr-3 text-left font-normal">{t('gfs.temp')} (°C)</th>
                {shown.map((f) => (
                  <td key={f.hour} className="whitespace-nowrap px-1 py-1.5 text-center text-hud">{f.temperatureC.toFixed(1)}</td>
                ))}
              </tr>
              <tr className="border-t border-white/5">
                <th scope="row" className="sky-label py-1.5 pr-3 text-left font-normal">{t('gfs.rain')} (mm)</th>
                {shown.map((f) => (
                  <td key={f.hour} className="whitespace-nowrap px-1 py-1.5 text-center text-hud">{f.precipitationMm.toFixed(1)}</td>
                ))}
              </tr>
              <tr className="border-t border-white/5">
                <th scope="row" className="sky-label py-1.5 pr-3 text-left font-normal">{t('gfs.wind')} (km/h)</th>
                {shown.map((f) => (
                  <td key={f.hour} className="whitespace-nowrap px-1 py-1.5 text-center text-hud">{msToKmh(f.windMs).toFixed(1)}</td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-[11px] text-hud-dim">{t('gfs.note')}</p>
      </>
    )
  }

  return (
    <GlassPanel label={t('gfs.title')} wet={false} className="h-full">
      {body}
    </GlassPanel>
  )
}
