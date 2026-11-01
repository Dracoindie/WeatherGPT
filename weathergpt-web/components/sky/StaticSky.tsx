'use client'

/**
 * CSS-only sky: the background of every inner page, the reduced-motion / lite
 * fallback on the home page, and the backdrop while WebGL loads. Same palette
 * as the shader sky.
 *
 * It covers the whole page, not just the first screen: the sky fills the top
 * 100vh, then fades into --sky-floor (a darkened horizon colour) that the page
 * background also uses, so long pages never end in a hard seam.
 */

import { useEffect } from 'react'
import { skyPalette, toCss, type RGB } from '@/lib/weatherScene'
import { useSky } from '@/lib/skyStore'

const darken = (c: RGB, k: number): RGB => [c[0] * k, c[1] * k, c[2] * k]

export function StaticSky() {
  const { target } = useSky()
  const p = skyPalette(target)
  const wet = Math.max(target.rain, target.snow, target.fog)
  const floor = toCss(darken(p.bottom, 0.28))

  useEffect(() => {
    document.documentElement.style.setProperty('--sky-floor', floor)
  }, [floor])

  return (
    <div
      aria-hidden="true"
      data-testid="static-sky"
      className="pointer-events-none absolute inset-0 -z-10 overflow-hidden transition-[background] duration-[1500ms]"
      style={{
        background: `
          radial-gradient(120vw 70vh at 70% ${p.sunElevation > 0 ? 18 : 110}vh, ${toCss(p.bottom, 0.55)}, transparent 60%),
          linear-gradient(180deg, ${toCss(p.top)} 0, ${toCss(p.bottom)} 100vh, ${floor} 150vh, ${floor} 100%)`,
      }}
    >
      <div
        className="absolute inset-x-0 top-0 h-[150vh]"
        style={{
          background: `linear-gradient(180deg, rgba(120,130,150,${(target.cloudCover * 0.25).toFixed(3)}), rgba(160,170,185,${(wet * 0.25).toFixed(3)}) 66%, transparent)`,
        }}
      />
      <div className="absolute inset-x-0 top-0 h-[150vh] bg-[radial-gradient(ellipse_at_center,transparent_40%,rgba(0,0,0,0.55))]" />
    </div>
  )
}
