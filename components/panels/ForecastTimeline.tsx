'use client'

/**
 * 72 h hourly timeline from GET /api/weather: temperature line + rain
 * probability bars (SVG). Scrubbing an hour previews that hour's scene in the
 * live sky; "Live" returns the sky to the chat answer.
 */

import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { motion } from 'framer-motion'
import { Radio } from 'lucide-react'
import type { WeatherResponse } from '@/lib/api/weather'
import { sky } from '@/lib/skyStore'
import { sceneFromHourly } from '@/lib/weatherScene'
import { useI18n } from '@/context/I18nContext'
import { cn } from '@/lib/utils'
import { formatValue } from './CountUp'
import { GlassPanel } from './GlassPanel'
import { panelItem } from './WeatherPanels'

const HOUR_W = 13
const H = 170
const PAD_TOP = 22
const TEMP_H = 70
const BAR_TOP = 108
const BAR_H = 46

/** Index of the hourly slot containing the current observation time. */
function nowIndex(w: WeatherResponse): number {
  const cur = w.current.time
  let idx = 0
  w.hourly.time.forEach((t, i) => {
    if (t <= cur) idx = i
  })
  return idx
}

function hhmm(ts: string) {
  return ts.slice(11, 16)
}

function dayLabel(ts: string, lang: string) {
  const d = new Date(`${ts.slice(0, 10)}T12:00:00`)
  return d.toLocaleDateString(lang === 'hi' ? 'hi-IN' : 'en-IN', { weekday: 'short', day: 'numeric', month: 'short' })
}

interface Props {
  weather: WeatherResponse
}

/** Remount (change `key`) for a new answer or location to reset the scrubber. */
export function ForecastTimeline({ weather }: Props) {
  const { t, language } = useI18n()
  const { time, temperature_2m: temps, precipitation_probability: probs, precipitation: precs, wind_speed_10m: winds } = weather.hourly
  const n = time.length
  const width = n * HOUR_W
  const live = useMemo(() => nowIndex(weather), [weather])
  const [selected, setSelected] = useState(live)
  const [previewing, setPreviewing] = useState(false)
  const scroller = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)

  const { tMin, tMax } = useMemo(() => {
    const valid = temps.filter((v) => Number.isFinite(v))
    return { tMin: Math.min(...valid), tMax: Math.max(...valid) }
  }, [temps])

  const y = (v: number) => PAD_TOP + TEMP_H - ((v - tMin) / Math.max(1, tMax - tMin)) * TEMP_H
  const x = (i: number) => i * HOUR_W + HOUR_W / 2

  const linePath = useMemo(
    () => temps.map((v, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' '),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [temps, tMin, tMax]
  )
  const areaPath = `${linePath} L ${x(n - 1)} ${PAD_TOP + TEMP_H + 8} L ${x(0)} ${PAD_TOP + TEMP_H + 8} Z`

  // Start scrolled to the current hour; clear any preview on unmount.
  useEffect(() => {
    const el = scroller.current
    if (el) el.scrollTo({ left: Math.max(0, live * HOUR_W - el.clientWidth / 3), behavior: 'smooth' })
    return () => sky.setPreview(null)
  }, [live])

  function select(i: number) {
    const idx = Math.max(0, Math.min(n - 1, i))
    setSelected(idx)
    setPreviewing(true)
    sky.setPreview(sceneFromHourly(weather.hourly, idx))
  }

  function goLive() {
    setSelected(live)
    setPreviewing(false)
    sky.setPreview(null)
  }

  function indexFromPointer(e: ReactPointerEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    return Math.floor(((e.clientX - rect.left) / rect.width) * n)
  }

  const days = time
    .map((ts, i) => ({ ts, i }))
    .filter(({ ts, i }) => i === 0 || ts.slice(0, 10) !== time[i - 1].slice(0, 10))

  const sel = selected
  const prob = probs[sel]

  return (
    <motion.div variants={panelItem} initial="hidden" animate="show" className="min-w-0">
      <GlassPanel
        label={t('panel.timeline')}
        className="h-full"
        aside={
          <button
            type="button"
            onClick={goLive}
            className={cn(
              'flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-readout text-[10px] uppercase tracking-[0.2em] transition',
              previewing ? 'border-fuchsia-300/60 bg-fuchsia-400/15 text-fuchsia-100' : 'border-accent/40 text-accent'
            )}
          >
            <Radio className={cn('size-3', !previewing && 'animate-pulse')} />
            {previewing ? `${t('sky.preview')} · ${t('sky.live')} ↺` : t('sky.live')}
          </button>
        }
      >
        {/* readout of the selected hour (API values only) */}
        <div className="mb-3 grid grid-cols-2 gap-2 font-readout text-[11px] sm:grid-cols-5">
          <div className="rounded-lg border border-white/5 bg-black/30 px-2.5 py-1.5">
            <p className="text-hud-dim">{dayLabel(time[sel], language)}</p>
            <p className="text-sm text-hud">{hhmm(time[sel])}</p>
          </div>
          <div className="rounded-lg border border-white/5 bg-black/30 px-2.5 py-1.5">
            <p className="text-hud-dim">TEMP</p>
            <p className="text-sm text-hud">{formatValue(temps[sel])} °C</p>
          </div>
          <div className="rounded-lg border border-white/5 bg-black/30 px-2.5 py-1.5">
            <p className="text-hud-dim">RAIN %</p>
            <p className="text-sm text-hud">{prob == null ? '—' : `${prob} %`}</p>
          </div>
          <div className="rounded-lg border border-white/5 bg-black/30 px-2.5 py-1.5">
            <p className="text-hud-dim">RAIN</p>
            <p className="text-sm text-hud">{formatValue(precs[sel])} mm</p>
          </div>
          <div className="col-span-2 rounded-lg border border-white/5 bg-black/30 px-2.5 py-1.5 sm:col-span-1">
            <p className="text-hud-dim">WIND</p>
            <p className="text-sm text-hud">{formatValue(winds[sel])} km/h</p>
          </div>
        </div>

        <div ref={scroller} className="sky-scroll -mx-1 overflow-x-auto px-1 pb-2">
          <svg
            width={width}
            height={H}
            viewBox={`0 0 ${width} ${H}`}
            className="block cursor-ew-resize touch-pan-y select-none"
            onPointerDown={(e) => {
              dragging.current = true
              e.currentTarget.setPointerCapture(e.pointerId)
              select(indexFromPointer(e))
            }}
            onPointerMove={(e) => dragging.current && select(indexFromPointer(e))}
            onPointerUp={() => (dragging.current = false)}
            onPointerCancel={() => (dragging.current = false)}
            role="img"
            aria-label="Hourly temperature and rain probability"
          >
            <defs>
              <linearGradient id="tl-area" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="var(--sky-accent)" stopOpacity="0.35" />
                <stop offset="100%" stopColor="var(--sky-accent)" stopOpacity="0" />
              </linearGradient>
            </defs>

            {days.map(({ ts, i }) => (
              <g key={ts}>
                <line x1={i * HOUR_W} x2={i * HOUR_W} y1={0} y2={H} stroke="rgba(255,255,255,0.12)" strokeDasharray="2 4" />
                <text x={i * HOUR_W + 6} y={12} fill="rgba(205,220,245,0.6)" fontSize="10" fontFamily="var(--font-readout)">
                  {dayLabel(ts, language)}
                </text>
              </g>
            ))}

            {/* rain probability bars */}
            {probs.map((p, i) => {
              const h = ((p ?? 0) / 100) * BAR_H
              return (
                <motion.rect
                  key={time[i]}
                  x={i * HOUR_W + 2}
                  width={HOUR_W - 4}
                  rx={2}
                  initial={{ y: BAR_TOP + BAR_H, height: 0 }}
                  animate={{ y: BAR_TOP + BAR_H - h, height: h }}
                  transition={{ duration: 0.6, delay: 0.3 + i * 0.008 }}
                  fill={i === sel ? 'var(--sky-accent)' : 'rgba(56,189,248,0.55)'}
                />
              )
            })}
            <line x1={0} x2={width} y1={BAR_TOP + BAR_H} y2={BAR_TOP + BAR_H} stroke="rgba(255,255,255,0.1)" />

            {/* temperature line */}
            <motion.path d={areaPath} fill="url(#tl-area)" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.6, duration: 0.8 }} />
            <motion.path
              d={linePath}
              fill="none"
              stroke="var(--sky-accent)"
              strokeWidth="2"
              strokeLinejoin="round"
              style={{ filter: 'drop-shadow(0 0 6px var(--sky-accent))' }}
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 1.6, ease: 'easeInOut' }}
            />

            {/* now marker */}
            <line x1={x(live)} x2={x(live)} y1={16} y2={H} stroke="rgba(255,255,255,0.35)" />
            <text x={x(live) + 4} y={H - 4} fill="rgba(255,255,255,0.6)" fontSize="9" fontFamily="var(--font-readout)">
              NOW
            </text>

            {/* scrub cursor */}
            <line x1={x(sel)} x2={x(sel)} y1={16} y2={H} stroke="var(--sky-accent)" strokeWidth="1.5" />
            <circle cx={x(sel)} cy={y(temps[sel])} r={5} fill="#fff" stroke="var(--sky-accent)" strokeWidth="2.5" />
          </svg>
        </div>

        <input
          type="range"
          min={0}
          max={n - 1}
          value={sel}
          onChange={(e) => select(Number(e.target.value))}
          aria-label="Scrub forecast hour"
          aria-valuetext={`${time[sel]}`}
          className="mt-1 w-full accent-[var(--sky-accent)]"
        />
      </GlassPanel>
    </motion.div>
  )
}
