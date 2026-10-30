'use client'

import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface GlassPanelProps {
  children: ReactNode
  className?: string
  label?: ReactNode
  aside?: ReactNode
}

/** Dark frosted-glass HUD panel used across the Living Sky home. */
export function GlassPanel({ children, className, label, aside }: GlassPanelProps) {
  return (
    <section className={cn('sky-glass p-4 sm:p-5', className)}>
      {(label || aside) && (
        <header className="mb-3 flex items-center justify-between gap-3">
          {label && <h3 className="sky-label">{label}</h3>}
          {aside}
        </header>
      )}
      {children}
    </section>
  )
}
