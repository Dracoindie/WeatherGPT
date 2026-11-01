'use client'

/**
 * Trust strip — shows data source attribution.
 * Ported from Lovable's src/components/common/TrustStrip.tsx.
 */

import { useI18n } from '@/context/I18nContext'

export function TrustStrip() {
  const { t } = useI18n()
  return (
    <div className="flex items-center gap-2 rounded-[10px] border border-line/70 bg-panel px-3 py-2">
      <span className="size-1.5 rounded-full bg-teal" aria-hidden="true" />
      <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-fog">
        {t('trust.source')}
      </span>
    </div>
  )
}
