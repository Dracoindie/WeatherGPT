'use client'

/**
 * The hazard rules from GET /api/alerts/thresholds (backend/thresholds.py).
 * Never hard-code thresholds in the UI: this table, the alert cards, chat
 * advisories, the risk board, push and CAP all come from that one file.
 */

import { useEffect, useState } from 'react'
import { BellRing } from 'lucide-react'
import { fetchThresholds, type ThresholdRule } from '@/lib/api/alerts'
import { useI18n, type TranslationKey } from '@/context/I18nContext'
import { SeverityBadge } from '@/components/ui/SeverityBadge'
import { GlassPanel } from '@/components/panels/GlassPanel'

function rangeText(r: ThresholdRule): string {
  if (r.comparator === 'in') return `WMO ${r.codes.join(', ')}`
  return `${r.comparator === '>=' ? '≥' : '≤'} ${r.value} ${r.unit}`
}

export function ThresholdTable() {
  const { t } = useI18n()
  const [rules, setRules] = useState<ThresholdRule[] | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    fetchThresholds()
      .then(setRules)
      .catch(() => setFailed(true))
  }, [])

  return (
    <GlassPanel label={t('thresholds.title')} aside={<BellRing className="size-3.5 text-accent-text" />}>
      {failed ? (
        <p className="text-sm text-hud-dim">{t('thresholds.unavailable')}</p>
      ) : !rules ? (
        <p className="text-sm text-hud-dim">…</p>
      ) : (
        <table className="w-full text-sm" aria-label={t('thresholds.title')}>
          <tbody>
            {rules.map((r) => (
              <tr key={r.id} className="border-b border-white/5 last:border-0">
                <th scope="row" className="py-2 pr-2 text-left font-normal text-hud">
                  {t(`threshold.${r.id}` as TranslationKey) || r.label}
                  <span className="block text-[11px] text-hud-dim">{r.window}</span>
                </th>
                <td className="py-2 pr-2 text-right font-readout text-hud whitespace-nowrap" data-testid={`threshold-${r.id}`}>
                  {rangeText(r)}
                </td>
                <td className="py-2 text-right">
                  <SeverityBadge level={r.level} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="mt-3 text-[11px] text-hud-dim">{t('thresholds.note')}</p>
    </GlassPanel>
  )
}
