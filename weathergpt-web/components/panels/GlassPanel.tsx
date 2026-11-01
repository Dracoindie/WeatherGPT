'use client'

import { forwardRef, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { RainGlass } from './RainGlass'

interface GlassPanelProps {
  children: ReactNode
  className?: string
  label?: ReactNode
  aside?: ReactNode
  /** rain-on-glass droplets when it is raining (default on) */
  wet?: boolean
}

/** Dark frosted-glass HUD panel used across the Living Sky home. */
export const GlassPanel = forwardRef<HTMLElement, GlassPanelProps>(function GlassPanel(
  { children, className, label, aside, wet = true },
  ref
) {
  return (
    <section ref={ref} className={cn('sky-glass p-4 sm:p-5', className)}>
      {wet && <RainGlass />}
      {(label || aside) && (
        <header className="mb-3 flex items-center justify-between gap-3">
          {label && <h3 className="sky-label">{label}</h3>}
          {aside}
        </header>
      )}
      {children}
    </section>
  )
})
