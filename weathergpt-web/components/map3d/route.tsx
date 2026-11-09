'use client'

/**
 * Weather along a route on /map (docs/ROUTES.md, VISION step 3).
 *
 * Pick a start and a destination (search through the backend geocoder, tap on
 * the map, or "my location") and a departure (now, or later within 72 h).
 * GET /api/route returns the OSRM route, each sample's level for the hour the
 * traveller passes it (scored by backend/alerts/scoring.py), plain findings and
 * the departure in the next 12 h with the lowest worst level. The UI only
 * colours and words what the API returns; it never says "safe".
 */

import type { Layer } from '@deck.gl/core'
import { PathLayer, ScatterplotLayer } from '@deck.gl/layers'
import { ArrowUpDown, Crosshair, LoaderCircle, MapPin, Search, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { RetryButton } from '@/components/common/RetryButton'
import { SeverityBadge } from '@/components/ui/SeverityBadge'
import { SkyButton } from '@/components/ui/SkyButton'
import { fill, useI18n, type TranslationKey } from '@/context/I18nContext'
import type { HazardLevel } from '@/lib/api/map'
import { geocodePlace } from '@/lib/api/roles'
import { fetchRoute, RouteError, type RouteFinding, type RouteHazard, type RouteLevel, type RouteReport } from '@/lib/api/route'
import { formatLocalTime, zonedClock } from '@/lib/format'
import { useDescribeWeather } from '@/lib/i18n/weather'
import { useRetryCooldown } from '@/lib/retryCooldown'
import { cn } from '@/lib/utils'
import type { RGB } from './field'

export interface RouteEndpoint {
  latitude: number
  longitude: number
  name: string
}

export type RouteSlot = 'from' | 'to'
type Status = 'idle' | 'loading' | 'ready' | 'error'
type DepartMode = 'now' | 'later'

const HOURS_AHEAD = 72

/** "YYYY-MM-DDTHH:MM" in the browser's zone, for <input type="datetime-local">. */
export function toLocalInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

/** A UTC instant as a clock time in the route's zone. */
export function useRouteClock(tz: string) {
  const { language } = useI18n()
  return useCallback(
    (iso: string, withDay = false) => {
      const z = zonedClock(iso, 0, tz)
      if (!z) return ''
      return withDay ? formatLocalTime(z.full.replace(' ', 'T'), language) : z.clock
    },
    [tz, language]
  )
}

// ---------------------------------------------------------------- state ---

export function useRoute() {
  const [from, setFrom] = useState<RouteEndpoint | null>(null)
  const [to, setTo] = useState<RouteEndpoint | null>(null)
  const [picking, setPicking] = useState<RouteSlot | null>(null)
  const [departMode, setDepartMode] = useState<DepartMode>('now')
  const [departLocal, setDepartLocal] = useState('')
  const [report, setReport] = useState<RouteReport | null>(null)
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState<{ status: number; detail: string } | null>(null)
  const abort = useRef<AbortController | null>(null)
  // "Retry" after the routing or weather service failed, with backoff
  const { fail: routeFailed, succeed: routeLoaded, wait: retryWait } = useRetryCooldown()

  const run = useCallback(
    (override?: Date) => {
      if (!from || !to) return
      const depart = override ?? (departMode === 'later' && departLocal ? new Date(departLocal) : null)
      abort.current?.abort()
      const ctrl = new AbortController()
      abort.current = ctrl
      setStatus('loading')
      setError(null)
      fetchRoute(from, to, depart, ctrl.signal)
        .then((r) => {
          setReport(r)
          setStatus('ready')
          routeLoaded()
        })
        .catch((err: unknown) => {
          if (err instanceof DOMException && err.name === 'AbortError') return
          const e = err instanceof RouteError ? err : new RouteError(0, String(err))
          setError({ status: e.status, detail: e.message })
          setStatus('error')
          // a bad request (422) does not get better by asking again
          if (e.status !== 422) routeFailed()
        })
    },
    [from, to, departMode, departLocal, routeFailed, routeLoaded]
  )

  /** Take a suggested or listed departure and check the route again. */
  const departAt = useCallback(
    (iso: string) => {
      const d = new Date(iso)
      setDepartMode('later')
      setDepartLocal(toLocalInput(d))
      run(d)
    },
    [run]
  )

  const clear = useCallback(() => {
    abort.current?.abort()
    setReport(null)
    setStatus('idle')
    setError(null)
  }, [])

  useEffect(() => () => abort.current?.abort(), [])

  return {
    from, setFrom, to, setTo, picking, setPicking,
    departMode, setDepartMode, departLocal, setDepartLocal,
    report, status, error, run, departAt, clear, retryWait,
  }
}

export type RouteState = ReturnType<typeof useRoute>

// --------------------------------------------------------------- layers ---

export function routeLayers({
  report,
  from,
  to,
  colors,
}: {
  report: RouteReport | null
  from: RouteEndpoint | null
  to: RouteEndpoint | null
  colors: Record<HazardLevel, RGB> & { outline: RGB; ink: RGB; unknown: RGB; marker: RGB }
}): Layer[] {
  const out: Layer[] = []
  const col = (lv: RouteLevel): [number, number, number, number] => (lv === 'unknown' ? [...colors.unknown, 255] : [...colors[lv], 255])
  if (report) {
    out.push(
      new PathLayer({
        id: 'route-casing',
        data: report.segments,
        getPath: (s: RouteReport['segments'][number]) => s.path,
        getColor: (s: RouteReport['segments'][number]) => (s.level === 'severe' ? [...colors.outline, 255] : [...colors.ink, 230]) as [number, number, number, number],
        getWidth: 10,
        widthUnits: 'pixels',
        capRounded: true,
        jointRounded: true,
      }),
      new PathLayer({
        id: 'route-line',
        data: report.segments,
        getPath: (s: RouteReport['segments'][number]) => s.path,
        getColor: (s: RouteReport['segments'][number]) => col(s.level),
        getWidth: 6,
        widthUnits: 'pixels',
        capRounded: true,
        jointRounded: true,
      })
    )
  }
  const ends = [from && { ...from, slot: 'from' as const }, to && { ...to, slot: 'to' as const }].filter(Boolean) as Array<RouteEndpoint & { slot: RouteSlot }>
  if (ends.length) {
    out.push(
      new ScatterplotLayer({
        id: 'route-ends',
        data: ends,
        getPosition: (d: RouteEndpoint) => [d.longitude, d.latitude],
        getRadius: 8,
        radiusUnits: 'pixels',
        stroked: true,
        lineWidthUnits: 'pixels',
        getLineWidth: 3,
        getLineColor: [...colors.ink, 255],
        getFillColor: (d: { slot: RouteSlot }) => (d.slot === 'from' ? [...colors.marker, 255] : [255, 255, 255, 255]),
      })
    )
  }
  return out
}

/** [west, south, east, north] of the route. */
export function routeBounds(report: RouteReport): [[number, number], [number, number]] {
  let w = 180, s = 90, e = -180, n = -90
  for (const seg of report.segments) {
    for (const [x, y] of seg.path) {
      w = Math.min(w, x)
      e = Math.max(e, x)
      s = Math.min(s, y)
      n = Math.max(n, y)
    }
  }
  return [[w, s], [e, n]]
}

// ------------------------------------------------------------- planner ---

function EndpointField({
  slot,
  value,
  onChange,
  picking,
  onPick,
}: {
  slot: RouteSlot
  value: RouteEndpoint | null
  onChange: (v: RouteEndpoint | null) => void
  picking: boolean
  onPick: () => void
}) {
  const { t } = useI18n()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const id = `route-${slot}`

  const search = async (e: FormEvent) => {
    e.preventDefault()
    const q = text.trim()
    if (!q) return
    setBusy(true)
    setMsg(null)
    try {
      const r = await geocodePlace(q)
      onChange({ latitude: r.latitude, longitude: r.longitude, name: r.name.split(',')[0] })
      setText('')
    } catch (err) {
      const status = (err as { status?: number }).status
      setMsg(status === 404 ? t('route.notFound') : t('route.searchFailed'))
    } finally {
      setBusy(false)
    }
  }

  const myLocation = () => {
    setMsg(null)
    if (!('geolocation' in navigator)) {
      setMsg(t('route.geoFailed'))
      return
    }
    setBusy(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setBusy(false)
        onChange({ latitude: pos.coords.latitude, longitude: pos.coords.longitude, name: t('route.myLocation') })
      },
      () => {
        setBusy(false)
        setMsg(t('route.geoFailed'))
      },
      { timeout: 10_000, maximumAge: 60_000 }
    )
  }

  return (
    <div className="min-w-0 space-y-1.5" data-testid={`route-field-${slot}`}>
      <label htmlFor={id} className="sky-label flex items-center gap-1.5">
        <MapPin className={cn('size-3', slot === 'from' ? 'text-accent-text' : 'text-hud')} aria-hidden /> {t(slot === 'from' ? 'route.from' : 'route.to')}
      </label>
      {value ? (
        <div className="flex items-center justify-between gap-2 rounded-xl border border-accent/25 bg-accent/10 px-3 py-2">
          <span className="min-w-0 truncate text-sm font-medium text-hud" title={value.name} data-testid={`route-${slot}-name`}>
            {value.name}
          </span>
          <button
            type="button"
            onClick={() => onChange(null)}
            className="shrink-0 rounded-full p-1 text-hud-dim hover:bg-white/10 hover:text-hud"
            aria-label={`${t(slot === 'from' ? 'route.from' : 'route.to')}: ${t('route.clear')}`}
          >
            <X className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>
      ) : (
        <form onSubmit={search} className="flex gap-1.5">
          <input
            id={id}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t('route.placeholder')}
            className="sky-input min-w-0 flex-1"
            autoComplete="off"
            data-testid={`route-${slot}-input`}
          />
          <SkyButton type="submit" variant="ghost" className="shrink-0" disabled={busy || !text.trim()} aria-label={t('route.search')} data-testid={`route-${slot}-search`}>
            {busy ? <LoaderCircle className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden /> : <Search className="h-4 w-4" aria-hidden />}
          </SkyButton>
        </form>
      )}
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={onPick}
          aria-pressed={picking}
          data-testid={`route-${slot}-pick`}
          className={cn(
            'rounded-full border px-2.5 py-1 text-[11px] transition-colors',
            picking ? 'border-accent bg-accent/15 text-hud' : 'border-white/10 bg-white/[0.04] text-hud-dim hover:text-hud'
          )}
        >
          {t('route.pickOnMap')}
        </button>
        <button
          type="button"
          onClick={myLocation}
          data-testid={`route-${slot}-me`}
          className="flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] text-hud-dim hover:text-hud"
        >
          <Crosshair className="h-3 w-3" aria-hidden /> {t('route.myLocation')}
        </button>
      </div>
      {msg && (
        <p className="text-xs text-sev-watch-text" role="alert">
          {msg}
        </p>
      )}
    </div>
  )
}

export function RoutePlanner({ r }: { r: RouteState }) {
  const { t } = useI18n()
  // the clock only moves between renders that the user causes; fine for min/max
  const [now] = useState(() => new Date())
  const max = new Date(now.getTime() + HOURS_AHEAD * 3_600_000)
  const canGo = !!r.from && !!r.to && (r.departMode === 'now' || !!r.departLocal)

  const errorText = r.error
    ? r.error.status === 0
      ? t('route.err.offline')
      : r.error.status === 422
        ? /no road route/i.test(r.error.detail)
          ? t('route.err.noRoute')
          : t('route.err.bad')
        : t('route.err.unavailable')
    : null

  return (
    <section className="sky-glass p-4" data-testid="route-planner" aria-label={t('route.title')}>
      <h3 className="sky-label">{t('route.title')}</h3>
      <p className="mt-1 text-xs text-hud-dim">{t('route.intro')}</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:items-start">
        <EndpointField
          slot="from"
          value={r.from}
          onChange={(v) => {
            r.setFrom(v)
            r.clear()
          }}
          picking={r.picking === 'from'}
          onPick={() => r.setPicking(r.picking === 'from' ? null : 'from')}
        />
        <button
          type="button"
          onClick={() => {
            const a = r.from
            r.setFrom(r.to)
            r.setTo(a)
            r.clear()
          }}
          className="mx-auto rounded-full border border-white/10 p-2 text-hud-dim hover:text-hud sm:mt-6"
          aria-label={t('route.swap')}
          data-testid="route-swap"
        >
          <ArrowUpDown className="h-4 w-4 sm:rotate-90" aria-hidden />
        </button>
        <EndpointField
          slot="to"
          value={r.to}
          onChange={(v) => {
            r.setTo(v)
            r.clear()
          }}
          picking={r.picking === 'to'}
          onPick={() => r.setPicking(r.picking === 'to' ? null : 'to')}
        />
      </div>
      {r.picking && (
        <p className="mt-2 text-xs text-accent-text" role="status" data-testid="route-picking">
          {t('route.picking')}
        </p>
      )}

      <fieldset className="mt-3">
        <legend className="sky-label">{t('route.depart')}</legend>
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          {(['now', 'later'] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={r.departMode === m}
              onClick={() => {
                r.setDepartMode(m)
                if (m === 'later' && !r.departLocal) r.setDepartLocal(toLocalInput(new Date(Date.now() + 3_600_000)))
              }}
              data-testid={`route-depart-${m}`}
              className={cn(
                'rounded-full border px-3 py-1.5 text-xs transition-colors',
                r.departMode === m ? 'border-accent bg-accent/15 text-hud' : 'border-white/10 bg-white/[0.04] text-hud-dim hover:text-hud'
              )}
            >
              {t(m === 'now' ? 'route.departNow' : 'route.departLater')}
            </button>
          ))}
          {r.departMode === 'later' && (
            <label className="flex min-w-0 items-center gap-2 text-xs text-hud-dim">
              <span className="sr-only">{t('route.departAt')}</span>
              <input
                type="datetime-local"
                value={r.departLocal}
                min={toLocalInput(now)}
                max={toLocalInput(max)}
                onChange={(e) => r.setDepartLocal(e.target.value)}
                className="sky-input min-w-0"
                data-testid="route-depart-at"
                aria-label={t('route.departAt')}
              />
            </label>
          )}
        </div>
      </fieldset>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <SkyButton variant="primary" disabled={!canGo || r.status === 'loading'} onClick={() => r.run()} data-testid="route-go">
          {r.status === 'loading' && <LoaderCircle className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />}
          {t('route.go')}
        </SkyButton>
        {r.report && (
          <SkyButton variant="subtle" onClick={r.clear} data-testid="route-clear">
            {t('route.clear')}
          </SkyButton>
        )}
        {!r.from || !r.to ? <span className="text-xs text-hud-dim">{t('route.needBoth')}</span> : null}
      </div>
      {r.status === 'loading' && (
        <p className="mt-2 text-xs text-hud" role="status">
          {t('route.loading')}
        </p>
      )}
      {errorText && (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <p className="text-xs text-sev-warning-text" role="alert" data-testid="route-error">
            {errorText}
          </p>
          {r.error && r.error.status !== 422 && (
            <RetryButton wait={r.retryWait} onRetry={() => r.run()} testId="route-retry" className="px-3 py-1 text-xs" />
          )}
        </div>
      )}
    </section>
  )
}

// --------------------------------------------------------------- report ---

const fmt = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1))
const levelVar = (lv: RouteLevel) => `var(--sev-${lv})`

function useFindingText() {
  const { t } = useI18n()
  return useCallback(
    (f: RouteFinding, clock: (iso: string) => string) => {
      const hazard = t(`threshold.${f.rule_id}` as TranslationKey)
      const vars = { hazard, place: f.place ?? '', km: fmt(f.km), time: clock(f.eta), level: t(`severity.${f.level}` as TranslationKey) }
      return fill(t(f.place ? 'route.findingNear' : 'route.findingKm'), vars)
    },
    [t]
  )
}

function joinHazards(list: RouteHazard[], t: (k: TranslationKey) => string): string {
  const words = list.map((h) => t(`route.hz.${h}` as TranslationKey))
  if (words.length <= 1) return words.join('')
  return `${words.slice(0, -1).join(', ')}${t('route.and')}${words[words.length - 1]}`
}

export function RouteLegend() {
  const { t } = useI18n()
  return (
    <p className="text-[11px] text-hud" data-testid="route-legend">
      {t('route.legend')}
    </p>
  )
}

export function RouteReportPanel({ report, tz, onDepart }: { report: RouteReport; tz: string; onDepart: (iso: string) => void }) {
  const { t } = useI18n()
  const describe = useDescribeWeather()
  const zone = report.timezone ?? tz
  const clock = useRouteClock(zone)
  const findingText = useFindingText()
  const total = Math.max(0.1, report.distance_km)
  const h = Math.floor(report.duration_min / 60)
  const m = Math.round(report.duration_min % 60)

  // km ticks along the strip with the clock time of the nearest sample
  const ticks = useMemo(() => {
    const out: Array<{ km: number; eta: string; pct: number }> = []
    for (const frac of [0, 0.25, 0.5, 0.75, 1]) {
      const km = frac * report.distance_km
      const s = report.samples.reduce((a, b) => (Math.abs(b.km - km) < Math.abs(a.km - km) ? b : a), report.samples[0])
      out.push({ km: Math.round(km), eta: s.eta, pct: frac * 100 })
    }
    return out
  }, [report])

  const s = report.suggestion
  const depOptions = report.departures
  // the whole way at level none, and every departure in the 12 h too: say so plainly
  const calm = report.worst === 'none' && depOptions.length > 0 && depOptions.every((o) => o.worst === 'none')

  return (
    <section className="sky-glass space-y-4 p-4" data-testid="route-report" data-worst={report.worst} aria-label={t('route.title')}>
      <header className="space-y-1.5">
        <p className="flex flex-wrap items-center gap-2 text-sm text-hud">
          <span className="sky-label">{t('route.worst')}</span>
          {report.worst === 'unknown' ? <span className="text-xs text-hud-dim">{t('route.unknown')}</span> : <SeverityBadge level={report.worst} />}
        </p>
        <p className="text-xs text-hud" data-testid="route-summary">
          {fill(t('route.summary'), {
            km: fmt(report.distance_km),
            dur: fill(t('route.duration'), { h, m }),
            depart: clock(report.depart, true),
            arrive: clock(report.arrive, true),
          })}
        </p>
      </header>

      {/* timeline strip: hazard per stretch, km and clock time */}
      <div>
        <h4 className="text-[11px] uppercase tracking-wide text-hud-dim">{t('route.timeline')}</h4>
        <div className="mt-1.5 flex h-4 w-full overflow-hidden rounded-full bg-white/5" data-testid="route-timeline" role="list">
          {report.segments.map((seg, i) => {
            const label = `${fill(t('route.stretch'), { from: fmt(Math.round(seg.from_km)), to: fmt(Math.round(seg.to_km)) })}: ${
              seg.level === 'unknown' ? t('route.unknown') : t(`severity.${seg.level}` as TranslationKey)
            }`
            return (
              <div
                key={i}
                role="listitem"
                aria-label={label}
                title={label}
                data-level={seg.level}
                className="h-full border-r-2 border-[var(--sky-floor)] last:border-r-0"
                style={{ width: `${((seg.to_km - seg.from_km) / total) * 100}%`, background: levelVar(seg.level) }}
              />
            )
          })}
        </div>
        <div className="relative mt-1 h-8 text-[10px] text-hud-dim" aria-hidden>
          {ticks.map((tk, i) => (
            <span
              key={i}
              className={cn('absolute top-0 whitespace-nowrap font-readout', i === 0 ? 'left-0' : i === ticks.length - 1 ? 'right-0 text-right' : '-translate-x-1/2 text-center')}
              style={i === 0 || i === ticks.length - 1 ? undefined : { left: `${tk.pct}%` }}
            >
              {tk.km} km
              <br />
              {clock(tk.eta)}
            </span>
          ))}
        </div>
      </div>

      {/* findings */}
      <div>
        <h4 className="text-[11px] uppercase tracking-wide text-hud-dim">{t('route.findings')}</h4>
        {report.findings.length === 0 ? (
          <p className="mt-1 text-xs text-hud" data-testid="route-no-findings">
            {t('route.noFindings')}
          </p>
        ) : (
          <ul className="mt-1.5 space-y-2" data-testid="route-findings">
            {report.findings.map((f, i) => (
              <li key={i} className="text-xs text-hud" data-testid={`route-finding-${f.hazard}`}>
                <p className="flex flex-wrap items-center gap-1.5">
                  <SeverityBadge level={f.level} />
                  <span className="font-semibold">{findingText(f, clock)}</span>
                </p>
                <p className="mt-0.5 text-hud-dim">
                  <span className="font-readout text-hud">
                    {f.comparator === 'in'
                      ? `${describe(f.value) ?? ''} (WMO ${f.value})`
                      : `${fmt(f.value)} ${f.unit} ${f.comparator === '>=' ? '≥' : '≤'} ${fmt(f.threshold)} ${f.unit}`}
                  </span>
                  {' · '}
                  {fill(t('route.stretch'), { from: fmt(f.from_km), to: fmt(f.to_km) })}
                  {f.road ? ` · ${fill(t('route.findingOn'), { road: f.road })}` : ''}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* departure suggestion */}
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3" data-testid="route-suggestion">
        {s ? (
          <>
            <p className="text-sm text-hud" data-testid="route-suggestion-text">
              {s.avoids.length > 0
                ? fill(t('route.suggest'), { time: clock(s.depart), hazards: joinHazards(s.avoids, t) })
                : fill(t('route.suggestLower'), {
                    time: clock(s.depart),
                    level: s.worst === 'unknown' ? t('route.unknown') : t(`severity.${s.worst}` as TranslationKey),
                    current: report.worst === 'unknown' ? t('route.unknown') : t(`severity.${report.worst}` as TranslationKey),
                  })}
            </p>
            <SkyButton variant="ghost" className="mt-2" onClick={() => onDepart(s.depart)} data-testid="route-use-suggestion">
              {t('route.useSuggestion')}
            </SkyButton>
          </>
        ) : calm ? (
          <p className="text-sm text-hud" data-testid="route-all-clear">
            {t('route.allClear')}
          </p>
        ) : (
          <p className="text-xs text-hud" data-testid="route-best-already">
            {t('route.bestAlready')}
          </p>
        )}
        <p className="mt-3 text-[11px] text-hud-dim">{t('route.departures')}</p>
        {/* a picture of the 12 h, not 49 tiny buttons: "Use this departure" applies the best one */}
        <ul className="mt-1 flex h-6 w-full gap-[2px]" data-testid="route-departures" aria-label={t('route.departures')}>
          {depOptions.map((o) => {
            const label = fill(t('route.departureOption'), {
              time: clock(o.depart),
              level: o.worst === 'unknown' ? t('route.unknown') : t(`severity.${o.worst}` as TranslationKey),
            })
            const chosen = o.depart === report.depart
            const suggested = s && o.depart === s.depart
            return (
              <li
                key={o.depart}
                title={label}
                data-level={o.worst}
                data-chosen={chosen || undefined}
                data-suggested={suggested || undefined}
                className={cn('h-full min-w-0 flex-1 rounded-[3px]', chosen && 'ring-2 ring-[var(--sky-text)]', suggested && !chosen && 'ring-2 ring-accent')}
                style={{ background: levelVar(o.worst) }}
              >
                <span className="sr-only">{label}</span>
              </li>
            )
          })}
        </ul>
        <div className="mt-1 flex justify-between text-[10px] text-hud-dim" aria-hidden>
          <span className="font-readout">{depOptions[0] && clock(depOptions[0].depart)}</span>
          <span className="font-readout">{depOptions.length > 0 && clock(depOptions[depOptions.length - 1].depart)}</span>
        </div>
      </div>

      {report.beyond_forecast_km > 0 && (
        <p className="text-xs text-sev-watch-text" data-testid="route-beyond">
          {fill(t('route.beyond'), { km: fmt(report.beyond_forecast_km) })}
        </p>
      )}

      <RouteLegend />
      <p className="text-[11px] leading-snug text-hud-dim" data-testid="route-honesty">
        {fill(t('route.honesty'), { km: report.model_grid_km, sample: fmt(report.sample_km) })}{' '}
        {report.routing_public_demo ? t('route.publicServer') : fill(t('route.ownServer'), { host: report.routing_host })}
      </p>
    </section>
  )
}
