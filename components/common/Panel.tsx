'use client'

/**
 * Common panel primitives — ported from Lovable's src/components/common/Panel.tsx.
 */

import { cn } from '@/lib/utils'
import type { HTMLAttributes, ReactNode } from 'react'

interface PanelProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode
}

export function Panel({ className, children, ...props }: PanelProps) {
  return (
    <div
      className={cn(
        'rounded-[16px] bg-panel ring-1 ring-line p-5 sm:p-6',
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
}

export function PanelLabel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        'font-mono text-[11px] uppercase tracking-[0.2em] text-fog',
        className
      )}
    >
      {children}
    </span>
  )
}

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn('animate-pulse rounded bg-line', className)}
      aria-hidden="true"
    />
  )
}

export function StateNote({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={cn('font-body text-xs text-fog', className)}>{children}</p>
  )
}
