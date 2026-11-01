'use client'

/**
 * Trust strip — shows data source attribution.
 * Ported from Lovable's src/components/common/TrustStrip.tsx.
 */

import { useI18n } from '@/context/I18nContext'

export function TrustStrip() {
  const { t } = useI18n()
  return (
    <p className="flex items-center gap-2 px-1">
      <span className="size-1.5 rounded-full bg-sev-none" aria-hidden="true" />
      <span className="sky-label">{t('trust.source')}</span>
    </p>
  )
}
