'use client'

/**
 * "Replay: recorded data from <time>", shown on every page whenever a backend
 * answer came from the demo fixtures (DEMO_REPLAY=1, see docs/DEMO.md).
 */

import { History } from 'lucide-react'
import { useI18n, fill, type Language } from '@/context/I18nContext'
import { useReplayRecordedAt } from '@/lib/replay'

const LOCALE: Record<Language, string> = { en: 'en-IN', hi: 'hi-IN', hinglish: 'en-IN', mr: 'mr-IN' }

export function ReplayBadge() {
  const recordedAt = useReplayRecordedAt()
  const { t, language } = useI18n()
  if (!recordedAt) return null
  const when = new Date(recordedAt)
  const label = Number.isNaN(when.getTime())
    ? recordedAt
    : when.toLocaleString(LOCALE[language], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
  return (
    <div
      role="status"
      data-testid="replay-badge"
      title={t('replay.tooltip')}
      className="pointer-events-auto fixed left-1/2 top-[4.5rem] z-50 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-2 rounded-full border border-sev-advisory bg-black/70 px-3 py-1 text-xs text-sev-advisory-text shadow-lg backdrop-blur max-lg:top-3"
    >
      <History className="size-3.5 shrink-0" aria-hidden="true" />
      <span>{fill(t('replay.badge'), { time: label })}</span>
    </div>
  )
}
