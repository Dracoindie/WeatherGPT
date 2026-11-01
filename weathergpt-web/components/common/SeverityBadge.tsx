'use client'

/** Kept for existing imports; the one implementation is components/ui/SeverityBadge. */

import { SeverityBadge as Badge, type SeverityLevel } from '@/components/ui/SeverityBadge'

export function SeverityBadge({ severity, className }: { severity: SeverityLevel; className?: string }) {
  return <Badge level={severity} className={className} />
}
