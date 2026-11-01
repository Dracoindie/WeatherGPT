'use client'

import Link from 'next/link'
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from 'react'
import { cn } from '@/lib/utils'

type Variant = 'primary' | 'ghost' | 'subtle'

const cls = (variant: Variant, className?: string) => cn('sky-btn', `sky-btn-${variant}`, className)

/** Pill button in the Living Sky style. */
export function SkyButton({
  variant = 'ghost',
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return <button type="button" className={cls(variant, className)} {...props} />
}

/** Same look, as a link (internal routes use next/link). */
export function SkyLinkButton({
  href,
  variant = 'ghost',
  className,
  children,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; variant?: Variant; children: ReactNode }) {
  if (href.startsWith('/')) {
    return (
      <Link href={href} className={cls(variant, className)} {...props}>
        {children}
      </Link>
    )
  }
  return (
    <a href={href} className={cls(variant, className)} {...props}>
      {children}
    </a>
  )
}
