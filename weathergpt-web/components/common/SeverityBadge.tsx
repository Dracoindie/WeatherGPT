'use client'

/**
 * Severity badge — ported from Lovable's src/components/common/SeverityBadge.tsx.
 */

import { cn } from '@/lib/utils'
import { useI18n } from '@/context/I18nContext'

type Severity = 'low' | 'moderate' | 'high' | 'advisory' | 'watch' | 'warning'

const severityStyles: Record<Severity, string> = {
  low: 'bg-teal-soft text-teal',
  moderate: 'bg-amber-soft text-amber',
  high: 'bg-coral-soft text-coral',
  advisory: 'bg-teal-soft text-teal border border-teal/20',
  watch: 'bg-amber-soft text-amber border border-amber/30',
  warning: 'bg-coral-soft text-coral border border-coral/40 font-semibold',
}

interface SeverityBadgeProps {
  severity: Severity
  className?: string
}

export function SeverityBadge({ severity, className }: SeverityBadgeProps) {
  const { t } = useI18n()
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 font-mono text-[11px] font-medium uppercase tracking-wide',
        severityStyles[severity],
        className
      )}
    >
      {t(`severity.${severity}` as 'severity.low' | 'severity.moderate' | 'severity.high')}
    </span>
  )
}
