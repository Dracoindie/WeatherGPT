'use client'

/**
 * Community reports on /map (docs/REPORTS.md): the reports layer (dots
 * coloured by kind, sized by trust), the tap card (kind, approximate time,
 * photo, trust and why, Confirm / Flag) and the "Report what you see" flow
 * (tap the place or use the map centre, pick a kind, optional note and photo).
 *
 * Every report is labelled "community report, unverified"; reports never
 * change forecasts or alert levels, and the reporter is "a resident".
 */

import type { Layer } from '@deck.gl/core'
import { ScatterplotLayer } from '@deck.gl/layers'
import { Camera, Check, Crosshair, Flag, LoaderCircle, Megaphone, X } from 'lucide-react'
import Link from 'next/link'
import type { Map as MapLibreMap } from 'maplibre-gl'
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { SkyButton } from '@/components/ui/SkyButton'
import { fill, useI18n, type TranslationKey } from '@/context/I18nContext'
import {
  createReport,
  fetchReports,
  MAX_BOX_DEG,
  photoForUpload,
  REPORT_GROUP,
  REPORT_KINDS,
  ReportError,
  reportPhotoUrl,
  voteReport,
  type Report,
  type ReportErrorCode,
  type ReportKind,
  type TrustLevel,
  type Vote,
} from '@/lib/api/reports'
import { zonedClock } from '@/lib/format'
import { cn } from '@/lib/utils'
import { tokenRgb, type RGB } from './field'

type Status = 'idle' | 'loading' | 'ready' | 'error' | 'too-large'

/** Dot radius (px) by trust: the legend says "bigger dot = higher trust". */
export const TRUST_RADIUS: Record<TrustLevel, number> = { low: 6, medium: 9, high: 12 }

// ---------------------------------------------------------------- data ---

export function useReports({ map, active, mapReady, token }: { map: MapLibreMap | null; active: boolean; mapReady: boolean; token: string | null }) {
  const [reports, setReports] = useState<Report[]>([])
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState<ReportErrorCode | null>(null)
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
    const box = { south: Math.max(-84, b.getSouth()), north: Math.min(84, b.getNorth()), west: Math.max(-179.9, b.getWest()), east: Math.min(179.9, b.getEast()) }
    if (box.north - box.south > MAX_BOX_DEG || box.east - box.west > MAX_BOX_DEG) {
      const id = window.setTimeout(() => setStatus('too-large'), 0)
      return () => window.clearTimeout(id)
    }
    const ctrl = new AbortController()
    const id = window.setTimeout(() => {
      setStatus((s) => (s === 'ready' ? s : 'loading'))
      fetchReports(box, token, ctrl.signal)
        .then((r) => {
          setReports(r.reports)
          setStatus('ready')
          setError(null)
        })
        .catch((err: unknown) => {
          if (err instanceof DOMException && err.name === 'AbortError') return
          setError(err instanceof ReportError ? err.code : 'unavailable')
          setStatus('error')
        })
    }, 300)
    return () => {
      window.clearTimeout(id)
      ctrl.abort()
    }
  }, [map, active, mapReady, token, tick])

  /** A report came back from a vote or was just made: show it at once. */
  const upsert = useCallback((r: Report) => {
    setReports((list) => [r, ...list.filter((x) => x.id !== r.id)])
  }, [])
  const reload = useCallback(() => setTick((n) => n + 1), [])

  return { reports: active ? reports : [], status, error, upsert, reload }
}

// -------------------------------------------------------------- layers ---

export function reportColors(): Record<'rain' | 'wind' | 'ground', RGB> & { outline: RGB; draft: RGB } {
  return {
    rain: tokenRgb('--map-report-rain', [56, 189, 248]),
    wind: tokenRgb('--map-report-wind', [241, 245, 249]),
    ground: tokenRgb('--map-report-ground', [245, 158, 11]),
    outline: tokenRgb('--map-base', [11, 18, 32]),
    draft: tokenRgb('--map-gold', [252, 211, 77]),
  }
}

export function reportLayers({
  reports,
  draft,
  selected,
  colors,
  big,
}: {
  reports: Report[]
  draft: { latitude: number; longitude: number } | null
  selected: string | null
  colors: ReturnType<typeof reportColors>
  big: boolean
}): Layer[] {
  const k = big ? 1.3 : 1
  const out: Layer[] = [
    new ScatterplotLayer<Report>({
      id: 'reports',
      data: reports,
      getPosition: (r) => [r.longitude, r.latitude],
      getRadius: (r) => TRUST_RADIUS[r.trust.level] * k,
      radiusUnits: 'pixels',
      getFillColor: (r) => [...colors[REPORT_GROUP[r.kind]], 235] as [number, number, number, number],
      stroked: true,
      getLineColor: [...colors.outline, 255],
      getLineWidth: 2,
      lineWidthUnits: 'pixels',
      pickable: true,
      updateTriggers: { getRadius: big, getFillColor: reports },
    }),
  ]
  const picked = selected ? reports.find((r) => r.id === selected) : undefined
  if (picked) {
    // the tapped report: a gold ring around its dot
    out.push(
      new ScatterplotLayer<Report>({
        id: 'report-selected',
        data: [picked],
        getPosition: (r) => [r.longitude, r.latitude],
        getRadius: (r) => TRUST_RADIUS[r.trust.level] * k + 5,
        radiusUnits: 'pixels',
        filled: false,
        stroked: true,
        getLineColor: [...colors.draft, 255],
        getLineWidth: 3,
        lineWidthUnits: 'pixels',
      })
    )
  }
  if (draft) {
    out.push(
      new ScatterplotLayer({
        id: 'report-draft',
        data: [draft],
        getPosition: (d: { latitude: number; longitude: number }) => [d.longitude, d.latitude],
        getRadius: 11,
        radiusUnits: 'pixels',
        filled: false,
        stroked: true,
        getLineColor: [...colors.draft, 255],
        getLineWidth: 3,
        lineWidthUnits: 'pixels',
      })
    )
  }
  return out
}

// ------------------------------------------------------------------ UI ---

export function useReportWords() {
  const { t } = useI18n()
  const ago = useCallback(
    (iso: string, nowMs: number) => {
      const min = Math.max(0, (nowMs - Date.parse(iso)) / 60_000)
      if (min < 60) return fill(t('report.agoMin'), { n: Math.max(10, Math.round(min / 10) * 10) })
      return fill(t('report.agoHour'), { n: Math.round(min / 60) })
    },
    [t]
  )
  const errorText = useCallback(
    (e: ReportError | ReportErrorCode) => {
      const code = typeof e === 'string' ? e : e.code
      const s = typeof e === 'string' ? null : e.retryAfter
      return fill(t(`report.err.${code}` as TranslationKey), { s: s ?? 60 })
    },
    [t]
  )
  return { ago, errorText }
}

export function ReportsLegend({ big = false }: { big?: boolean }) {
  const { t } = useI18n()
  return (
    <div data-testid="map-legend" data-layer="reports">
      <p className={cn('sky-label', big && 'text-sm')}>{t('report.legendTitle')}</p>
      <ul className={cn('mt-2 space-y-1 text-hud', big ? 'text-sm' : 'text-xs')}>
        {(['rain', 'wind', 'ground'] as const).map((g) => (
          <li key={g} className="flex items-center gap-2" data-testid={`report-legend-${g}`}>
            <span aria-hidden className="size-3 shrink-0 rounded-full border-2 border-[var(--map-base)]" style={{ background: `var(--map-report-${g})` }} />
            {t(`report.group.${g}` as TranslationKey)}
          </li>
        ))}
      </ul>
      <p className={cn('mt-2 flex items-center gap-1.5 text-hud-dim', big ? 'text-xs' : 'text-[11px]')}>
        {(['low', 'medium', 'high'] as const).map((l) => (
          <span key={l} aria-hidden className="inline-block rounded-full bg-[var(--sky-text)]" style={{ width: TRUST_RADIUS[l], height: TRUST_RADIUS[l] }} />
        ))}
        <span>{t('report.legendSize')}</span>
      </p>
      <p className={cn('mt-1 text-hud-dim', big ? 'text-xs' : 'text-[11px]')}>{t('report.legendNote')}</p>
    </div>
  )
}

const TRUST_STYLE: Record<TrustLevel, string> = {
  low: 'border-white/15 text-hud-dim',
  medium: 'border-accent/40 text-hud',
  high: 'border-sev-none/60 text-sev-none-text',
}

export function TrustBadge({ level }: { level: TrustLevel }) {
  const { t } = useI18n()
  return (
    <span className={cn('inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold', TRUST_STYLE[level])} data-testid="report-trust" data-level={level}>
      {t(`report.trust.${level}` as TranslationKey)}
    </span>
  )
}

export function ReportCard({
  report,
  token,
  tz,
  onClose,
  onUpdated,
  className,
}: {
  report: Report
  token: string | null
  tz: string
  onClose: () => void
  onUpdated: (r: Report) => void
  className?: string
}) {
  const { t } = useI18n()
  const { ago, errorText } = useReportWords()
  const [busy, setBusy] = useState<Vote | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  // the clock only matters at render; a stale "ago" for a few minutes is fine
  const [now] = useState(() => Date.now())
  const until = zonedClock(report.expires_at, 0, tz)
  const parts = report.trust.parts

  const vote = async (v: Vote) => {
    if (!token) return
    setBusy(v)
    setMsg(null)
    try {
      onUpdated(await voteReport(report.id, v, token))
    } catch (err) {
      setMsg(errorText(err instanceof ReportError ? err : 'unavailable'))
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className={cn('sky-glass map-overlay p-4', className)} data-testid="report-card" data-kind={report.kind} aria-live="polite" aria-label={t('report.card')}>
      <header className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="sky-label">{t('report.label')}</p>
          <h3 className="mt-1 text-base font-semibold text-hud" data-testid="report-kind">
            {t(`report.kind.${report.kind}` as TranslationKey)}
          </h3>
          <p className="mt-1 flex flex-wrap items-center gap-2">
            <TrustBadge level={report.trust.level} />
          </p>
        </div>
        <button type="button" onClick={onClose} className="rounded-full p-1.5 text-hud-dim hover:bg-white/10 hover:text-hud" aria-label={t('map.point.close')}>
          <X className="h-4 w-4" aria-hidden />
        </button>
      </header>

      <p className="text-xs text-hud" data-testid="report-by">
        {fill(t('report.by'), { ago: ago(report.reported_at, now) })}
      </p>
      {until && <p className="text-[11px] text-hud-dim">{fill(t('report.until'), { time: until.clock })}</p>}
      {report.note && (
        <p className="mt-2 break-words text-sm text-hud" data-testid="report-note">
          “{report.note}”
        </p>
      )}
      {report.has_photo && (
        // the backend's own endpoint serves a re-encoded JPEG with no metadata; nothing for next/image to optimise
        // eslint-disable-next-line @next/next/no-img-element
        <img src={reportPhotoUrl(report.id)} alt={t('report.photoAlt')} loading="lazy" className="mt-2 max-h-48 w-full rounded-lg object-cover" data-testid="report-photo" />
      )}

      <h4 className="mt-3 text-[11px] uppercase tracking-wide text-hud-dim">{t('report.why')}</h4>
      <dl className="mt-1 space-y-1 text-xs" data-testid="report-why">
        {(['model', 'nearby', 'age', 'reporter'] as const).map((k) => (
          <div key={k} className="flex items-center gap-2">
            <dt className="w-40 shrink-0 text-hud-dim">{t(`report.part.${k}` as TranslationKey)}</dt>
            <dd className="flex min-w-0 flex-1 items-center gap-2">
              <span aria-hidden className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
                <span className="block h-full rounded-full bg-accent" style={{ width: `${Math.round(parts[k] * 100)}%` }} />
              </span>
              <span className="w-9 text-right font-readout text-hud">{Math.round(parts[k] * 100)}%</span>
            </dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 text-[11px] text-hud-dim" data-testid="report-counts">
        {fill(t('report.confirms'), { n: report.confirms })}
        {report.flags > 0 && ` · ${fill(t('report.flags'), { n: report.flags })}`}
      </p>

      <div className="mt-3">
        {report.mine ? (
          <p className="text-xs text-hud-dim" data-testid="report-mine">{t('report.mine')}</p>
        ) : report.my_vote ? (
          <p className="text-xs text-hud" data-testid="report-voted">{t(`report.voted.${report.my_vote}` as TranslationKey)}</p>
        ) : token ? (
          <div className="flex flex-wrap gap-2">
            <SkyButton variant="subtle" onClick={() => vote('confirm')} disabled={busy != null} data-testid="report-confirm">
              {busy === 'confirm' ? <LoaderCircle className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden /> : <Check className="h-4 w-4" aria-hidden />}
              {t('report.confirm')}
            </SkyButton>
            <SkyButton variant="ghost" onClick={() => vote('flag')} disabled={busy != null} data-testid="report-flag">
              {busy === 'flag' ? <LoaderCircle className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden /> : <Flag className="h-4 w-4" aria-hidden />}
              {t('report.flag')}
            </SkyButton>
          </div>
        ) : (
          <p className="text-xs text-hud-dim">
            <Link href="/login" className="text-accent-text underline">
              {t('report.signInToVote')}
            </Link>
          </p>
        )}
        {msg && (
          <p className="mt-2 text-xs text-sev-watch-text" role="alert" data-testid="report-vote-error">
            {msg}
          </p>
        )}
      </div>
    </section>
  )
}

export type ComposerState = null | { stage: 'pick' } | { stage: 'form'; latitude: number; longitude: number }

/** Below the map in reports mode: the count, the "Report" button and the form. */
export function ReportsPanel({
  status,
  error,
  count,
  token,
  composer,
  setComposer,
  useCentre,
  onSent,
}: {
  status: Status
  error: ReportErrorCode | null
  count: number
  token: string | null
  composer: ComposerState
  setComposer: (c: ComposerState) => void
  useCentre: () => void
  onSent: (r: Report) => void
}) {
  const { t } = useI18n()
  const { errorText } = useReportWords()
  const [sent, setSent] = useState(false)
  const line =
    status === 'too-large'
      ? t('report.zoomIn')
      : status === 'error' && error
        ? errorText(error)
        : status === 'loading'
          ? t('report.loading')
          : status === 'ready'
            ? count > 0
              ? fill(t('report.count'), { n: count })
              : t('report.none')
            : null

  return (
    <section className="sky-glass space-y-3 p-4" data-testid="reports-panel" aria-label={t('report.legendTitle')}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-hud" role="status" data-testid="reports-status">
          {line}
        </p>
        {!composer &&
          (token ? (
            <SkyButton
              variant="primary"
              onClick={() => {
                setSent(false)
                setComposer({ stage: 'pick' })
              }}
              data-testid="report-new"
            >
              <Megaphone className="h-4 w-4" aria-hidden /> {t('report.new')}
            </SkyButton>
          ) : (
            <Link href="/login" className="sky-btn sky-btn-subtle" data-testid="report-sign-in">
              {t('report.signIn')}
            </Link>
          ))}
      </div>
      {sent && !composer && (
        <p className="text-xs text-sev-none-text" role="status" data-testid="report-sent">
          {t('report.sent')}
        </p>
      )}
      {composer?.stage === 'pick' && (
        <div className="flex flex-wrap items-center gap-2" data-testid="report-picking">
          <p className="text-xs text-accent-text">{t('report.where')}</p>
          <SkyButton variant="subtle" onClick={useCentre} data-testid="report-use-centre">
            <Crosshair className="h-4 w-4" aria-hidden /> {t('report.useCentre')}
          </SkyButton>
          <SkyButton variant="ghost" onClick={() => setComposer(null)}>
            {t('report.cancel')}
          </SkyButton>
        </div>
      )}
      {composer?.stage === 'form' && token && (
        <ReportForm
          at={composer}
          token={token}
          onCancel={() => setComposer(null)}
          onSent={(r) => {
            setComposer(null)
            setSent(true)
            onSent(r)
          }}
        />
      )}
    </section>
  )
}

function ReportForm({
  at,
  token,
  onCancel,
  onSent,
}: {
  at: { latitude: number; longitude: number }
  token: string
  onCancel: () => void
  onSent: (r: Report) => void
}) {
  const { t } = useI18n()
  const { errorText } = useReportWords()
  const [kind, setKind] = useState<ReportKind | null>(null)
  const [note, setNote] = useState('')
  const [photo, setPhoto] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!kind) {
      setMsg(errorText('bad_kind'))
      return
    }
    setBusy(true)
    setMsg(null)
    try {
      let blob: Blob | null = null
      if (photo) {
        blob = await photoForUpload(photo)
        if (!blob) {
          setMsg(errorText('photo_format'))
          return
        }
      }
      onSent(await createReport({ kind, latitude: at.latitude, longitude: at.longitude, note, photo: blob }, token))
    } catch (err) {
      setMsg(errorText(err instanceof ReportError ? err : 'unavailable'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3" data-testid="report-form">
      <p className="text-xs text-hud-dim" data-testid="report-at">
        {fill(t('report.at'), { lat: at.latitude.toFixed(4), lon: at.longitude.toFixed(4) })}
      </p>
      <fieldset>
        <legend className="sky-label">{t('report.kindLabel')}</legend>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {REPORT_KINDS.map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={kind === k}
              onClick={() => setKind(k)}
              data-testid={`report-kind-${k}`}
              className={cn(
                'rounded-full border px-3 py-1.5 text-xs transition-colors',
                kind === k ? 'border-accent bg-accent/15 text-hud' : 'border-white/10 bg-white/[0.04] text-hud-dim hover:text-hud'
              )}
            >
              {t(`report.kind.${k}` as TranslationKey)}
            </button>
          ))}
        </div>
      </fieldset>
      <label className="block">
        <span className="sky-label">{t('report.note')}</span>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value.slice(0, 280))}
          maxLength={280}
          rows={2}
          className="sky-input mt-1.5 w-full resize-none"
          data-testid="report-note-input"
        />
      </label>
      <div>
        <span className="sky-label">{t('report.photo')}</span>
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <SkyButton variant="ghost" onClick={() => fileRef.current?.click()}>
            <Camera className="h-4 w-4" aria-hidden /> {t('report.photo')}
          </SkyButton>
          {photo && <span className="min-w-0 truncate text-xs text-hud" title={photo.name}>{photo.name}</span>}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            aria-label={t('report.photo')}
            onChange={(e) => setPhoto(e.target.files?.[0] ?? null)}
            data-testid="report-photo-input"
          />
        </div>
        <p className="mt-1 text-[11px] text-hud-dim">{t('report.photoNote')}</p>
      </div>
      {msg && (
        <p className="text-xs text-sev-watch-text" role="alert" data-testid="report-error">
          {msg}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <SkyButton type="submit" variant="primary" disabled={busy} data-testid="report-submit">
          {busy && <LoaderCircle className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />}
          {busy ? t('report.sending') : t('report.submit')}
        </SkyButton>
        <SkyButton variant="ghost" onClick={onCancel}>
          {t('report.cancel')}
        </SkyButton>
      </div>
    </form>
  )
}
