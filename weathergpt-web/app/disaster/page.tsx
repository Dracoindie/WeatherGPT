'use client'

/**
 * Disaster manager risk board: current alert severity for a configurable list
 * of districts (saved on this device), on a map and in a list sorted by
 * severity. Severity comes from the backend's deterministic alert engine.
 */

import { useCallback, useEffect, useState, type FormEvent } from 'react'
import dynamic from 'next/dynamic'
import { LoaderCircle, Plus, RefreshCw, RotateCcw, ShieldAlert, X } from 'lucide-react'
import { AppShell } from '@/components/ui/AppShell'
import { PageHeader } from '@/components/ui/PageHeader'
import { SkyButton } from '@/components/ui/SkyButton'
import { SEVERITY_VAR, SeverityBadge } from '@/components/ui/SeverityBadge'
import { GlassPanel } from '@/components/panels/GlassPanel'
import { fill, useI18n, type TranslationKey } from '@/context/I18nContext'
import { getRiskBoard, type District, type RiskBoard, type RiskLevel } from '@/lib/api/roles'

const RiskMap = dynamic(() => import('@/components/map/RiskMap'), {
  ssr: false,
  loading: () => <div className="h-full min-h-[320px] animate-pulse rounded-xl bg-white/[0.03]" />,
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
  const { t } = useI18n()
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
          <SkyButton onClick={() => void refresh(districts)} disabled={loading} variant="subtle">
            {loading ? <LoaderCircle className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} {t('risk.refresh')}
          </SkyButton>
        }
      />

      {rows.length > 0 && (
        <p className="mb-4 flex flex-wrap gap-2" aria-label={t('risk.counts')}>
          {(['warning', 'watch', 'advisory', 'none', 'unknown'] as RiskLevel[])
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
            <RiskMap districts={rows.length ? rows : districts.map((d) => ({ ...d, severity: 'unknown', alerts_count: 0, headline: null, rain_24h_mm: null, max_wind_24h_kmh: null, max_temperature_24h_c: null, error: null }))} />
          </div>
        </GlassPanel>

        <GlassPanel wet={false} label={t('risk.list')} className="min-w-0">
          <section aria-label="Districts by severity">
            <ol className="space-y-2">
              {(rows.length ? rows : []).map((r) => (
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
                    onClick={() => update(districts.filter((d) => d.name !== r.name))}
                    aria-label={fill(t('risk.remove'), { place: r.name })}
                    className="grid size-9 shrink-0 place-items-center rounded-lg text-hud-dim hover:bg-white/5 hover:text-hud"
                  >
                    <X className="size-4" />
                  </button>
                </li>
              ))}
              {!rows.length && loading && <li className="h-40 animate-pulse rounded-xl bg-white/[0.04]" />}
            </ol>
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
          {addError && <p className="mt-2 text-xs text-sev-warning">{addError}</p>}
          <button
            type="button"
            onClick={() => update(DEFAULT_DISTRICTS)}
            className="mt-3 inline-flex items-center gap-1.5 text-xs text-hud-dim hover:text-hud"
          >
            <RotateCcw className="size-3" /> {t('risk.reset')}
          </button>
          {board && <p className="mt-4 text-[11px] text-hud-dim">{board.note}</p>}
        </GlassPanel>
      </div>
    </AppShell>)
}
