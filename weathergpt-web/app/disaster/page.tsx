'use client'

/**
 * Disaster manager risk board: current alert severity for a configurable list
 * of districts (saved on this device), on a map and in a list sorted by
 * severity. Severity comes from the backend's deterministic alert engine.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import dynamic from 'next/dynamic'
import { LoaderCircle, Plus, RefreshCw, RotateCcw, ShieldAlert, X } from 'lucide-react'
import { AppShell } from '@/components/ui/AppShell'
import { PageHeader } from '@/components/ui/PageHeader'
import { SkyButton } from '@/components/ui/SkyButton'
import { SEVERITY_VAR, SeverityBadge } from '@/components/ui/SeverityBadge'
import { GlassPanel } from '@/components/panels/GlassPanel'
import { fill, useI18n, type TranslationKey } from '@/context/I18nContext'
import {
  geocodePlace,
  getRiskBoard,
  RoleApiError,
  type District,
  type DistrictRisk,
  type RiskLevel,
} from '@/lib/api/roles'

const RiskMap = dynamic(() => import('@/components/map/RiskMap'), {
  ssr: false,
  loading: () => <div className="h-full min-h-[320px] animate-pulse rounded-xl bg-white/[0.03]" />,
})

const STORAGE_KEY = 'wgpt:districts'
const MAX_DISTRICTS = 40
/** Requests in flight at once. The backend spaces Nominatim calls 1/s and
 * caches them on disk, so after the first run every lookup is instant. */
const CONCURRENCY = 4

/** A district to show: a name, plus the text sent to the geocoder. */
interface Wanted {
  name: string
  query: string
  /** Set for user-added districts already geocoded (saved on this device). */
  latitude?: number
  longitude?: number
}

/** District headquarters (Maharashtra) as a starting list; edit freely.
 * Names only: coordinates come from the geocoder (ground rule 3). */
const DEFAULT_DISTRICTS: Wanted[] = [
  'Mumbai', 'Thane', 'Palghar', 'Raigad (Alibag)', 'Ratnagiri', 'Pune', 'Satara', 'Kolhapur',
  'Nashik', 'Chhatrapati Sambhajinagar', 'Solapur', 'Latur', 'Nanded', 'Amravati', 'Nagpur',
].map((name) => ({
  name,
  query: `${name === 'Raigad (Alibag)' ? 'Alibag' : name}, Maharashtra, India`,
}))

type Failure = 'notFound' | 'geoDown'

const RANK: Record<RiskLevel, number> = { severe: 4, warning: 3, watch: 2, advisory: 1, none: 0, unknown: -1 }

/** Same order as backend roles/risk.py sort_board: severity, rain, wind, name. */
function sortRows(rows: DistrictRisk[]): DistrictRisk[] {
  return [...rows].sort(
    (a, b) =>
      RANK[b.severity] - RANK[a.severity] ||
      (b.rain_24h_mm ?? 0) - (a.rain_24h_mm ?? 0) ||
      (b.max_wind_24h_kmh ?? 0) - (a.max_wind_24h_kmh ?? 0) ||
      (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
  )
}

function loadSaved(): Wanted[] | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const list = raw ? (JSON.parse(raw) as District[]) : null
    if (Array.isArray(list) && list.length) {
      return list
        .slice(0, MAX_DISTRICTS)
        .filter((d) => d && typeof d.name === 'string')
        .map((d) => ({ name: d.name, query: d.name, latitude: d.latitude, longitude: d.longitude }))
    }
  } catch {
    // fall through to the defaults
  }
  return null
}

function saveDistricts(list: Wanted[] | null) {
  try {
    if (list === null) localStorage.removeItem(STORAGE_KEY)
    else
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(list.map(({ name, latitude, longitude }) => ({ name, latitude, longitude })))
      )
  } catch {
    // storage blocked: the list lasts for this page only
  }
}

/** Run `fn` over `items`, at most `limit` at a time. */
async function pool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  let next = 0
  const worker = async () => {
    while (next < items.length) await fn(items[next++])
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
}

function unknownRow(d: District, error: string | null = null): DistrictRisk {
  return {
    ...d,
    severity: 'unknown',
    alerts_count: 0,
    headline: null,
    rain_24h_mm: null,
    max_wind_24h_kmh: null,
    max_temperature_24h_c: null,
    error,
  }
}

function without<T>(record: Record<string, T>, key: string): Record<string, T> {
  const copy = { ...record }
  delete copy[key]
  return copy
}

export default function DisasterPage() {
  const { t } = useI18n()
  const [wanted, setWanted] = useState<Wanted[]>([])
  const [located, setLocated] = useState<Record<string, District>>({})
  const [risk, setRisk] = useState<Record<string, DistrictRisk>>({})
  const [failed, setFailed] = useState<Record<string, Failure>>({})
  const [note, setNote] = useState<string | null>(null)
  const [busy, setBusy] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)
  // Bumped on every full reload so answers from an older run are dropped.
  const run = useRef(0)

  /** Locate (if needed) and evaluate each district; each row appears as soon as it is ready. */
  const evaluate = useCallback(async (list: Wanted[], fresh: boolean) => {
    const id = fresh ? ++run.current : run.current
    if (fresh) {
      setLocated({})
      setRisk({})
      setFailed({})
    }
    setError(null)
    setBusy((n) => n + 1)
    let riskFailures = 0
    await pool(list, CONCURRENCY, async (w) => {
      let d: District
      if (w.latitude != null && w.longitude != null) {
        d = { name: w.name, latitude: w.latitude, longitude: w.longitude }
      } else {
        try {
          const geo = await geocodePlace(w.query)
          d = { name: w.name, latitude: geo.latitude, longitude: geo.longitude }
        } catch (err) {
          if (run.current !== id) return
          const reason: Failure = err instanceof RoleApiError && err.status === 404 ? 'notFound' : 'geoDown'
          setFailed((f) => ({ ...f, [w.name]: reason }))
          return
        }
      }
      if (run.current !== id) return
      setFailed((f) => without(f, w.name))
      setLocated((l) => ({ ...l, [w.name]: d }))
      try {
        const board = await getRiskBoard([d])
        if (run.current !== id) return
        const row = board.districts[0] ?? unknownRow(d)
        setRisk((r) => ({ ...r, [w.name]: { ...row, name: w.name } }))
        setNote(board.note)
      } catch (err) {
        if (run.current !== id) return
        riskFailures++
        setRisk((r) => ({ ...r, [w.name]: unknownRow(d, err instanceof Error ? err.message : null) }))
      }
    })
    if (run.current === id && riskFailures > 0 && riskFailures === list.length) setError('Risk board unavailable')
    setBusy((n) => n - 1)
  }, [])

  // Load the saved list (or the defaults) once, then evaluate it.
  useEffect(() => {
    const list = loadSaved() ?? DEFAULT_DISTRICTS
    const timer = window.setTimeout(() => {
      setWanted(list)
      void evaluate(list, true)
    }, 0)
    return () => window.clearTimeout(timer)
  }, [evaluate])

  const withCoords = (list: Wanted[]) => list.map((w) => ({ ...w, ...located[w.name] }))

  function remove(name: string) {
    const list = wanted.filter((w) => w.name !== name)
    setWanted(list)
    setLocated((l) => without(l, name))
    setRisk((r) => without(r, name))
    setFailed((f) => without(f, name))
    saveDistricts(withCoords(list))
  }

  function reset() {
    saveDistricts(null)
    setWanted(DEFAULT_DISTRICTS)
    void evaluate(DEFAULT_DISTRICTS, true)
  }

  function refresh() {
    void evaluate(withCoords(wanted), true)
  }

  async function addDistrict(e: FormEvent) {
    e.preventDefault()
    const q = newName.trim()
    if (!q) return
    if (wanted.length >= MAX_DISTRICTS) {
      setAddError(fill(t('risk.max'), { n: MAX_DISTRICTS }))
      return
    }
    setAdding(true)
    setAddError(null)
    try {
      const geo = await geocodePlace(/\bindia\b/i.test(q) ? q : `${q}, India`)
      const w: Wanted = { name: q, query: q, latitude: geo.latitude, longitude: geo.longitude }
      const list = [...wanted.filter((x) => x.name.toLowerCase() !== q.toLowerCase()), w]
      setWanted(list)
      saveDistricts(withCoords(list))
      setNewName('')
      void evaluate([w], false)
    } catch (err) {
      setAddError(
        err instanceof RoleApiError && err.status === 404
          ? fill(t('risk.addNotFound'), { place: q })
          : t('risk.addFailed')
      )
    } finally {
      setAdding(false)
    }
  }

  const loading = busy > 0
  const rows = useMemo(
    () => sortRows(wanted.filter((w) => risk[w.name]).map((w) => risk[w.name])),
    [wanted, risk]
  )
  const mapRows = useMemo(
    () => wanted.filter((w) => located[w.name]).map((w) => risk[w.name] ?? unknownRow(located[w.name])),
    [wanted, located, risk]
  )
  const pending = loading ? wanted.filter((w) => !risk[w.name] && !failed[w.name]) : []
  const notLocated = wanted.filter((w) => failed[w.name])
  const counts = rows.reduce<Record<string, number>>((acc, r) => ({ ...acc, [r.severity]: (acc[r.severity] ?? 0) + 1 }), {})

  return (
    <AppShell>
      <PageHeader
        eyebrow={t('risk.eyebrow')}
        icon={<ShieldAlert className="size-3.5" />}
        title={t('risk.title')}
        description={
          <>
            <p>{t('risk.intro')}</p>
            <p className="mt-1 font-medium text-hud">Generated by WeatherGPT, not official IMD warnings.</p>
          </>
        }
        actions={
          <SkyButton onClick={refresh} disabled={loading} variant="subtle">
            {loading ? <LoaderCircle className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} {t('risk.refresh')}
          </SkyButton>
        }
      />

      {rows.length > 0 && (
        <p className="mb-4 flex flex-wrap gap-2" aria-label={t('risk.counts')}>
          {(['severe', 'warning', 'watch', 'advisory', 'none', 'unknown'] as RiskLevel[])
            .filter((l) => counts[l])
            .map((l) => (
              <SeverityBadge key={l} level={l} label={`${t(`severity.${l}` as TranslationKey)} · ${counts[l]}`} className="px-2.5 py-1 text-[11px]" />
            ))}
        </p>
      )}

      {error && (
        <div role="alert" className="sky-glass mb-4 border-sev-warning/40 p-4 text-sm text-hud">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <GlassPanel wet={false} label={t('risk.map')} className="flex min-h-[360px] flex-col lg:order-2 lg:min-h-[600px]">
          <div className="min-h-0 flex-1">
            <RiskMap districts={mapRows} />
          </div>
        </GlassPanel>

        <GlassPanel wet={false} label={t('risk.list')} className="min-w-0">
          <section aria-label="Districts by severity">
            <ol className="space-y-2">
              {rows.map((r) => (
                <li
                  key={r.name}
                  className="flex items-start justify-between gap-3 rounded-xl border border-white/10 bg-black/25 p-3"
                  style={{ borderLeft: `3px solid ${SEVERITY_VAR[r.severity]}` }}
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-hud">{r.name}</span>
                      <SeverityBadge level={r.severity} />
                    </div>
                    <p className="mt-0.5 truncate text-sm text-hud-dim">{r.error ?? r.headline ?? t('risk.noAlerts')}</p>
                    {r.severity !== 'unknown' && (
                      <p className="mt-1 font-readout text-[11px] text-hud-dim">
                        {fill(t('risk.line'), { rain: r.rain_24h_mm ?? '—', wind: r.max_wind_24h_kmh ?? '—', temp: r.max_temperature_24h_c ?? '—' })}
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => remove(r.name)}
                    aria-label={fill(t('risk.remove'), { place: r.name })}
                    className="grid size-9 shrink-0 place-items-center rounded-lg text-hud-dim hover:bg-white/5 hover:text-hud"
                  >
                    <X className="size-4" />
                  </button>
                </li>
              ))}
              {notLocated.map((w) => (
                <li
                  key={w.name}
                  className="flex items-start justify-between gap-3 rounded-xl border border-white/10 bg-black/25 p-3"
                  style={{ borderLeft: `3px solid ${SEVERITY_VAR.unknown}` }}
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-hud">{w.name}</span>
                      <SeverityBadge level="unknown" />
                    </div>
                    <p className="mt-0.5 text-sm text-hud-dim">
                      {t(failed[w.name] === 'notFound' ? 'risk.notFound' : 'risk.geoDown')}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => remove(w.name)}
                    aria-label={fill(t('risk.remove'), { place: w.name })}
                    className="grid size-9 shrink-0 place-items-center rounded-lg text-hud-dim hover:bg-white/5 hover:text-hud"
                  >
                    <X className="size-4" />
                  </button>
                </li>
              ))}
            </ol>
            {pending.length > 0 && (
              <ul className="mt-2 space-y-2" data-testid="risk-pending" aria-live="polite">
                {pending.map((w) => (
                  <li
                    key={w.name}
                    className="flex items-center gap-2 rounded-xl border border-dashed border-white/10 p-3 text-sm text-hud-dim"
                  >
                    <LoaderCircle className="size-4 shrink-0 animate-spin" aria-hidden />
                    {fill(t('risk.finding'), { place: w.name })}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <form onSubmit={addDistrict} className="mt-4 flex gap-2">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={t('risk.add')}
              aria-label="Add a district or city"
              className="sky-input min-w-0 flex-1"
            />
            <SkyButton type="submit" variant="primary" disabled={adding || !newName.trim()}>
              {adding ? <LoaderCircle className="size-4 animate-spin" /> : <Plus className="size-4" />} {t('risk.addBtn')}
            </SkyButton>
          </form>
          {addError && <p className="mt-2 text-xs text-sev-warning-text">{addError}</p>}
          <button
            type="button"
            onClick={reset}
            className="mt-3 inline-flex items-center gap-1.5 text-xs text-hud-dim hover:text-hud"
          >
            <RotateCcw className="size-3" /> {t('risk.reset')}
          </button>
          {note && <p className="mt-4 text-[11px] text-hud-dim">{note}</p>}
        </GlassPanel>
      </div>
    </AppShell>)
}
