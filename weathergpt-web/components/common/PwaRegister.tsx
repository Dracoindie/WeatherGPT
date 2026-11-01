'use client'

/**
 * Registers the service worker (production builds only, so `next dev` never
 * serves stale chunks) and shows a small "offline" pill while the browser
 * reports no connection.
 */

import { useEffect, useSyncExternalStore } from 'react'
import { WifiOff } from 'lucide-react'

function subscribe(cb: () => void) {
  window.addEventListener('online', cb)
  window.addEventListener('offline', cb)
  return () => {
    window.removeEventListener('online', cb)
    window.removeEventListener('offline', cb)
  }
}

export function useOnline(): boolean {
  return useSyncExternalStore(subscribe, () => navigator.onLine, () => true)
}

export function PwaRegister() {
  const online = useOnline()

  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return
    navigator.serviceWorker
      .register('/sw.js', { scope: '/', updateViaCache: 'none' })
      .then(() => navigator.serviceWorker.ready)
      .then((reg) => {
        // Chunks this page loaded before the worker took control (including
        // dynamic imports) so an offline cold start can hydrate.
        const urls = performance
          .getEntriesByType('resource')
          .map((e) => e.name)
          .filter((u) => new URL(u).origin === location.origin && new URL(u).pathname.startsWith('/_next/static/'))
        reg.active?.postMessage({ type: 'cache-urls', urls })
      })
      .catch(() => {
        // no service worker: the app still works online
      })
  }, [])

  if (online) return null
  return (
    <div
      role="status"
      className="fixed left-1/2 top-2 z-[80] flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-amber-400/50 bg-black/80 px-3 py-1 text-xs text-amber-200 backdrop-blur-md"
    >
      <WifiOff className="size-3.5" />
      Offline — showing saved data
    </div>
  )
}
