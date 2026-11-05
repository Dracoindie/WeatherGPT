'use client'

/**
 * Hazard map for /map: H3 hexes coloured by level, roads coloured by the
 * hazard of the cells they cross, a tap card and a summary around a place.
 *
 * Every level, value and threshold comes from GET /api/map/hazard and
 * /api/map/hazard/summary (scored by backend/alerts/scoring.py with
 * backend/thresholds.py, the same scorer as alerts, the risk board and push).
 * The UI only colours, counts and words them.
 */

import type { Layer } from '@deck.gl/core'
import { PathLayer, PolygonLayer } from '@deck.gl/layers'
import { cellToBoundary, cellToLatLng } from 'h3-js'
import { Crosshair, MessageCircle, X } from 'lucide-react'
import type { Map as MapLibreMap } from 'maplibre-gl'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { askHref } from '@/components/console/AskCard'
import { SeverityBadge } from '@/components/ui/SeverityBadge'
import { SkyButton, SkyLinkButton } from '@/components/ui/SkyButton'
import { fill, useI18n, type TranslationKey } from '@/context/I18nContext'
import {
  fetchHazardSummary,
  fetchMapHazard,
  HAZARD_LEVELS,
  type Bounds,
  type HazardKind,
  type HazardLevel,
  type HazardPoint,
  type HazardSummary,
  type MapHazard,
} from '@/lib/api/map'
import { formatLocalTime, zonedClock } from '@/lib/format'
import { useDescribeWeather } from '@/lib/i18n/weather'
import { cn } from '@/lib/utils'
import { tokenRgb, type RGB } from './field'
import { gridFits } from './gridPlan'
import { roadPieces, type RoadPiece } from './roads'

export type HazardType = 'overall' | HazardKind
export const HAZARD_TYPES: HazardType[] = ['overall', 'rain', 'heat', 'wind', 'storm', 'cold']

export interface HexPick {
  cell: string
  point: number
}

/** The day word for a window start: today, tomorrow or the day after (local). */
export function dayKey(windowStartIso: string, tz: string, nowMs: number = Date.now()): 'today' | 'tomorrow' | 'dayAfter' {
  const day = (ms: number) => {
    const z = zonedClock(new Date(ms).toISOString(), 0, tz)
    return z ? Date.parse(`${z.full.slice(0, 10)}T00:00:00Z`) : NaN
  }
  const start = Date.parse(/[zZ]$/.test(windowStartIso) ? windowStartIso : `${windowStartIso}Z`)
  const diff = Math.round((day(start) - day(nowMs)) / 86_400_000)
  return diff <= 0 || Number.isNaN(diff) ? 'today' : diff === 1 ? 'tomorrow' : 'dayAfter'
}

/** The focus of the question: the hazard with the highest firing rule here (or the chosen type). */
export function askFocus(p: HazardPoint, type: HazardType): HazardKind | 'none' {
  if (type !== 'overall') return p.levels[type] !== 'none' ? type : 'none'
  const top = [...p.triggers].sort((a, b) => HAZARD_LEVELS.indexOf(b.level) - HAZARD_LEVELS.indexOf(a.level))[0]
  return top ? top.hazard : 'none'
}

/** The level a hex shows for the chosen hazard type. */
export function levelFor(p: HazardPoint, type: HazardType): HazardLevel {
  return type === 'overall' ? p.overall : p.levels[type]
}

/** Local wall-clock label for a UTC ISO hour. */
export function useHourLabel(tz: string) {
  const { language } = useI18n()
  return useCallback(
    (iso: string | null | undefined) => {
      if (!iso) return ''
      const z = zonedClock(iso, 0, tz)
      return z ? formatLocalTime(z.full.replace(' ', 'T'), language) : ''
    },
    [tz, language]
  )
}

// ---------------------------------------------------------------- data ---

export function useHazard({
  map,
  active,
  hour,
  type,
  centre,
  mapReady,
}: {
  map: MapLibreMap | null
  active: boolean
  hour: number
  type: HazardType
  centre: { latitude: number; longitude: number } | null
  mapReady: boolean
}) {
  const [hazard, setHazard] = useState<MapHazard | null>(null)
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error' | 'too-large'>('idle')
  const [summary, setSummary] = useState<HazardSummary | null>(null)
  const [roads, setRoads] = useState<RoadPiece[]>([])
  const [viewTick, setViewTick] = useState(0)
  const cache = useRef(new Map<string, MapHazard>())

  // The view: refetch after a pan or zoom settles.
  useEffect(() => {
    if (!map || !active || !mapReady) return
    const bump = () => setViewTick((n) => n + 1)
    map.on('moveend', bump)
    const id = window.setTimeout(bump, 0)
    return () => {
      map.off('moveend', bump)
      window.clearTimeout(id)
    }
  }, [map, active, mapReady])

  // Hexes for the view and hour (cached per rounded box and hour).
  useEffect(() => {
    if (!map || !active || !mapReady) return
    const b = map.getBounds()
    const box: Bounds = {
      south: Math.max(-84, b.getSouth()),
      north: Math.min(84, b.getNorth()),
      west: Math.max(-179.9, b.getWest()),
      east: Math.min(179.9, b.getEast()),
    }
    // too large for the tile plan (the backend would answer 422): "zoom in", no request
    if (!gridFits(box)) {
      const id = window.setTimeout(() => setStatus('too-large'), 0)
      return () => window.clearTimeout(id)
    }
    const key = `${box.south.toFixed(2)},${box.west.toFixed(2)},${box.north.toFixed(2)},${box.east.toFixed(2)}|${hour}`
    const hit = cache.current.get(key)
    if (hit) {
      const id = window.setTimeout(() => {
        setHazard(hit)
        setStatus('ready')
      }, 0)
      return () => window.clearTimeout(id)
    }
    const ctrl = new AbortController()
    const id = window.setTimeout(() => {
      setStatus((s) => (s === 'ready' ? s : 'loading'))
      fetchMapHazard(box, hour, ctrl.signal)
        .then((h) => {
          if (cache.current.size > 40) cache.current.delete(cache.current.keys().next().value as string)
          cache.current.set(key, h)
          setHazard(h)
          setStatus('ready')
        })
        .catch((err: unknown) => {
          if (err instanceof DOMException && err.name === 'AbortError') return
          setStatus(err instanceof Error && /422/.test(err.message) ? 'too-large' : 'error')
        })
    }, 250)
    return () => {
      window.clearTimeout(id)
      ctrl.abort()
    }
  }, [map, active, mapReady, hour, viewTick])

  // Summary around the place (or the map centre).
  const cLat = centre?.latitude
  const cLon = centre?.longitude
  useEffect(() => {
    if (!active || cLat == null || cLon == null) return
    const ctrl = new AbortController()
    const id = window.setTimeout(() => {
      fetchHazardSummary(cLat, cLon, hour, ctrl.signal)
        .then(setSummary)
        .catch(() => {
          /* the summary is optional; the hexes still show */
        })
    }, 300)
    return () => {
      window.clearTimeout(id)
      ctrl.abort()
    }
  }, [active, cLat, cLon, hour])

  // Cell -> level for the chosen type.
  const levels = useMemo(() => {
    const m = new Map<string, HazardLevel>()
    if (!hazard) return m
    for (const [cell, i] of hazard.cells) m.set(cell, levelFor(hazard.points[i], type))
    return m
  }, [hazard, type])

  // Roads: only when the view, the data or the type changes, after tiles load.
  useEffect(() => {
    if (!map || !active || !hazard) return
    let done = false
    const run = () => {
      if (done) return
      done = true
      setRoads(roadPieces(map, hazard.h3_resolution, hazard.hex_km, (c) => levels.get(c)))
    }
    if (map.loaded()) {
      const id = window.setTimeout(run, 0)
      return () => window.clearTimeout(id)
    }
    map.once('idle', run)
    return () => {
      done = true
      map.off('idle', run)
    }
  }, [map, active, hazard, levels, viewTick])

  return { hazard, status, summary, roads: active ? roads : [], levels }
}

// -------------------------------------------------------------- layers ---

export function hazardColors(): Record<HazardLevel, RGB> & { outline: RGB; ink: RGB } {
  return {
    none: tokenRgb('--sev-none'),
    advisory: tokenRgb('--sev-advisory'),
    watch: tokenRgb('--sev-watch'),
    warning: tokenRgb('--sev-warning'),
    severe: tokenRgb('--sev-severe'),
    outline: tokenRgb('--sev-severe-text'),
    ink: tokenRgb('--sky-floor', [2, 4, 10]),
  }
}

interface HexDatum {
  cell: string
  point: number
  polygon: [number, number][]
}

export function useHexPolygons(hazard: MapHazard | null): HexDatum[] {
  return useMemo(
    () =>
      hazard
        ? hazard.cells.map(([cell, point]) => ({ cell, point, polygon: cellToBoundary(cell, true) as [number, number][] }))
        : [],
    [hazard]
  )
}

export function hazardLayers({
  hazard,
  hexes,
  roads,
  type,
  colors,
  big,
}: {
  hazard: MapHazard
  hexes: HexDatum[]
  roads: RoadPiece[]
  type: HazardType
  colors: ReturnType<typeof hazardColors>
  big: boolean
}): Layer[] {
  const lvl = (d: HexDatum) => levelFor(hazard.points[d.point], type)
  const roadWidth = (p: RoadPiece) => (p.cls === 'motorway' || p.cls === 'trunk' ? 4 : p.cls === 'primary' ? 3 : 2) * (big ? 1.4 : 1)
  return [
    new PolygonLayer<HexDatum>({
      id: 'hazard-hex',
      data: hexes,
      getPolygon: (d) => d.polygon,
      filled: true,
      stroked: true,
      getFillColor: (d) => {
        const l = lvl(d)
        const c = colors[l]
        return [c[0], c[1], c[2], l === 'none' ? 45 : l === 'severe' ? 200 : 135]
      },
      getLineColor: (d) => (lvl(d) === 'severe' ? [...colors.outline, 255] : [...colors.ink, 70]) as [number, number, number, number],
      getLineWidth: (d) => (lvl(d) === 'severe' ? 2 : 1),
      lineWidthUnits: 'pixels',
      pickable: true,
      updateTriggers: { getFillColor: [type, hazard], getLineColor: [type, hazard], getLineWidth: [type, hazard] },
    }),
    // casing: dark under every road, light under severe ones so dark red stays visible
    new PathLayer<RoadPiece>({
      id: 'hazard-roads-casing',
      data: roads,
      getPath: (p) => p.path,
      getColor: (p) => (p.level === 'severe' ? [...colors.outline, 255] : [...colors.ink, 220]) as [number, number, number, number],
      getWidth: (p) => roadWidth(p) + 3,
      widthUnits: 'pixels',
      capRounded: true,
      jointRounded: true,
    }),
    new PathLayer<RoadPiece>({
      id: 'hazard-roads',
      data: roads,
      getPath: (p) => p.path,
      getColor: (p) => [...colors[p.level as HazardLevel], 255] as [number, number, number, number],
      getWidth: roadWidth,
      widthUnits: 'pixels',
      capRounded: true,
      jointRounded: true,
    }),
  ]
}

// ------------------------------------------------------------------ UI ---

export function HazardTypeChips({ type, onChange }: { type: HazardType; onChange: (t: HazardType) => void }) {
  const { t } = useI18n()
  return (
    <div role="group" aria-label={t('map.hazard.typeLabel')} className="flex flex-wrap gap-1.5">
      {HAZARD_TYPES.map((id) => (
        <button
          key={id}
          type="button"
          data-testid={`map-hazard-${id}`}
          aria-pressed={type === id}
          onClick={() => onChange(id)}
          className={cn(
            'rounded-full border px-2.5 py-1 text-[11px] transition-colors',
            type === id ? 'border-accent bg-accent/15 text-hud' : 'border-white/10 bg-white/[0.04] text-hud-dim hover:text-hud'
          )}
        >
          {t(`map.hazard.${id}` as TranslationKey)}
        </button>
      ))}
    </div>
  )
}

export function HazardLegend({ hazard, roadsShown, tz, big = false }: { hazard: MapHazard; roadsShown: boolean; tz: string; big?: boolean }) {
  const { t } = useI18n()
  const hourLabel = useHourLabel(tz)
  return (
    <div data-testid="map-legend" data-layer="hazard">
      <p className={cn('sky-label', big && 'text-sm')}>{t('map.hazard.legendTitle')}</p>
      <ul className={cn('mt-2 grid grid-cols-1 gap-1', big ? 'text-sm' : 'text-xs')}>
        {HAZARD_LEVELS.map((l) => (
          <li key={l} className="flex items-center gap-2 text-hud" data-testid={`map-legend-${l}`}>
            <span
              aria-hidden
              className="h-3 w-5 shrink-0 rounded-sm"
              style={{ background: `var(--sev-${l})`, outline: l === 'severe' ? '1px solid var(--sev-severe-text)' : undefined }}
            />
            {t(`severity.${l}` as TranslationKey)}
          </li>
        ))}
      </ul>
      <p className={cn('mt-2 text-hud-dim', big ? 'text-xs' : 'text-[11px]')}>
        {fill(t('map.hazard.legendHex'), { time: hourLabel(hazard.window_start), km: hazard.hex_km })}
      </p>
      {roadsShown && (
        <p className={cn('mt-1 font-semibold text-hud', big ? 'text-xs' : 'text-[11px]')} data-testid="map-roads-note">
          {t('map.hazard.legendRoads')}
        </p>
      )}
    </div>
  )
}

const fmt = (v: number | null | undefined) => (v == null ? '—' : String(Math.round(v * 10) / 10))

export function HazardCard({
  hazard,
  pick,
  type,
  tz,
  onClose,
  className,
}: {
  hazard: MapHazard
  pick: HexPick
  type: HazardType
  tz: string
  onClose: () => void
  className?: string
}) {
  const { t } = useI18n()
  const describe = useDescribeWeather()
  const hourLabel = useHourLabel(tz)
  const p = hazard.points[pick.point]
  const level = levelFor(p, type)
  const triggers = type === 'overall' ? p.triggers : p.triggers.filter((tr) => tr.hazard === type)
  const f = p.facts
  // "Ask about this area": the hex centre, the window's day, the main hazard, in the UI language
  const [hexLat, hexLon] = cellToLatLng(pick.cell)
  const question = fill(t(`ask.area.${askFocus(p, type)}` as TranslationKey), {
    day: t(`ask.day.${dayKey(hazard.window_start, tz)}` as TranslationKey),
  })
  const askText = question.charAt(0).toUpperCase() + question.slice(1)

  return (
    <section className={cn('sky-glass map-overlay p-4', className)} data-testid="map-hazard-card" aria-live="polite" aria-label={t('map.hazard.card')}>
      <header className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="sky-label">{t('map.hazard.card')}</h3>
          <p className="mt-1 flex flex-wrap items-center gap-2">
            <SeverityBadge level={level} />
            <span className="text-xs text-hud-dim">{t(`map.hazard.${type}` as TranslationKey)}</span>
          </p>
        </div>
        <button type="button" onClick={onClose} className="rounded-full p-1.5 text-hud-dim hover:bg-white/10 hover:text-hud" aria-label={t('map.point.close')}>
          <X className="h-4 w-4" aria-hidden />
        </button>
      </header>

      <p className="text-xs text-hud" data-testid="map-hazard-window">
        {t('map.hazard.window')}: {hourLabel(hazard.window_start)} – {hourLabel(hazard.window_end)}
      </p>

      <h4 className="mt-3 text-[11px] uppercase tracking-wide text-hud-dim">{t('map.hazard.why')}</h4>
      {triggers.length === 0 ? (
        <p className="text-xs text-hud" data-testid="map-hazard-none">{t('map.hazard.noTrigger')}</p>
      ) : (
        <ul className="mt-1 space-y-1.5">
          {triggers.map((tr) => (
            <li key={tr.rule_id} className="text-xs text-hud" data-testid={`map-hazard-trigger-${tr.hazard}`}>
              <span className="flex flex-wrap items-center gap-1.5">
                <SeverityBadge level={tr.level} />
                <span className="font-semibold">{t(`threshold.${tr.rule_id}` as TranslationKey)}</span>
              </span>
              <span className="font-readout text-hud" data-testid="map-hazard-value">
                {tr.comparator === 'in'
                  ? `${describe(tr.value) ?? ''} (WMO ${tr.value})`
                  : `${fmt(tr.value)} ${tr.unit} ${tr.comparator === '>=' ? '≥' : '≤'} ${fmt(tr.threshold)} ${tr.unit}`}
              </span>
            </li>
          ))}
        </ul>
      )}

      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        <dt className="text-hud-dim">{t('map.hazard.rain24')}</dt>
        <dd className="font-readout text-hud" data-testid="map-hazard-rain">{fmt(f.rain_mm)} mm</dd>
        <dt className="text-hud-dim">{t('map.hazard.tmax')}</dt>
        <dd className="font-readout text-hud">{fmt(f.temp_max)} °C</dd>
        <dt className="text-hud-dim">{t('map.hazard.tmin')}</dt>
        <dd className="font-readout text-hud">{fmt(f.temp_min)} °C</dd>
        <dt className="text-hud-dim">{t('map.hazard.wmax')}</dt>
        <dd className="font-readout text-hud">{fmt(f.wind_max)} km/h</dd>
        <dt className="text-hud-dim">{t('map.hazard.hi')}</dt>
        <dd className="font-readout text-hud">{fmt(f.heat_index_max)} °C</dd>
        {f.weather_code != null && (
          <>
            <dt className="text-hud-dim">{t('map.hazard.weather')}</dt>
            <dd className="text-hud">{describe(f.weather_code) ?? `WMO ${f.weather_code}`}</dd>
          </>
        )}
      </dl>

      <p className="mt-3 text-[11px] leading-snug text-hud-dim" data-testid="map-hazard-note">
        {fill(t('map.hazard.note'), { km: hazard.model_grid_km })}
        <br />
        {fill(t('map.hazard.hex'), { km: hazard.hex_km, res: hazard.h3_resolution, lat: p.latitude.toFixed(2), lon: p.longitude.toFixed(2) })}
      </p>
      <SkyLinkButton
        href={askHref(askText, { latitude: Number(hexLat.toFixed(4)), longitude: Number(hexLon.toFixed(4)) })}
        variant="subtle"
        className="mt-3 w-full justify-center"
        data-testid="map-hazard-ask"
      >
        <MessageCircle className="h-4 w-4" aria-hidden /> {t('map.hazard.ask')}
      </SkyLinkButton>
    </section>
  )
}

export function HazardSummaryPanel({
  summary,
  placeName,
  tz,
  onShowWorst,
}: {
  summary: HazardSummary
  placeName: string | null
  tz: string
  onShowWorst: (lat: number, lon: number, hour: number) => void
}) {
  const { t } = useI18n()
  const hourLabel = useHourLabel(tz)
  const shown = HAZARD_LEVELS.filter((l) => l !== 'none' && summary.counts[l] > 0).reverse()
  const worst = summary.worst_ahead
  const when =
    summary.worst_ahead_hour == null
      ? ''
      : summary.worst_ahead_hour === 0
        ? t('map.hazard.now')
        : fill(t('map.hazard.inHours'), { h: summary.worst_ahead_hour })

  return (
    <section className="sky-glass map-overlay p-4" data-testid="map-hazard-summary" aria-live="polite">
      <h3 className="sky-label">
        {fill(t('map.hazard.summaryTitle'), { r: summary.radius_km, place: placeName ?? t('map.hazard.mapCentre') })}
      </h3>
      <ul className="mt-2 flex flex-wrap gap-2" data-testid="map-hazard-counts">
        {shown.length === 0 ? (
          <li className="text-xs text-hud">
            <SeverityBadge level="none" /> {fill(t('map.hazard.cells'), { n: summary.counts.none })}
          </li>
        ) : (
          shown.map((l) => (
            <li key={l} className="flex items-center gap-1.5 text-xs text-hud" data-testid={`map-hazard-count-${l}`}>
              <SeverityBadge level={l} /> {fill(t('map.hazard.cells'), { n: summary.counts[l] })}
            </li>
          ))
        )}
      </ul>
      {summary.max_rain_mm != null && (
        <p className="mt-2 text-xs text-hud" data-testid="map-hazard-maxrain">
          {fill(t('map.hazard.maxRain'), { v: summary.max_rain_mm })}
        </p>
      )}
      <p className="mt-1 text-xs text-hud" data-testid="map-hazard-worst">
        {worst
          ? fill(t('map.hazard.worstAhead'), {
              level: t(`severity.${worst.level}` as TranslationKey),
              time: hourLabel(summary.worst_ahead_time),
              when,
            })
          : t('map.hazard.calm')}
      </p>
      <p className="mt-1 text-[11px] text-hud-dim">{fill(t('map.hazard.note'), { km: summary.model_grid_km })}</p>
      {worst && summary.worst_ahead_hour != null && (
        <SkyButton
          variant="primary"
          className="mt-3"
          data-testid="map-show-worst"
          onClick={() => onShowWorst(worst.latitude, worst.longitude, summary.worst_ahead_hour ?? 0)}
        >
          <Crosshair className="h-4 w-4" aria-hidden /> {t('map.hazard.showWorst')}
        </SkyButton>
      )}
    </section>
  )
}
