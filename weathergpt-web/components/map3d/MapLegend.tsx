'use client'

/**
 * Legend for the active /map layer. The min and max are the data's own range
 * at the hour shown (GET /api/map/grid), the same scale the surface uses; heat
 * bands and their lower bounds come from backend/thresholds.py through the
 * same response.
 */

import { fill, useI18n, type TranslationKey } from '@/context/I18nContext'
import type { MapGrid } from '@/lib/api/map'
import { cn } from '@/lib/utils'
import { LAYER_UNIT, rampCss, scaleRange, type LayerId } from './field'

const fmt = (v: number) => String(Math.round(v * 10) / 10)

export function MapLegend({
  grid,
  layer,
  hour,
  fixed,
  timeLabel,
  big = false,
}: {
  grid: MapGrid
  layer: LayerId
  hour: number
  /** playing: one scale for all hours */
  fixed: boolean
  timeLabel: string
  big?: boolean
}) {
  const { t } = useI18n()
  const title = t(`map.layer.${layer}` as TranslationKey)
  const unit = LAYER_UNIT[layer]

  if (layer === 'heat') {
    return (
      <div data-testid="map-legend" data-layer={layer}>
        <p className={cn('sky-label', big && 'text-sm')}>
          {title} · {unit}
        </p>
        <ul className={cn('mt-2 space-y-1', big ? 'text-sm' : 'text-xs')}>
          {grid.heat_index_bands.map((b, i) => (
            <li key={b.id} className="flex items-center gap-2 text-hud">
              <span aria-hidden className="h-3 w-5 shrink-0 rounded-sm" style={{ background: `var(--map-heat-${i})` }} />
              <span className="min-w-0">
                {t(`map.heat.${b.id}` as TranslationKey)} <span className="font-readout text-hud-dim">≥ {fmt(b.min_c)}</span>
              </span>
            </li>
          ))}
        </ul>
        <p className={cn('mt-2 text-hud-dim', big ? 'text-xs' : 'text-[11px]')}>{t('map.heat.guidance')}</p>
      </div>
    )
  }

  const range = scaleRange(grid, layer, hour, fixed)
  const fixedScale = fixed || layer === 'rain'
  return (
    <div data-testid="map-legend" data-layer={layer}>
      <p className={cn('sky-label', big && 'text-sm')}>
        {title} · {unit}
      </p>
      <div aria-hidden className={cn('mt-2 rounded-full', big ? 'h-3' : 'h-2')} style={{ background: rampCss(layer) }} />
      {range && (
        <p className={cn('mt-1 flex justify-between font-readout text-hud', big ? 'text-sm' : 'text-xs')}>
          <span data-testid="map-legend-min">{layer === 'rain' ? '0.1' : fmt(range.min)}</span>
          <span data-testid="map-legend-max">{fmt(range.max)}</span>
        </p>
      )}
      <p className={cn('mt-1 text-hud-dim', big ? 'text-xs' : 'text-[11px]')}>
        {layer === 'rain' ? `${t('map.rainDry')} · ` : ''}
        {t('map.interpolated')}
      </p>
      <p
        className={cn('mt-1 text-hud', big ? 'text-xs' : 'text-[11px]')}
        data-testid="map-legend-scale"
        data-scale={fixedScale ? 'fixed' : 'hour'}
      >
        {fixedScale ? t('map.scale.fixed') : fill(t('map.scale.hour'), { time: timeLabel })}
      </p>
    </div>
  )
}
