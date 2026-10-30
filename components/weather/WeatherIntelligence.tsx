'use client'

/**
 * WeatherIntelligence — adapted from Lovable.
 * Renders the deterministic AdvisoryResult returned in the /api/chat response.
 * Never invents advisory content — shows placeholder when advisory is null.
 */

import { SeverityBadge } from '@/components/common/SeverityBadge'
import { useI18n } from '@/context/I18nContext'
import { BrainCircuit, CheckCircle2 } from 'lucide-react'

export interface AdvisoryResult {
  severity: 'low' | 'moderate' | 'high'
  condition: string
  advisory: string
  reasons: string[]
}

interface WeatherIntelligenceProps {
  advisory?: AdvisoryResult | null
}

export function WeatherIntelligence({ advisory }: WeatherIntelligenceProps) {
  const { t } = useI18n()

  return (
    <section
      className="rounded-[16px] bg-ink p-5 shadow-[0_16px_40px_-28px_rgba(0,0,0,0.8)] ring-1 ring-ink sm:p-6"
      aria-label={t('intel.title')}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-fog">
          {t('intel.title')}
        </span>
        {advisory ? (
          <SeverityBadge severity={advisory.severity} />
        ) : (
          <span className="rounded-full border border-dashed border-panel/25 px-2.5 py-0.5 font-mono text-[11px] uppercase tracking-wide text-fog">
            —
          </span>
        )}
      </div>

      <div className="mt-5 flex gap-4">
        <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-panel/10 text-teal" aria-hidden="true">
          {advisory ? <BrainCircuit className="size-5" /> : <CheckCircle2 className="size-5" />}
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-lg font-semibold tracking-tight text-panel text-balance">
            {advisory?.condition ?? t('intel.empty')}
          </h2>

          <div className="mt-3">
            <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-fog">
              {t('intel.why')}
            </p>
            <ul className="mt-1.5 space-y-1.5">
              {(advisory?.reasons ?? ['Conditions appear routine for this location.']).map((reason, i) => (
                <li key={i} className="flex gap-2 font-body text-sm text-panel/75 text-pretty">
                  <span aria-hidden="true" className="mt-2 size-1 shrink-0 rounded-full bg-teal" />
                  {reason}
                </li>
              ))}
            </ul>
          </div>

          <div className="mt-3 rounded-[10px] bg-panel/10 p-3 ring-1 ring-panel/15">
            <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-fog">
              {t('intel.action')}
            </p>
            <p className="mt-1 font-body text-sm text-panel/85 text-pretty">
              {advisory?.advisory ?? 'No action is recommended at this time.'}
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}
