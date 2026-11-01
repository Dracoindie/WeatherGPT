'use client'

/**
 * One severity badge for every surface. Colours come from the --sev-* tokens
 * in globals.css. Alert levels (advisory / watch / warning) and chat advisory
 * levels (low / moderate / high) map onto the same palette.
 */

import { cn } from '@/lib/utils'
import { useI18n, type TranslationKey } from '@/context/I18nContext'

export type SeverityLevel = 'none' | 'unknown' | 'advisory' | 'watch' | 'warning' | 'low' | 'moderate' | 'high'

/** CSS colour variable for a level (for dots, borders, map markers). */
export const SEVERITY_VAR: Record<SeverityLevel, string> = {
  none: 'var(--sev-none)',
  unknown: 'var(--sev-unknown)',
  advisory: 'var(--sev-advisory)',
  watch: 'var(--sev-watch)',
  warning: 'var(--sev-warning)',
  low: 'var(--sev-advisory)',
  moderate: 'var(--sev-watch)',
  high: 'var(--sev-warning)',
}

export function SeverityBadge({ level, className, label }: { level: SeverityLevel; className?: string; label?: string }) {
  const { t } = useI18n()
  const color = SEVERITY_VAR[level]
  return (
    <span
      data-severity={level}
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 font-readout text-[10px] uppercase tracking-[0.16em]',
        (level === 'warning' || level === 'high') && 'font-semibold',
        className
      )}
      style={{ color, borderColor: `color-mix(in srgb, ${color} 55%, transparent)`, background: `color-mix(in srgb, ${color} 12%, transparent)` }}
    >
      <span aria-hidden="true" className="size-1.5 rounded-full" style={{ background: color }} />
      {label ?? t(`severity.${level}` as TranslationKey)}
    </span>
  )
}
