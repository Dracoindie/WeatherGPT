'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useReducedMotion } from 'framer-motion'

/** Split into grapheme clusters so Devanagari matras never render detached. */
function graphemes(text: string): string[] {
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    return Array.from(seg.segment(text), (s) => s.segment)
  }
  return Array.from(text)
}

interface TypewriterProps {
  text: string
  /** ms per grapheme */
  speed?: number
  onDone?: () => void
  className?: string
}

export function Typewriter({ text, speed = 16, onDone, className }: TypewriterProps) {
  const reduced = useReducedMotion()
  const parts = useMemo(() => graphemes(text), [text])
  const [count, setCount] = useState(0)
  const doneRef = useRef(onDone)
  useEffect(() => {
    doneRef.current = onDone
  }, [onDone])

  useEffect(() => {
    if (reduced) {
      setCount(parts.length)
      doneRef.current?.()
      return
    }
    setCount(0)
    let i = 0
    const id = window.setInterval(() => {
      i += 1
      setCount(i)
      if (i >= parts.length) {
        window.clearInterval(id)
        doneRef.current?.()
      }
    }, speed)
    return () => window.clearInterval(id)
  }, [parts, speed, reduced])

  const typing = count < parts.length
  return (
    <p className={className} aria-live="polite">
      <span className="sr-only">{text}</span>
      <span aria-hidden="true">
        {parts.slice(0, count).join('')}
        {typing && <span className="sky-caret" />}
      </span>
    </p>
  )
}
