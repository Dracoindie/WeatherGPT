'use client'

import { useEffect, useRef, useState } from 'react'
import { animate, useReducedMotion } from 'framer-motion'

/** Decimal places the API used (backend rounds to ≤ 1 dp). */
export function decimalsOf(value: number): number {
  const s = String(value)
  const i = s.indexOf('.')
  return i === -1 ? 0 : Math.min(2, s.length - i - 1)
}

export function formatValue(value: number): string {
  return value.toFixed(decimalsOf(value))
}

interface CountUpProps {
  value: number
  className?: string
  duration?: number
}

/**
 * Animated readout. Intermediate frames are transitional; the settled text is
 * always exactly the API value with the API's own precision.
 */
export function CountUp({ value, className, duration = 1.1 }: CountUpProps) {
  const reduced = useReducedMotion()
  const decimals = decimalsOf(value)
  const [shown, setShown] = useState(0)
  const from = useRef(0)

  useEffect(() => {
    if (reduced) return
    const controls = animate(from.current, value, {
      duration,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => setShown(v),
      onComplete: () => setShown(value),
    })
    from.current = value
    return () => controls.stop()
  }, [value, duration, reduced])

  const display = reduced || shown === value ? formatValue(value) : shown.toFixed(decimals)
  return (
    <span className={className}>
      <span className="sr-only">{formatValue(value)}</span>
      <span aria-hidden="true">{display}</span>
    </span>
  )
}
