'use client'

/**
 * Small daily chart (inline SVG, no chart library): lines or bars over days.
 *
 * Follows the dataviz rules: one y-axis (different units get separate
 * charts), 2 px lines, ≥ 8 px hover markers, bars with rounded top ends on
 * the baseline and a 2 px gap, recessive grid, a crosshair + tooltip on hover
 * (and keyboard focus), legend for ≥ 2 series, and text in text colours, not
 * series colours. Series colours were checked with the dataviz palette
 * validator against the dark surface.
 */

import { useEffect, useId, useMemo, useRef, useState } from 'react'

export interface Series {
  key: string
  label: string
  color: string
  values: (number | null | undefined)[]
}

interface DailyChartProps {
  title: string
  labels: string[] // one per day, already formatted for display (tooltip)
  /** Shorter labels for the x-axis (defaults to labels). */
  axisLabels?: string[]
  series: Series[]
  kind: 'line' | 'bar'
  unit: string
  height?: number
  /** Bars start at zero; lines pad around the data range. */
  zeroBased?: boolean
}

const PAD = { top: 12, right: 12, bottom: 24, left: 36 }

function niceTicks(min: number, max: number, count = 4): number[] {
  if (min === max) return [min]
  const span = max - min
  const step0 = span / count
  const mag = 10 ** Math.floor(Math.log10(step0))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0) ?? step0
  const start = Math.floor(min / step) * step
  const ticks: number[] = []
  for (let v = start; v <= max + step * 0.001; v += step) ticks.push(Math.round(v * 100) / 100)
  return ticks
}

export function DailyChart({ title, labels, axisLabels, series, kind, unit, height = 200, zeroBased = kind === 'bar' }: DailyChartProps) {
  const id = useId()
  const [hover, setHover] = useState<number | null>(null)
  // Draw in real pixels so axis text stays readable at 390 px (no viewBox shrink).
  const box = useRef<HTMLDivElement>(null)
  const [W, setW] = useState(720)
  useEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setW(Math.max(260, Math.round(e.contentRect.width))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const n = labels.length
  const H = height
  const innerW = W - PAD.left - PAD.right
  const innerH = H - PAD.top - PAD.bottom

  const { lo, hi, ticks } = useMemo(() => {
    const all = series.flatMap((s) => s.values.filter((v): v is number => typeof v === 'number'))
    let lo = all.length ? Math.min(...all) : 0
    let hi = all.length ? Math.max(...all) : 1
    if (zeroBased) lo = Math.min(0, lo)
    else {
      const pad = Math.max(1, (hi - lo) * 0.15)
      lo -= pad
      hi += pad
    }
    if (hi === lo) hi = lo + 1
    const ticks = niceTicks(lo, hi)
    return { lo: Math.min(lo, ticks[0]), hi: Math.max(hi, ticks[ticks.length - 1]), ticks }
  }, [series, zeroBased])

  const x = (i: number) => PAD.left + (n <= 1 ? innerW / 2 : kind === 'bar' ? ((i + 0.5) * innerW) / n : (i * innerW) / (n - 1))
  const y = (v: number) => PAD.top + innerH - ((v - lo) / (hi - lo)) * innerH
  const band = innerW / Math.max(1, n)
  const barW = Math.max(2, band / series.length - 2)

  const tipX = hover != null ? x(hover) : 0
  const tipLeft = hover != null ? `${Math.min(Math.max((tipX / W) * 100, 12), 88)}%` : '0'
  // label roughly every 5 days so they never collide
  const every = Math.max(1, Math.ceil(n / Math.max(3, Math.floor(W / 120))))

  return (
    <figure className="min-w-0">
      <figcaption className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="sky-label">{title}</span>
        {series.length > 1 && (
          <span className="flex flex-wrap gap-3 text-xs text-hud-dim">
            {series.map((s) => (
              <span key={s.key} className="inline-flex items-center gap-1.5">
                <span aria-hidden="true" className="inline-block h-0.5 w-4 rounded" style={{ background: s.color }} />
                {s.label}
              </span>
            ))}
          </span>
        )}
      </figcaption>
      <div ref={box} className="relative">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          width={W}
          height={H}
          className="block w-full"
          role="img"
          aria-labelledby={`${id}-t`}
          onMouseLeave={() => setHover(null)}
        >
          <title id={`${id}-t`}>{title}</title>
          {ticks.map((tk) => (
            <g key={tk}>
              <line x1={PAD.left} x2={W - PAD.right} y1={y(tk)} y2={y(tk)} stroke="rgba(160,200,255,0.08)" />
              <text x={PAD.left - 6} y={y(tk) + 3} textAnchor="end" className="fill-[rgba(205,220,245,0.55)] font-readout text-[10px]">
                {tk}
              </text>
            </g>
          ))}
          {labels.map((l, i) =>
            (i % every === 0 && x(n - 1) - x(i) >= 80) || i === n - 1 ? (
              <text key={i} x={x(i)} y={H - 6} textAnchor={i === n - 1 ? 'end' : i === 0 && kind === 'line' ? 'start' : 'middle'} className="fill-[rgba(205,220,245,0.55)] font-readout text-[10px]">
                {axisLabels?.[i] ?? l}
              </text>
            ) : null
          )}

          {kind === 'line' &&
            series.map((s) => {
              const pts = s.values.map((v, i) => (typeof v === 'number' ? `${x(i)},${y(v)}` : null)).filter(Boolean)
              return <polyline key={s.key} points={pts.join(' ')} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            })}

          {kind === 'bar' &&
            series.map((s, si) =>
              s.values.map((v, i) => {
                if (typeof v !== 'number' || v <= 0) return null
                const top = y(v)
                const h = y(0) - top
                const bx = PAD.left + i * band + 1 + si * (barW + 2)
                const r = Math.min(4, barW / 2, h)
                return (
                  <path
                    key={`${s.key}-${i}`}
                    d={`M${bx},${y(0)} V${top + r} Q${bx},${top} ${bx + r},${top} H${bx + barW - r} Q${bx + barW},${top} ${bx + barW},${top + r} V${y(0)} Z`}
                    fill={s.color}
                    opacity={hover == null || hover === i ? 1 : 0.55}
                  />
                )
              })
            )}

          {hover != null && (
            <g pointerEvents="none">
              <line x1={tipX} x2={tipX} y1={PAD.top} y2={PAD.top + innerH} stroke="rgba(231,240,255,0.35)" strokeDasharray="3 3" />
              {kind === 'line' &&
                series.map((s) =>
                  typeof s.values[hover] === 'number' ? (
                    <circle key={s.key} cx={tipX} cy={y(s.values[hover] as number)} r={4.5} fill={s.color} stroke="#0b1220" strokeWidth={2} />
                  ) : null
                )}
            </g>
          )}

          {/* hit targets wider than the marks; focusable for keyboard users */}
          {labels.map((l, i) => (
            <rect
              key={i}
              x={kind === 'bar' ? PAD.left + i * band : x(i) - band / 2}
              y={PAD.top}
              width={band}
              height={innerH}
              fill="transparent"
              tabIndex={0}
              aria-label={`${l}: ${series.map((s) => `${s.label} ${s.values[i] ?? '—'} ${unit}`).join(', ')}`}
              onMouseEnter={() => setHover(i)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
            />
          ))}
        </svg>

        {hover != null && (
          <div
            role="status"
            className="pointer-events-none absolute top-0 -translate-x-1/2 rounded-lg border border-white/10 bg-[#081020]/95 px-2.5 py-1.5 text-xs shadow-lg"
            style={{ left: tipLeft }}
          >
            <p className="font-medium text-hud">{labels[hover]}</p>
            {series.map((s) => (
              <p key={s.key} className="flex items-center gap-1.5 text-hud-dim">
                <span aria-hidden="true" className="size-2 rounded-full" style={{ background: s.color }} />
                {s.label}: <span className="font-readout text-hud">{s.values[hover] ?? '—'} {unit}</span>
              </p>
            ))}
          </div>
        )}
      </div>
    </figure>
  )
}
