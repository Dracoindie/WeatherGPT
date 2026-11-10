'use client'

/**
 * The experimental waterlogging layer on /map (docs/WATERLOGGING.md): ~1 km
 * H3 hexagons coloured by the estimated level, a legend that says how it is
 * made and that it is experimental, and a tap card with the parts (rain, how
 * low the ground lies, nearby reports). Never an alert; never official.
 */

import type { Layer } from '@deck.gl/core'
import { PolygonLayer } from '@deck.gl/layers'
import { cellToBoundary } from 'h3-js'
import { X } from 'lucide-react'
import type { Map as MapLibreMap } from 'maplibre-gl'
import { useEffect, useMemo, useState } from 'react'
import { fill, useI18n, type TranslationKey } from '@/context/I18nContext'
import { fetchWaterlogging, WATERLOG_MAX_BOX_DEG, WaterlogError, type WaterlogCell, type Waterlogging, type WaterlogLevel } from '@/lib/api/waterlogging'
import { zonedClock } from '@/lib/format'
import { cn } from '@/lib/utils'
import { tokenRgb, type RGB } from './field'

export type WaterlogStatus = 'idle' | 'loading' | 'ready' | 'error' | 'too-large'
export const WATERLOG_LEVELS: WaterlogLevel[] = ['low', 'moderate', 'high']

export function useWaterlogging({ map, active, mapReady }: { map: MapLibreMap | null; active: boolean; mapReady: boolean }) {
  const [data, setData] = useState<Waterlogging | null>(null)
  const [status, setStatus] = useState<WaterlogStatus>('idle')
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (!map || !active || !mapReady) return
    const bump = () => setTick((n) => n + 1)
    map.on('moveend', bump)
    return () => {
      map.off('moveend', bump)
    }
  }, [map, active, mapReady])

  useEffect(() => {
    if (!map || !active || !mapReady) return
    const b = map.getBounds()
    const box = { south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast() }
    // larger than a city: the backend would answer 422; say "zoom in" without asking
    if (box.north - box.south > WATERLOG_MAX_BOX_DEG || box.east - box.west > WATERLOG_MAX_BOX_DEG) {
      const id = window.setTimeout(() => setStatus('too-large'), 0)
      return () => window.clearTimeout(id)
    }
    const ctrl = new AbortController()
    const id = window.setTimeout(() => {
      setStatus('loading')
      fetchWaterlogging(box, ctrl.signal)
        .then((d) => {
          setData(d)
          setStatus('ready')
        })
        .catch((err: unknown) => {
          if (err instanceof DOMException && err.name === 'AbortError') return
          setStatus(err instanceof WaterlogError && err.status === 422 ? 'too-large' : 'error')
        })
    }, 400)
    return () => {
      window.clearTimeout(id)
      ctrl.abort()
    }
  }, [map, active, mapReady, tick])

  return { data: active && status === 'ready' ? data : null, status, retry: () => setTick((n) => n + 1) }
}

export function waterlogColors(): Record<WaterlogLevel, RGB> & { outline: RGB; pick: RGB } {
  return {
    low: tokenRgb('--map-wl-low', [29, 78, 216]),
    moderate: tokenRgb('--map-wl-moderate', [59, 130, 246]),
    high: tokenRgb('--map-wl-high', [147, 197, 253]),
    outline: tokenRgb('--map-base', [11, 18, 32]),
    pick: tokenRgb('--map-gold', [252, 211, 77]),
  }
}

interface HexDatum {
  cell: WaterlogCell
  polygon: [number, number][]
}

export function useWaterlogHexes(data: Waterlogging | null): HexDatum[] {
  return useMemo(() => (data ? data.cells.map((cell) => ({ cell, polygon: cellToBoundary(cell.cell, true) as [number, number][] })) : []), [data])
}

const ALPHA: Record<WaterlogLevel, number> = { low: 110, moderate: 150, high: 200 }

export function waterlogLayers({ hexes, picked, colors }: { hexes: HexDatum[]; picked: string | null; colors: ReturnType<typeof waterlogColors> }): Layer[] {
  return [
    new PolygonLayer<HexDatum>({
      id: 'waterlog-hex',
      data: hexes,
      getPolygon: (d) => d.polygon,
      filled: true,
      stroked: true,
      getFillColor: (d) => [...colors[d.cell.level], ALPHA[d.cell.level]] as [number, number, number, number],
      getLineColor: (d) => (d.cell.cell === picked ? [...colors.pick, 255] : [...colors.outline, 90]) as [number, number, number, number],
      getLineWidth: (d) => (d.cell.cell === picked ? 3 : 1),
      lineWidthUnits: 'pixels',
      pickable: true,
      updateTriggers: { getLineColor: picked, getLineWidth: picked },
    }),
  ]
}

function useWindow(tz: string) {
  return (iso: string | null) => (iso ? (zonedClock(iso, 0, tz)?.clock ?? '') : '')
}

export function WaterlogLegend({ data, tz, big = false }: { data: Waterlogging | null; tz: string; big?: boolean }) {
  const { t } = useI18n()
  const clock = useWindow(tz)
  return (
    <div data-testid="map-legend" data-layer="waterlogging">
      <p className={cn('sky-label', big && 'text-sm')}>{t('wl.legendTitle')}</p>
      <ul className={cn('mt-2 space-y-1 text-hud', big ? 'text-sm' : 'text-xs')}>
        {WATERLOG_LEVELS.map((l) => (
          <li key={l} className="flex items-center gap-2" data-testid={`wl-legend-${l}`}>
            <span aria-hidden className="h-3 w-5 shrink-0 rounded-sm" style={{ background: `var(--map-wl-${l})` }} />
            {t(`wl.level.${l}` as TranslationKey)}
          </li>
        ))}
      </ul>
      {data?.window_start && (
        <p className={cn('mt-2 text-hud', big ? 'text-xs' : 'text-[11px]')} data-testid="wl-window">
          {fill(t('wl.window'), { start: clock(data.window_start), end: clock(data.window_end) })}
        </p>
      )}
      <p className={cn('mt-1 text-hud-dim', big ? 'text-xs' : 'text-[11px]')} data-testid="wl-how">
        {fill(t('wl.how'), { km: data?.model_grid_km ?? 8 })}
      </p>
      <p className={cn('mt-1 font-semibold text-hud', big ? 'text-xs' : 'text-[11px]')}>{t('wl.experimental')}</p>
      <p className={cn('mt-1 text-hud-dim', big ? 'text-xs' : 'text-[11px]')} data-testid="wl-defaults">{t('wl.defaults')}</p>
    </div>
  )
}

export function WaterlogCard({ cell, onClose, className }: { cell: WaterlogCell; onClose: () => void; className?: string }) {
  const { t } = useI18n()
  const p = cell.parts
  const lowText =
    p.low_m == null ? t('wl.lowUnknown') : p.low_m > 0 ? fill(t('wl.lowBelow'), { m: p.low_m }) : fill(t('wl.lowAbove'), { m: Math.abs(p.low_m) })
  return (
    <section className={cn('sky-glass map-overlay p-4', className)} data-testid="wl-card" data-level={cell.level} aria-live="polite" aria-label={t('wl.card')}>
      <header className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="sky-label">{t('wl.card')}</p>
          <p className="mt-1 flex items-center gap-2 text-base font-semibold text-hud" data-testid="wl-level">
            <span aria-hidden className="h-3 w-5 shrink-0 rounded-sm" style={{ background: `var(--map-wl-${cell.level})` }} />
            {t(`wl.level.${cell.level}` as TranslationKey)}
          </p>
        </div>
        <button type="button" onClick={onClose} className="rounded-full p-1.5 text-hud-dim hover:bg-white/10 hover:text-hud" aria-label={t('map.point.close')}>
          <X className="h-4 w-4" aria-hidden />
        </button>
      </header>
      <dl className="space-y-2 text-xs">
        <div>
          <dt className="text-hud-dim">{t('wl.rain')}</dt>
          <dd className="font-readout text-hud" data-testid="wl-rain">
            {fill(t('wl.rainValue'), { mm: p.rain_mm, peak: p.peak_mm_h })}
          </dd>
        </div>
        <div>
          <dt className="text-hud-dim">{t('wl.ground')}</dt>
          <dd className="text-hud" data-testid="wl-low">{lowText}</dd>
        </div>
        <div>
          <dt className="text-hud-dim">{t('wl.reports')}</dt>
          <dd className="font-readout text-hud" data-testid="wl-reports">{p.reports}</dd>
        </div>
      </dl>
      <p className="mt-3 text-[11px] leading-snug text-hud-dim">{t('wl.cardNote')}</p>
    </section>
  )
}
