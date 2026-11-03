'use client'

/**
 * The one page shell. Every route renders inside it, so every page has the
 * same Living Sky look, the same nav (SkyNav) and the same bottom nav.
 *
 * Inner pages get the lightweight static sky (CSS, no WebGL) driven by the
 * current weather they load: call useSkyFromCurrent(weather). The home page
 * passes its own animated background.
 */

import { useEffect, type ReactNode } from 'react'
import { SkyNav } from '@/components/console/SkyNav'
import { StaticSky } from '@/components/sky/StaticSky'
import { ReplayBadge } from '@/components/ui/ReplayBadge'
import { sky } from '@/lib/skyStore'
import { localHour, sceneFromCode } from '@/lib/weatherScene'
import { cn } from '@/lib/utils'

interface AppShellProps {
  children: ReactNode
  /** Replaces the static sky (the home page's WebGL engine). */
  background?: ReactNode
  /** Accent follows severity like on the home page. */
  severity?: 'low' | 'moderate' | 'high'
  /** Extra layers above the sky but outside <main> (HUDs, demo panel). */
  overlay?: ReactNode
  /** Hide the nav (e.g. a focused flow). */
  bare?: boolean
  mainClassName?: string
}

export function AppShell({ children, background, severity = 'low', overlay, bare = false, mainClassName }: AppShellProps) {
  return (
    <div className="sky-root flex min-h-dvh flex-col" data-severity={severity}>
      {background ?? <StaticSky />}
      {overlay}
      {!bare && <SkyNav />}
      <ReplayBadge />
      <main
        className={cn(
          'relative z-10 mx-auto w-full max-w-[1400px] flex-1 px-4 pb-16 pt-4 sm:px-6 lg:pt-6',
          'max-lg:pb-[calc(5.5rem+env(safe-area-inset-bottom))]',
          mainClassName
        )}
      >
        {children}
      </main>
    </div>
  )
}

/** Drive the static sky from current conditions (code, local hour, wind, rain). */
export function useSkyFromCurrent(
  current: { weather_code?: number | null; wind_speed_10m?: number | null; precipitation?: number | null } | null | undefined,
  timezone?: string | null
) {
  const code = current?.weather_code
  const wind = current?.wind_speed_10m ?? 0
  const rain = current?.precipitation ?? 0
  useEffect(() => {
    if (code == null) return
    sky.setData(sceneFromCode(code, localHour(timezone), wind, rain))
  }, [code, wind, rain, timezone])
}
