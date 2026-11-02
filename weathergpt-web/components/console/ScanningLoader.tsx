'use client'

import { useEffect, useState } from 'react'
import { useI18n } from '@/context/I18nContext'

// Pipeline stages shown while waiting — these mirror the backend flow, not data.
const STREAM = [
  'PARSE   intent · language · date_reference',
  'GEOCODE nominatim → lat/lon',
  'FETCH   open-meteo /v1/forecast',
  'VALIDATE pydantic → WeatherFacts',
  'EVALUATE advisory thresholds',
  'GROUND  numeric check vs facts',
]

export function ScanningLoader() {
  const { t } = useI18n()
  const [line, setLine] = useState(0)

  useEffect(() => {
    const id = window.setInterval(() => setLine((l) => (l + 1) % (STREAM.length + 2)), 420)
    return () => window.clearInterval(id)
  }, [])

  return (
    <div className="flex items-center gap-5" role="status" aria-live="polite">
      <div className="sky-radar size-20 shrink-0">
        <span className="absolute left-1/2 top-1/2 size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent shadow-[0_0_10px_var(--sky-accent)]" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="font-hud text-sm font-semibold uppercase tracking-[0.25em] text-accent-text">
          {t('sky.scanning')}
          <span className="sky-caret" />
        </p>
        <ul className="mt-2 space-y-0.5 font-readout text-[11px] text-hud-dim">
          {STREAM.slice(0, Math.min(line, STREAM.length)).slice(-3).map((s) => (
            <li key={s} className="truncate">
              <span className="text-accent-text/80">›</span> {s}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
