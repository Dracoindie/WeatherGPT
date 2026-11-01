'use client'

/**
 * Role panel under a chat answer: farm guidance, aviation briefing, GFS vs
 * Open-Meteo comparison, or a link to the district risk board. All values
 * come from the role endpoints; rules and thresholds live on the server.
 */

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { motion } from 'framer-motion'
import { ArrowRight, Plane, ShieldAlert, Sprout, TestTubeDiagonal } from 'lucide-react'
import {
  getAviationBriefing,
  getFarmAdvice,
  getModelComparison,
  type AviationBriefing,
  type FarmAdvice,
  type ModelComparison,
} from '@/lib/api/roles'
import type { UserRole } from '@/lib/role'
import { cn } from '@/lib/utils'
import { formatValue } from './CountUp'
import { GlassPanel } from './GlassPanel'
import { panelItem } from './WeatherPanels'

type Load<T> = { key: string; data?: T; error?: string }

/** Fetch for the current key; results for a stale key are ignored. */
function useRoleData<T>(key: string | null, fetcher: ((signal: AbortSignal) => Promise<T>) | null): Load<T> | null {
  const [state, setState] = useState<Load<T> | null>(null)
  useEffect(() => {
    if (!key || !fetcher) return
    const ctrl = new AbortController()
    fetcher(ctrl.signal)
      .then((data) => setState({ key, data }))
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return
        setState({ key, error: err instanceof Error ? err.message : 'Unavailable' })
      })
    return () => ctrl.abort()
    // fetcher identity follows key
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return state && state.key === key ? state : null
}

const fmt = (v: number | null | undefined) => (v == null ? '—' : formatValue(v))

function hhmm(iso: string) {
  return iso.slice(11, 16)
}

function dayName(iso: string) {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', timeZone: 'UTC' })
}

const STATUS_TONE: Record<string, string> = {
  skip: 'border-sky-300/50 text-sky-200',
  delay: 'border-amber-300/50 text-amber-200',
  needed: 'border-orange-300/60 text-orange-200',
  as_usual: 'border-emerald-300/50 text-emerald-200',
  favourable: 'border-emerald-300/50 text-emerald-200',
  dry: 'border-amber-300/50 text-amber-200',
  wait: 'border-rose-300/50 text-rose-200',
  good: 'border-emerald-300/50 text-emerald-200',
  avoid: 'border-rose-300/50 text-rose-200',
}

function Badge({ status }: { status: string }) {
  return (
    <span className={cn('rounded-full border px-2 py-0.5 font-readout text-[10px] uppercase tracking-[0.16em]', STATUS_TONE[status])}>
      {status.replace('_', ' ')}
    </span>
  )
}

function Note({ text }: { text: string }) {
  return <p className="mt-3 text-[11px] leading-snug text-hud-dim">{text}</p>
}

function Pending({ error }: { error?: string }) {
  return error ? (
    <p className="text-sm text-amber-200">{error}</p>
  ) : (
    <div className="h-32 animate-pulse rounded-xl bg-white/[0.03]" />
  )
}

function FarmBody({ a }: { a: FarmAdvice }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <section>
        <h3 className="sky-label">Spray windows</h3>
        {a.spray_windows.length === 0 ? (
          <p className="mt-2 text-sm text-hud-dim">No suitable window in the next 3 days.</p>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {a.spray_windows.map((w) => (
              <li key={w.start} className="flex justify-between gap-2 text-sm">
                <span className="text-hud">
                  {dayName(w.start)} {hhmm(w.start)}–{hhmm(w.end)}
                </span>
                <span className="font-readout text-xs text-hud-dim">
                  {w.hours} h · ≤{fmt(w.max_wind_kmh)} km/h · ≤{fmt(w.max_temperature_c)}°
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="space-y-3">
        <div>
          <h3 className="sky-label flex items-center gap-2">
            Irrigation <Badge status={a.irrigation.status} />
          </h3>
          <p className="mt-1 text-sm text-hud">{a.irrigation.reason}</p>
        </div>
        <div>
          <h3 className="sky-label flex items-center gap-2">
            Sowing <Badge status={a.sowing.status} />
          </h3>
          <p className="mt-1 text-sm text-hud">{a.sowing.reason}</p>
        </div>
      </section>
      <section className="md:col-span-2">
        <h3 className="sky-label">Harvest days</h3>
        <ul className="mt-2 flex flex-wrap gap-2">
          {a.harvest_days.map((d) => (
            <li key={d.date} className="rounded-xl border border-white/10 bg-black/25 px-3 py-2 text-sm">
              <span className="mr-2 text-hud">{dayName(d.date)}</span>
              <Badge status={d.harvest} />
              {d.reasons.length > 0 && <span className="ml-2 text-xs text-hud-dim">{d.reasons.join(', ')}</span>}
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}

function AviationBody({ b }: { b: AviationBriefing }) {
  const cells: [string, string][] = [
    ['Visibility', `${fmt(b.visibility_km)} km${b.visibility_band ? ` · ${b.visibility_band.replace('_', ' ')}` : ''}`],
    ['Cloud cover', `${fmt(b.cloud_cover_percent)}%`],
    ['Wind', `${fmt(b.wind_direction_deg)}° / ${fmt(b.wind_kt)} kt (${fmt(b.wind_kmh)} km/h)`],
    ['Gusts', b.gust_kt == null ? '—' : `${fmt(b.gust_kt)} kt (${fmt(b.gust_kmh)} km/h)`],
    ['Precipitation', `${fmt(b.precipitation_mm)} mm`],
    ['Weather', b.weather_description ? `${b.weather_description} (WMO ${b.weather_code})` : `WMO ${b.weather_code}`],
  ]
  return (
    <>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
        {cells.map(([k, v]) => (
          <div key={k}>
            <dt className="sky-label">{k}</dt>
            <dd className="font-readout text-sm text-hud">{v}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 font-readout text-xs text-hud-dim">
        Next {b.next_hours} h: min visibility {fmt(b.next_min_visibility_km)} km · max gust {fmt(b.next_max_gust_kmh)} km/h ·
        rain {fmt(b.next_precipitation_mm)} mm
      </p>
      {b.flags.length > 0 && (
        <ul className="mt-2 space-y-1">
          {b.flags.map((f) => (
            <li key={f} className="text-sm text-amber-200">
              ▸ {f}
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

/** Hourly temperature: Open-Meteo vs GFS for the same valid hours. */
function CompareChart({ rows }: { rows: ModelComparison['rows'] }) {
  const pts = rows.filter((r) => r.open_meteo_temperature_c != null && r.gfs_temperature_c != null)
  if (pts.length < 2) return null
  const vals = pts.flatMap((r) => [r.open_meteo_temperature_c!, r.gfs_temperature_c!])
  const lo = Math.min(...vals) - 1
  const hi = Math.max(...vals) + 1
  const W = 600
  const H = 140
  const x = (i: number) => (i / (pts.length - 1)) * W
  const y = (v: number) => H - ((v - lo) / (hi - lo)) * H
  const line = (k: 'open_meteo_temperature_c' | 'gfs_temperature_c') =>
    pts.map((r, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(r[k]!).toFixed(1)}`).join(' ')
  return (
    <figure className="mt-3">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-36 w-full" role="img" aria-label="Hourly temperature, Open-Meteo and GFS">
        <path d={line('open_meteo_temperature_c')} fill="none" stroke="var(--sky-accent)" strokeWidth="2" />
        <path d={line('gfs_temperature_c')} fill="none" stroke="#f0abfc" strokeWidth="2" strokeDasharray="5 4" />
      </svg>
      <figcaption className="mt-1 flex gap-4 font-readout text-[11px] text-hud-dim">
        <span>
          <span className="mr-1 inline-block h-0.5 w-4 bg-[var(--sky-accent)] align-middle" />
          Open-Meteo
        </span>
        <span>
          <span className="mr-1 inline-block h-0.5 w-4 border-t-2 border-dashed border-fuchsia-300 align-middle" />
          GFS
        </span>
        <span>
          {fmt(Math.min(...vals))}–{fmt(Math.max(...vals))} °C · {pts.length} h
        </span>
      </figcaption>
    </figure>
  )
}

function ResearchBody({ c }: { c: ModelComparison }) {
  const s = c.stats
  return (
    <>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div>
          <dt className="sky-label">Temp bias</dt>
          <dd className="font-readout text-sm text-hud">{fmt(s.temperature_bias_c)} °C</dd>
        </div>
        <div>
          <dt className="sky-label">Temp MAD</dt>
          <dd className="font-readout text-sm text-hud">{fmt(s.temperature_mae_c)} °C</dd>
        </div>
        <div>
          <dt className="sky-label">Wind bias</dt>
          <dd className="font-readout text-sm text-hud">{fmt(s.wind_bias_kmh)} km/h</dd>
        </div>
        <div>
          <dt className="sky-label">Rain OM / GFS</dt>
          <dd className="font-readout text-sm text-hud">
            {fmt(s.open_meteo_precipitation_total_mm)} / {fmt(s.gfs_precipitation_total_mm)} mm
          </dd>
        </div>
      </dl>
      <CompareChart rows={c.rows} />
      <p className="mt-2 font-readout text-[11px] text-hud-dim">
        GFS run {c.gfs_run.slice(0, 13).replace('T', ' ')}:00 UTC · bias = GFS − Open-Meteo ·{' '}
        <Link href="/climate" className="text-accent underline-offset-2 hover:underline">
          climate trends →
        </Link>
      </p>
    </>
  )
}

export function RolePanel({ role, latitude, longitude }: { role: UserRole; latitude: number; longitude: number }) {
  const where = `${latitude.toFixed(4)},${longitude.toFixed(4)}`
  const farm = useRoleData(role === 'farmer' ? where : null, role === 'farmer' ? (s) => getFarmAdvice(latitude, longitude, s) : null)
  const air = useRoleData(role === 'aviation' ? where : null, role === 'aviation' ? (s) => getAviationBriefing(latitude, longitude, s) : null)
  const cmp = useRoleData(role === 'researcher' ? where : null, role === 'researcher' ? (s) => getModelComparison(latitude, longitude, s) : null)

  if (role === 'citizen') return null

  let panel: React.ReactNode = null
  if (role === 'farmer') {
    panel = (
      <GlassPanel label="Farm guidance · next 3 days" aside={<Sprout className="size-4 text-accent" />}>
        {farm?.data ? <FarmBody a={farm.data} /> : <Pending error={farm?.error} />}
        {farm?.data && <Note text={farm.data.note} />}
      </GlassPanel>
    )
  } else if (role === 'aviation') {
    panel = (
      <GlassPanel label="Aviation briefing" aside={<Plane className="size-4 text-accent" />}>
        {air?.data ? <AviationBody b={air.data} /> : <Pending error={air?.error} />}
        {air?.data && <Note text={air.data.note} />}
      </GlassPanel>
    )
  } else if (role === 'researcher') {
    panel = (
      <GlassPanel label="GFS vs Open-Meteo · next 24 h" aside={<TestTubeDiagonal className="size-4 text-accent" />}>
        {cmp?.data ? (
          <ResearchBody c={cmp.data} />
        ) : (
          <Pending error={cmp?.error && (cmp.error === 'NWP unavailable' ? 'GFS is not available on this server.' : cmp.error)} />
        )}
        {cmp?.data && <Note text={cmp.data.note} />}
      </GlassPanel>
    )
  } else if (role === 'disaster_manager') {
    panel = (
      <GlassPanel label="Disaster management" aside={<ShieldAlert className="size-4 text-accent" />}>
        <p className="text-sm text-hud">
          See current risk across your districts, sorted by severity, on the risk board.
        </p>
        <Link
          href="/disaster"
          className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-xl border border-accent/50 bg-black/40 px-4 text-sm text-accent hover:bg-black/60"
        >
          Open district risk board <ArrowRight className="size-4" />
        </Link>
      </GlassPanel>
    )
  }

  return (
    <motion.section key={role} variants={panelItem} initial="hidden" animate="show" className="mt-4">
      {panel}
    </motion.section>
  )
}
