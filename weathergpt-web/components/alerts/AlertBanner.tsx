'use client'

import Link from 'next/link'
import { AlertTriangle, ChevronRight, ShieldCheck } from 'lucide-react'
import { SeverityBadge } from '@/components/common/SeverityBadge'
import type { WeatherAlert } from '@/types/alerts'

interface AlertBannerProps {
  alerts: WeatherAlert[]
  locationName?: string
  loading?: boolean
}

export function AlertBanner({ alerts, locationName, loading }: AlertBannerProps) {
  if (loading) return null

  if (!alerts || alerts.length === 0) {
    return (
      <div className="flex items-center justify-between rounded-[12px] border border-line bg-panel px-4 py-2.5 text-xs text-ink-soft">
        <div className="flex items-center gap-2">
          <ShieldCheck className="size-4 text-teal" />
          <span>No active weather alerts for {locationName ?? 'current location'}. Conditions normal.</span>
        </div>
        <Link href="/alerts" className="font-mono text-[11px] text-teal hover:underline inline-flex items-center gap-1">
          Details <ChevronRight className="size-3" />
        </Link>
      </div>
    )
  }

  const topAlert = alerts[0]

  return (
    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 rounded-[12px] border border-coral/40 bg-coral-soft px-4 py-3 text-ink">
      <div className="flex items-center gap-3">
        <span className="grid size-7 place-items-center rounded-lg bg-coral text-panel shrink-0">
          <AlertTriangle className="size-4" />
        </span>
        <div>
          <div className="flex items-center gap-2">
            <span className="font-display text-xs font-semibold text-ink">
              {topAlert.condition}
            </span>
            <SeverityBadge severity={topAlert.severity} />
          </div>
          <p className="text-xs text-ink-soft line-clamp-1">
            {topAlert.headline}
          </p>
        </div>
      </div>

      <Link
        href="/alerts"
        className="shrink-0 inline-flex items-center gap-1 rounded-full bg-ink px-3 py-1 font-mono text-[11px] text-panel hover:bg-ink/90 transition-colors"
      >
        View {alerts.length} Alert{alerts.length > 1 ? 's' : ''} <ChevronRight className="size-3" />
      </Link>
    </div>
  )
}
