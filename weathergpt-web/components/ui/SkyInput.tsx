'use client'

import { forwardRef, type InputHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

/** Text input in the Living Sky style. */
export const SkyInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function SkyInput(
  { className, ...props },
  ref
) {
  return <input ref={ref} className={cn('sky-input', className)} {...props} />
})

export function SkyField({ label, htmlFor, children }: { label: string; htmlFor: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="sky-label mb-1.5 block">
        {label}
      </label>
      {children}
    </div>
  )
}
