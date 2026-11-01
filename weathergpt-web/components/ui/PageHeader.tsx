'use client'

import type { ReactNode } from 'react'

/** Page title block shared by every inner page. */
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  icon,
}: {
  eyebrow?: string
  title: string
  description?: ReactNode
  actions?: ReactNode
  icon?: ReactNode
}) {
  return (
    <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow && (
          <p className="sky-label flex items-center gap-2 text-accent">
            {icon}
            {eyebrow}
          </p>
        )}
        <h1 className="mt-2 font-hud text-3xl font-bold tracking-tight text-hud sm:text-4xl">{title}</h1>
        {description && <div className="mt-2 max-w-2xl text-sm text-hud-dim">{description}</div>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  )
}
