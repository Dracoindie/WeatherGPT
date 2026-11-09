'use client'

/**
 * Retry after a failure, with exponential backoff, so a "Retry" button never
 * hammers a service that is down (Open-Meteo free tier, the public OSRM
 * server): after the 1st failure it waits 2 s, then 4, 8, 16, at most 30 s.
 * A success resets it.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

export const RETRY_BASE_MS = 2000
export const RETRY_MAX_MS = 30_000

/** Wait before the next retry after `failures` failures in a row. */
export function retryDelay(failures: number): number {
  return failures <= 0 ? 0 : Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** (failures - 1))
}

export function useRetryCooldown() {
  const failures = useRef(0)
  const [readyAt, setReadyAt] = useState(0)
  const [now, setNow] = useState(0)

  const fail = useCallback(() => {
    failures.current += 1
    const t = Date.now()
    setNow(t)
    setReadyAt(t + retryDelay(failures.current))
  }, [])

  const succeed = useCallback(() => {
    failures.current = 0
    setReadyAt(0)
  }, [])

  // tick only while cooling down
  useEffect(() => {
    if (readyAt <= now) return
    const id = window.setInterval(() => setNow(Date.now()), 250)
    return () => window.clearInterval(id)
  }, [readyAt, now])

  /** whole seconds until a retry is allowed (0 = now) */
  const wait = Math.max(0, Math.ceil((readyAt - now) / 1000))
  return { fail, succeed, wait }
}
