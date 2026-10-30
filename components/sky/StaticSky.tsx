'use client'

/**
 * CSS-only sky: the reduced-motion fallback and the backdrop shown while the
 * WebGL engine loads. Uses the same palette as the shader sky.
 */

import { skyPalette, toCss } from '@/lib/weatherScene'
import { useSky } from '@/lib/skyStore'

export function StaticSky() {
  const { target } = useSky()
  const p = skyPalette(target)
  const wet = Math.max(target.rain, target.snow, target.fog)
  return (
    <div
      aria-hidden="true"
      className="fixed inset-0 -z-10 transition-[background] duration-[1500ms]"
      style={{
        background: `
          radial-gradient(120% 70% at 70% ${p.sunElevation > 0 ? 18 : 110}%, ${toCss(p.bottom, 0.55)}, transparent 60%),
          linear-gradient(180deg, ${toCss(p.top)} 0%, ${toCss(p.bottom)} 100%)`,
      }}
    >
      <div
        className="absolute inset-0"
        style={{ background: `linear-gradient(180deg, rgba(120,130,150,${(target.cloudCover * 0.25).toFixed(3)}), rgba(160,170,185,${(wet * 0.25).toFixed(3)}))` }}
      />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_40%,rgba(0,0,0,0.55))]" />
    </div>
  )
}
