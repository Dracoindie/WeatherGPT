'use client'

/**
 * Presenter controls (press "D"). Forces a visual sky scene so effects can be
 * shown regardless of the real weather. Only the sky changes — data panels
 * keep showing API values — and a "DEMO MODE" badge is shown while active.
 */

import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Cloud, CloudFog, CloudLightning, CloudRain, Moon, Snowflake, Sun, ThermometerSun, X } from 'lucide-react'
import { sky, useSky } from '@/lib/skyStore'
import { DEMO_PRESETS, type DemoPreset } from '@/lib/weatherScene'
import { cn } from '@/lib/utils'

const ICONS: Record<DemoPreset, typeof Sun> = {
  clear: Sun,
  clouds: Cloud,
  rain: CloudRain,
  storm: CloudLightning,
  snow: Snowflake,
  fog: CloudFog,
  heatwave: ThermometerSun,
  night: Moon,
}

function isTyping(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
  )
}

export function DemoPanel() {
  const { demo } = useSky()
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'd' || e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return
      setOpen((v) => !v)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <>
      <AnimatePresence>
        {demo.active && (
          <motion.button
            type="button"
            onClick={() => setOpen(true)}
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="fixed left-1/2 top-[4.5rem] z-[70] -translate-x-1/2 whitespace-nowrap rounded-full border border-fuchsia-400/60 bg-fuchsia-500/15 px-3 py-1 font-readout text-[10px] font-semibold uppercase tracking-[0.3em] text-fuchsia-200 shadow-[0_0_24px_-6px_rgba(232,121,249,0.8)] backdrop-blur-md"
          >
            Demo mode · {demo.preset} · simulated sky
          </motion.button>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {open && (
          <motion.aside
            initial={{ opacity: 0, x: -30 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -30 }}
            className="sky-glass fixed bottom-4 left-4 z-[70] w-[min(340px,calc(100vw-2rem))] border-fuchsia-400/30 p-4"
            aria-label="Demo controls"
          >
            <header className="mb-3 flex items-center justify-between">
              <span className="font-readout text-[10px] font-semibold uppercase tracking-[0.3em] text-fuchsia-200">
                Demo mode {demo.active ? '· active' : '· standby'}
              </span>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close demo controls" className="text-hud-dim hover:text-hud">
                <X className="size-4" />
              </button>
            </header>
            <div className="grid grid-cols-4 gap-2">
              {DEMO_PRESETS.map((preset) => {
                const Icon = ICONS[preset]
                const on = demo.active && demo.preset === preset
                return (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => sky.setDemo({ active: true, preset })}
                    aria-pressed={on}
                    className={cn(
                      'flex flex-col items-center gap-1 rounded-xl border px-1 py-2 font-readout text-[9px] uppercase tracking-[0.12em] transition',
                      on
                        ? 'border-fuchsia-300/70 bg-fuchsia-400/20 text-fuchsia-100'
                        : 'border-white/10 bg-white/[0.03] text-hud-dim hover:border-white/25 hover:text-hud'
                    )}
                  >
                    <Icon className="size-4" />
                    {preset}
                  </button>
                )
              })}
            </div>
            <label className="mt-4 block">
              <span className="flex justify-between font-readout text-[10px] uppercase tracking-[0.2em] text-hud-dim">
                <span>Wind (visual)</span>
                <span>{demo.windKmh} km/h</span>
              </span>
              <input
                type="range"
                min={0}
                max={120}
                value={demo.windKmh}
                onChange={(e) => sky.setDemo({ windKmh: Number(e.target.value) })}
                className="mt-2 w-full accent-fuchsia-400"
              />
            </label>
            <button
              type="button"
              disabled={!demo.active}
              onClick={() => sky.setDemo({ active: false })}
              className="mt-3 w-full rounded-xl border border-white/10 py-2 font-readout text-[10px] uppercase tracking-[0.2em] text-hud-dim hover:text-hud disabled:opacity-40"
            >
              Release → live data
            </button>
            <p className="mt-2 text-[11px] leading-snug text-hud-dim">
              Changes the sky only. Panels always show Open-Meteo values. Press D to hide.
            </p>
          </motion.aside>
        )}
      </AnimatePresence>
    </>
  )
}
