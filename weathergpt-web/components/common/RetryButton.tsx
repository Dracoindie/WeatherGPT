'use client'

import { RotateCw } from 'lucide-react'
import { SkyButton } from '@/components/ui/SkyButton'
import { fill, useI18n } from '@/context/I18nContext'

/** "Retry", disabled with a countdown while the backoff runs (lib/retryCooldown.ts). */
export function RetryButton({ wait, onRetry, testId, className }: { wait: number; onRetry: () => void; testId?: string; className?: string }) {
  const { t } = useI18n()
  return (
    <SkyButton variant="ghost" className={className} disabled={wait > 0} onClick={onRetry} data-testid={testId} data-wait={wait}>
      <RotateCw className="h-3.5 w-3.5" aria-hidden />
      {wait > 0 ? fill(t('common.retryIn'), { s: wait }) : t('banner.retry')}
    </SkyButton>
  )
}
