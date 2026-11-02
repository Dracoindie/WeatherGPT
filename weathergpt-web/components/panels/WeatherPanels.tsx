'use client'

/**
 * Data panels. Each panel renders only when the API returned its field;
 * every displayed number is a WeatherFacts / ResolvedLocation value.
 */

import { motion, type Variants } from 'framer-motion'
import { Crosshair, Droplets, MapPin, Navigation, Satellite, Wind } from 'lucide-react'
import type { ResolvedLocation, WeatherFacts } from '@/lib/api/chat'
import { useI18n } from '@/context/I18nContext'
import { cn } from '@/lib/utils'
import { useDescribeWeather } from '@/lib/i18n/weather'
import { formatWindow } from '@/lib/format'
import { CountUp, formatValue } from './CountUp'
import { GlassPanel } from './GlassPanel'

export const panelItem: Variants = {
  hidden: { opacity: 0, y: 24, scale: 0.97, filter: 'blur(6px)' },
  show: { opacity: 1, y: 0, scale: 1, filter: 'blur(0px)', transition: { type: 'spring', stiffness: 160, damping: 20 } },
}

const DEVANAGARI = /[ऀ-ॿ]/

// ---------------------------------------------------------------------------
// Temperature
// ---------------------------------------------------------------------------

const T_MIN = -10
const T_MAX = 50

/** cold → hot colour ramp for the thermal fill (visual only). */
function thermalColor(t: number): string {
  const stops: [number, [number, number, number]][] = [
    [-10, [120, 170, 255]],
    [10, [80, 220, 255]],
    [22, [120, 255, 200]],
    [30, [255, 210, 90]],
    [38, [255, 120, 60]],
    [46, [255, 50, 90]],
  ]
  if (t <= stops[0][0]) return `rgb(${stops[0][1].join(',')})`
  for (let i = 0; i < stops.length - 1; i++) {
    const [a, ca] = stops[i]
    const [b, cb] = stops[i + 1]
    if (t <= b) {
      const k = (t - a) / (b - a)
      return `rgb(${ca.map((c, j) => Math.round(c + (cb[j] - c) * k)).join(',')})`
    }
  }
  return `rgb(${stops[stops.length - 1][1].join(',')})`
}

const toFrac = (t: number) => Math.min(1, Math.max(0, (t - T_MIN) / (T_MAX - T_MIN)))

/** Point on the 240° gauge arc for fraction f. */
function arcPoint(f: number, r: number) {
  const a = ((-210 + f * 240) * Math.PI) / 180
  return { x: 100 + Math.cos(a) * r, y: 100 + Math.sin(a) * r }
}

function arcPath(f0: number, f1: number, r: number) {
  const p0 = arcPoint(f0, r)
  const p1 = arcPoint(f1, r)
  const large = (f1 - f0) * 240 > 180 ? 1 : 0
  return `M ${p0.x} ${p0.y} A ${r} ${r} 0 ${large} 1 ${p1.x} ${p1.y}`
}

export function TemperaturePanel({ facts }: { facts: WeatherFacts }) {
  const { t } = useI18n()
  const temp = facts.temperature_2m
  const tmin = facts.temperature_min
  const tmax = facts.temperature_max
  const main = temp ?? tmax ?? tmin
  if (main == null) return null
  const hasRange = tmin != null && tmax != null
  const hot = thermalColor(tmax ?? main)
  const cool = thermalColor(tmin ?? main - 6)

  return (
    <motion.div variants={panelItem} className="h-full">
      <GlassPanel label={t('panel.temperature')} className="h-full">
        <div className="flex items-center gap-4">
          <div className="relative size-36 shrink-0">
            <svg viewBox="0 0 200 200" className="size-full overflow-visible">
              <defs>
                <linearGradient id="thermal-arc" x1="0" x2="1">
                  <stop offset="0%" stopColor={cool} />
                  <stop offset="100%" stopColor={hot} />
                </linearGradient>
                <filter id="arc-glow" x="-50%" y="-50%" width="200%" height="200%">
                  <feGaussianBlur stdDeviation="4" />
                </filter>
              </defs>
              <path d={arcPath(0, 1, 80)} stroke="rgba(255,255,255,0.08)" strokeWidth="10" fill="none" strokeLinecap="round" />
              {Array.from({ length: 13 }, (_, i) => {
                const a = arcPoint(i / 12, 94)
                const b = arcPoint(i / 12, 99)
                return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="rgba(255,255,255,0.25)" strokeWidth="1.5" />
              })}
              {hasRange && (
                <>
                  <motion.path
                    d={arcPath(toFrac(tmin), Math.max(toFrac(tmin) + 0.01, toFrac(tmax)), 80)}
                    stroke="url(#thermal-arc)"
                    strokeWidth="12"
                    fill="none"
                    strokeLinecap="round"
                    filter="url(#arc-glow)"
                    initial={{ pathLength: 0 }}
                    animate={{ pathLength: 1 }}
                    transition={{ duration: 1.2, ease: 'easeOut' }}
                  />
                  <motion.path
                    d={arcPath(toFrac(tmin), Math.max(toFrac(tmin) + 0.01, toFrac(tmax)), 80)}
                    stroke="url(#thermal-arc)"
                    strokeWidth="8"
                    fill="none"
                    strokeLinecap="round"
                    initial={{ pathLength: 0 }}
                    animate={{ pathLength: 1 }}
                    transition={{ duration: 1.2, ease: 'easeOut' }}
                  />
                </>
              )}
              {(() => {
                const p = arcPoint(toFrac(main), 80)
                return <circle cx={p.x} cy={p.y} r="7" fill="#fff" stroke={thermalColor(main)} strokeWidth="4" style={{ filter: `drop-shadow(0 0 8px ${thermalColor(main)})` }} />
              })()}
            </svg>
            <div className="absolute inset-0 grid place-items-center">
              <span className="font-readout text-[10px] uppercase tracking-[0.2em] text-hud-dim">°C</span>
            </div>
          </div>
          <div className="min-w-0">
            <p
              className="font-hud text-6xl font-bold leading-none tracking-tighter"
              style={{
                backgroundImage: `linear-gradient(180deg, ${hot} 0%, ${cool} 100%)`,
                WebkitBackgroundClip: 'text',
                backgroundClip: 'text',
                color: 'transparent',
                filter: `drop-shadow(0 0 18px ${thermalColor(main)}55)`,
              }}
            >
              <CountUp value={main} />
              <span className="text-3xl align-top">°</span>
            </p>
            {hasRange && (
              <p className="mt-3 flex gap-4 font-readout text-xs text-hud-dim">
                <span>
                  MIN <span className="text-hud">{formatValue(tmin)}°</span>
                </span>
                <span>
                  MAX <span className="text-hud">{formatValue(tmax)}°</span>
                </span>
              </p>
            )}
          </div>
        </div>
      </GlassPanel>
    </motion.div>
  )
}

// ---------------------------------------------------------------------------
// Rain
// ---------------------------------------------------------------------------

export function RainPanel({ facts }: { facts: WeatherFacts }) {
  const { t } = useI18n()
  const prob = facts.precipitation_probability
  const mm = facts.precipitation
  if (prob == null && mm == null) return null
  const level = prob != null ? prob / 100 : null

  return (
    <motion.div variants={panelItem} className="h-full">
      <GlassPanel label={t('panel.rain')} className="h-full">
        <div className="flex items-center gap-5">
          {level != null ? (
            <div className="relative size-32 shrink-0 overflow-hidden rounded-full border border-accent/40 bg-black/40 shadow-[inset_0_0_30px_rgba(0,0,0,0.6),0_0_30px_-10px_var(--sky-accent)]">
              <motion.div
                className="absolute inset-x-0 bottom-0"
                initial={{ height: '0%' }}
                animate={{ height: `${level * 100}%` }}
                transition={{ duration: 1.4, ease: [0.16, 1, 0.3, 1] }}
              >
                <svg viewBox="0 0 240 20" preserveAspectRatio="none" className="absolute -top-[9px] left-0 h-[10px] w-[200%] animate-[sky-ticker_3s_linear_infinite]">
                  <path d="M0 10 Q 15 0 30 10 T 60 10 T 90 10 T 120 10 T 150 10 T 180 10 T 210 10 T 240 10 V 20 H 0 Z" fill="rgba(56,189,248,0.75)" />
                </svg>
                <div className="h-full w-full bg-gradient-to-b from-sky-400/75 to-blue-700/80" />
              </motion.div>
              <div className="absolute inset-0 grid place-items-center">
                <span className="font-hud text-3xl font-bold drop-shadow-[0_2px_8px_rgba(0,0,0,0.8)]">
                  <CountUp value={prob ?? 0} />
                  <span className="text-base">%</span>
                </span>
              </div>
            </div>
          ) : (
            <div className="grid size-32 shrink-0 place-items-center rounded-full border border-white/10 bg-black/30">
              <Droplets className="size-10 text-sky-300" />
            </div>
          )}
          <div className="min-w-0 space-y-2">
            {prob != null && <p className="font-readout text-[11px] uppercase tracking-[0.18em] text-hud-dim">Chance</p>}
            {mm != null && (
              <p className="font-hud text-3xl font-semibold">
                <CountUp value={mm} />
                <span className="ml-1 font-readout text-sm text-hud-dim">mm</span>
              </p>
            )}
          </div>
        </div>
      </GlassPanel>
    </motion.div>
  )
}

// ---------------------------------------------------------------------------
// Wind
// ---------------------------------------------------------------------------

export function WindPanel({ facts }: { facts: WeatherFacts }) {
  const { t } = useI18n()
  const kmh = facts.wind_speed_10m
  if (kmh == null) return null
  // rotor period shrinks as wind rises; still at 0 km/h
  const period = kmh <= 0 ? 0 : Math.max(0.35, 9 / (1 + kmh / 5))

  return (
    <motion.div variants={panelItem} className="h-full">
      <GlassPanel label={t('panel.wind')} className="h-full">
        <div className="flex items-center gap-5">
          <div className="relative size-32 shrink-0">
            <svg viewBox="0 0 120 120" className="absolute inset-0 size-full">
              <circle cx="60" cy="60" r="56" fill="none" stroke="rgba(255,255,255,0.08)" />
              {Array.from({ length: 36 }, (_, i) => {
                const a = (i * 10 * Math.PI) / 180
                const long = i % 9 === 0
                return (
                  <line
                    key={i}
                    x1={60 + Math.cos(a) * (long ? 46 : 50)}
                    y1={60 + Math.sin(a) * (long ? 46 : 50)}
                    x2={60 + Math.cos(a) * 55}
                    y2={60 + Math.sin(a) * 55}
                    stroke={long ? 'var(--sky-accent)' : 'rgba(255,255,255,0.22)'}
                    strokeWidth={long ? 2 : 1}
                  />
                )
              })}
            </svg>
            <svg
              viewBox="0 0 120 120"
              className="absolute inset-0 size-full"
              style={period ? { animation: `sky-radar ${period}s linear infinite` } : undefined}
            >
              {[0, 120, 240].map((deg) => (
                <path
                  key={deg}
                  d="M60 60 C 54 44, 56 22, 62 14 C 66 26, 66 46, 60 60 Z"
                  fill="rgba(231,240,255,0.85)"
                  transform={`rotate(${deg} 60 60)`}
                  style={{ filter: 'drop-shadow(0 0 6px var(--sky-accent))' }}
                />
              ))}
              <circle cx="60" cy="60" r="5" fill="var(--sky-accent)" />
            </svg>
          </div>
          <div>
            <p className="font-hud text-4xl font-bold">
              <CountUp value={kmh} />
            </p>
            <p className="mt-1 flex items-center gap-1.5 font-readout text-[11px] uppercase tracking-[0.18em] text-hud-dim">
              <Wind className="size-3.5" /> km/h · 10 m
            </p>
          </div>
        </div>
      </GlassPanel>
    </motion.div>
  )
}

// ---------------------------------------------------------------------------
// Humidity
// ---------------------------------------------------------------------------

export function HumidityPanel({ facts }: { facts: WeatherFacts }) {
  const { t } = useI18n()
  const rh = facts.relative_humidity_2m
  if (rh == null) return null
  const C = 2 * Math.PI * 46

  return (
    <motion.div variants={panelItem} className="h-full">
      <GlassPanel label={t('panel.humidity')} className="h-full">
        <div className="flex items-center gap-5">
          <div className="relative size-32 shrink-0">
            <svg viewBox="0 0 120 120" className="size-full -rotate-90">
              <circle cx="60" cy="60" r="46" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="8" />
              <circle cx="60" cy="60" r="54" fill="none" stroke="var(--sky-accent)" strokeOpacity="0.25" strokeWidth="1" className="sky-pulse-ring" />
              <motion.circle
                cx="60"
                cy="60"
                r="46"
                fill="none"
                stroke="url(#hum-grad)"
                strokeWidth="8"
                strokeLinecap="round"
                strokeDasharray={C}
                initial={{ strokeDashoffset: C }}
                animate={{ strokeDashoffset: C * (1 - Math.min(100, rh) / 100) }}
                transition={{ duration: 1.3, ease: 'easeOut' }}
                style={{ filter: 'drop-shadow(0 0 6px var(--sky-accent))' }}
              />
              <defs>
                <linearGradient id="hum-grad">
                  <stop offset="0%" stopColor="#38bdf8" />
                  <stop offset="100%" stopColor="var(--sky-accent)" />
                </linearGradient>
              </defs>
            </svg>
            <div className="absolute inset-0 grid place-items-center">
              <span className="font-hud text-3xl font-bold">
                <CountUp value={rh} />
                <span className="text-base">%</span>
              </span>
            </div>
          </div>
          <p className="font-readout text-[11px] uppercase tracking-[0.18em] text-hud-dim">RH · 2 m</p>
        </div>
      </GlassPanel>
    </motion.div>
  )
}

// ---------------------------------------------------------------------------
// Location lock + verified source
// ---------------------------------------------------------------------------

function coord(v: number, pos: string, neg: string) {
  return `${Math.abs(v).toFixed(4)}°${v >= 0 ? pos : neg}`
}

export function LocationPanel({ location, facts }: { location: ResolvedLocation; facts: WeatherFacts | null }) {
  const { t, language } = useI18n()
  const describe = useDescribeWeather()
  const SourceIcon = location.source === 'request_coordinates' ? Crosshair : location.source === 'trusted_user_default' ? Navigation : MapPin

  return (
    <motion.div variants={panelItem} className="h-full">
      <GlassPanel label={t('panel.location')} className="h-full" aside={<VerifiedBadge />}>
        <div className="flex items-start gap-3">
          <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl border border-accent/40 bg-accent/10">
            <SourceIcon className="size-4 text-accent-text" />
          </span>
          <div className="min-w-0">
            <p className={cn('truncate font-hud text-lg font-semibold', DEVANAGARI.test(location.name) && 'deva')}>{location.name}</p>
            <span className="mt-1 inline-block rounded-full border border-accent/40 px-2 py-0.5 font-readout text-[10px] uppercase tracking-[0.2em] text-accent-text">
              {t(`source.${location.source}`)}
            </span>
          </div>
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-1.5 rounded-xl border border-white/5 bg-black/30 p-3 font-readout text-[11px]">
          <dt className="text-hud-dim">LAT</dt>
          <dd className="text-right text-hud">{coord(location.latitude, 'N', 'S')}</dd>
          <dt className="text-hud-dim">LON</dt>
          <dd className="text-right text-hud">{coord(location.longitude, 'E', 'W')}</dd>
          {facts && (
            <>
              <dt className="text-hud-dim">TZ</dt>
              <dd className="truncate text-right text-hud">{facts.timezone}</dd>
              <dt className="text-hud-dim">WINDOW</dt>
              <dd className="text-right text-hud" title={facts.requested_time}>{formatWindow(facts.requested_time, language)}</dd>
            </>
          )}
        </dl>
        {facts?.weather_description && (
          <p className="mt-3 flex items-center gap-2 text-sm text-hud">
            <Satellite className="size-4 text-accent-text" />
            <span data-testid="weather-description">{describe(facts.weather_code, facts.weather_description)}</span>
            {facts.weather_code != null && <span className="font-readout text-[10px] text-hud-dim">WMO {facts.weather_code}</span>}
          </p>
        )}
      </GlassPanel>
    </motion.div>
  )
}

export function VerifiedBadge() {
  const { t } = useI18n()
  return (
    <span className="flex items-center gap-1.5 rounded-full border border-emerald-400/40 bg-emerald-400/10 px-2 py-0.5 font-readout text-[9px] uppercase tracking-[0.16em] text-emerald-300">
      <svg viewBox="0 0 16 16" className="size-3.5">
        <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeOpacity="0.4" />
        <motion.path
          d="M4.5 8.2 L7 10.6 L11.6 5.6"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 0.6, delay: 0.5, ease: 'easeOut' }}
        />
      </svg>
      {t('sky.verified')}
    </span>
  )
}
