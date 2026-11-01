'use client'

/**
 * Disaster manager risk board: current alert severity for a configurable list
 * of districts (saved on this device), on a map and in a list sorted by
 * severity. Severity comes from the backend's deterministic alert engine.
 */

import { useCallback, useEffect, useState, type FormEvent } from 'react'
import dynamic from 'next/dynamic'
import { LoaderCircle, Plus, RefreshCw, RotateCcw, ShieldAlert, X } from 'lucide-react'
import { TopNav } from '@/components/layout/TopNav'
import { getRiskBoard, type District, type RiskBoard, type RiskLevel } from '@/lib/api/roles'
import { cn } from '@/lib/utils'

const RiskMap = dynamic(() => import('@/components/map/RiskMap'), {
  ssr: false,
  loading: () => <div className="h-full min-h-[320px] animate-pulse rounded-[12px] bg-line/40" />,
})

const STORAGE_KEY = 'wgpt:districts'
const MAX_DISTRICTS = 40

/** District headquarters (Maharashtra) as a starting list; edit freely. */
const DEFAULT_DISTRICTS: District[] = [
  { name: 'Mumbai', latitude: 19.076, longitude: 72.8777 },
  { name: 'Thane', latitude: 19.2183, longitude: 72.9781 },
  { name: 'Palghar', latitude: 19.6967, longitude: 72.7699 },
  { name: 'Raigad (Alibag)', latitude: 18.6414, longitude: 72.8722 },
  { name: 'Ratnagiri', latitude: 16.9902, longitude: 73.312 },
  { name: 'Pune', latitude: 18.5204, longitude: 73.8567 },
  { name: 'Satara', latitude: 17.6805, longitude: 74.0183 },
  { name: 'Kolhapur', latitude: 16.705, longitude: 74.2433 },
  { name: 'Nashik', latitude: 19.9975, longitude: 73.7898 },
  { name: 'Chhatrapati Sambhajinagar', latitude: 19.8762, longitude: 75.3433 },
  { name: 'Solapur', latitude: 17.6599, longitude: 75.9064 },
  { name: 'Latur', latitude: 18.4088, longitude: 76.5604 },
  { name: 'Nanded', latitude: 19.1383, longitude: 77.321 },
  { name: 'Amravati', latitude: 20.9374, longitude: 77.7796 },
  { name: 'Nagpur', latitude: 21.1458, longitude: 79.0882 },
]

const LEVEL_STYLE: Record<RiskLevel, string> = {
  warning: 'bg-coral text-panel',
  watch: 'bg-orange-500 text-white',
  advisory: 'bg-amber-400 text-ink',
  none: 'bg-teal-soft text-teal',
  unknown: 'bg-line text-ink-soft',
}

function loadDistricts(): District[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const list = raw ? (JSON.parse(raw) as District[]) : null
    if (Array.isArray(list) && list.length) return list.slice(0, MAX_DISTRICTS)
  } catch {
    // fall through to the defaults
  }
  return DEFAULT_DISTRICTS
}

function saveDistricts(list: District[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list))
  } catch {
    // storage blocked: the list lasts for this page only
  }
}

export default function DisasterPage() {
  const [districts, setDistricts] = useState<District[]>(DEFAULT_DISTRICTS)
  const [board, setBoard] = useState<RiskBoard | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)

  const refresh = useCallback(async (list: District[]) => {
    setLoading(true)
    setError(null)
    try {
      setBoard(await getRiskBoard(list))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Risk board unavailable')
    } finally {
      setLoading(false)
    }
  }, [])

  // Load the saved list once, then evaluate it.
  useEffect(() => {
    const list = loadDistricts()
    const id = window.setTimeout(() => {
      setDistricts(list)
      void refresh(list)
    }, 0)
    return () => window.clearTimeout(id)
  }, [refresh])

  function update(list: District[]) {
    setDistricts(list)
    saveDistricts(list)
    void refresh(list)
  }

  async function addDistrict(e: FormEvent) {
    e.preventDefault()
    const q = newName.trim()
    if (!q) return
    if (districts.length >= MAX_DISTRICTS) {
      setAddError(`Up to ${MAX_DISTRICTS} districts.`)
      return
    }
    setAdding(true)
    setAddError(null)
    try {
      const params = new URLSearchParams({ q, format: 'json', limit: '1', countrycodes: 'in' })
      const resp = await fetch(`https://nominatim.openstreetmap.org/search?${params}`)
      const results = (await resp.json()) as { lat: string; lon: string; display_name: string }[]
      if (!results.length) {
        setAddError(`No place found for "${q}".`)
        return
      }
      const r = results[0]
      const district = { name: q, latitude: Number(r.lat), longitude: Number(r.lon) }
      update([...districts.filter((d) => d.name.toLowerCase() !== q.toLowerCase()), district])
      setNewName('')
    } catch {
      setAddError('Could not look up that place.')
    } finally {
      setAdding(false)
    }
  }

  const rows = board?.districts ?? []
  const counts = rows.reduce<Record<string, number>>((acc, r) => ({ ...acc, [r.severity]: (acc[r.severity] ?? 0) + 1 }), {})

  return (
    <div className="min-h-screen bg-canvas">
      <TopNav />
      <main className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6 lg:py-8">
        <div className="mb-5 flex flex-col justify-between gap-3 border-b border-line pb-5 sm:flex-row sm:items-end">
          <div>
            <p className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.2em] text-teal">
              <ShieldAlert className="size-3.5" /> Disaster manager
            </p>
            <h1 className="mt-2 font-display text-2xl font-semibold tracking-tight text-ink sm:text-3xl">District risk board</h1>
            <p className="mt-1 text-xs text-ink-soft">
              Current severity from the deterministic alert engine, most severe first. Generated by WeatherGPT, not
              official IMD warnings.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void refresh(districts)}
            disabled={loading}
            className="inline-flex min-h-11 items-center gap-2 rounded-md border border-line bg-panel px-4 text-sm text-ink hover:bg-canvas disabled:opacity-50"
          >
            {loading ? <LoaderCircle className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} Refresh
          </button>
        </div>

        {rows.length > 0 && (
          <p className="mb-4 flex flex-wrap gap-2 text-xs" aria-label="Severity counts">
            {(['warning', 'watch', 'advisory', 'none', 'unknown'] as RiskLevel[])
              .filter((l) => counts[l])
              .map((l) => (
                <span key={l} className={cn('rounded-full px-2.5 py-1 font-mono uppercase tracking-wide', LEVEL_STYLE[l])}>
                  {l} · {counts[l]}
                </span>
              ))}
          </p>
        )}

        {error && (
          <div role="alert" className="mb-4 rounded-[12px] border border-coral/30 bg-coral-soft p-4 text-sm text-coral">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          <section className="min-w-0 lg:order-2">
            <div className="h-[340px] lg:h-[560px]">
              <RiskMap districts={rows.length ? rows : districts.map((d) => ({ ...d, severity: 'unknown', alerts_count: 0, headline: null, rain_24h_mm: null, max_wind_24h_kmh: null, max_temperature_24h_c: null, error: null }))} />
            </div>
          </section>

          <section className="min-w-0" aria-label="Districts by severity">
            <ol className="space-y-2">
              {(rows.length ? rows : []).map((r) => (
                <li key={r.name} className="flex items-start justify-between gap-3 rounded-[12px] border border-line bg-panel p-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-ink">{r.name}</span>
                      <span className={cn('rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide', LEVEL_STYLE[r.severity])}>
                        {r.severity}
                      </span>
                    </div>
                    <p className="mt-0.5 truncate text-xs text-ink-soft">{r.error ?? r.headline ?? 'No active alerts'}</p>
                    {r.severity !== 'unknown' && (
                      <p className="mt-1 font-mono text-[11px] text-ink-soft">
                        24 h: {r.rain_24h_mm} mm · wind ≤{r.max_wind_24h_kmh} km/h · ≤{r.max_temperature_24h_c}°C
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => update(districts.filter((d) => d.name !== r.name))}
                    aria-label={`Remove ${r.name}`}
                    className="grid size-9 shrink-0 place-items-center rounded-md text-ink-soft hover:bg-canvas hover:text-ink"
                  >
                    <X className="size-4" />
                  </button>
                </li>
              ))}
              {!rows.length && loading && <li className="h-40 animate-pulse rounded-[12px] bg-line/40" />}
            </ol>

            <form onSubmit={addDistrict} className="mt-4 flex gap-2">
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Add a district or city"
                aria-label="Add a district or city"
                className="min-h-11 min-w-0 flex-1 rounded-md border border-line bg-panel px-3 text-sm text-ink outline-none focus:border-teal"
              />
              <button
                type="submit"
                disabled={adding || !newName.trim()}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-md bg-ink px-4 text-sm text-panel disabled:opacity-50"
              >
                {adding ? <LoaderCircle className="size-4 animate-spin" /> : <Plus className="size-4" />} Add
              </button>
            </form>
            {addError && <p className="mt-2 text-xs text-coral">{addError}</p>}
            <button
              type="button"
              onClick={() => update(DEFAULT_DISTRICTS)}
              className="mt-3 inline-flex items-center gap-1.5 text-xs text-ink-soft hover:text-ink"
            >
              <RotateCcw className="size-3" /> Reset to the default list
            </button>
            {board && <p className="mt-4 text-[11px] text-ink-soft">{board.note}</p>}
          </section>
        </div>
      </main>
    </div>
  )
}
