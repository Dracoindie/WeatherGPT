'use client'

/**
 * Air quality (India AQI, CPCB method on Open-Meteo CAMS PM data) and UV
 * index panels. Every number is from GET /api/air-quality.
 */

import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Sun, Wind } from 'lucide-react'
import { getAirQuality, type AirQualityReport, type AqiCategory, type UvCategory } from '@/lib/api/air'
import { useI18n, type Language } from '@/context/I18nContext'
import { formatValue } from './CountUp'
import { GlassPanel } from './GlassPanel'
import { panelItem } from './WeatherPanels'

// CPCB AQI band colours
const AQI_COLOR: Record<AqiCategory, string> = {
  good: '#00b050',
  satisfactory: '#92d050',
  moderate: '#ffd400',
  poor: '#ff9900',
  very_poor: '#ff3b30',
  severe: '#c00000',
}
const AQI_LABEL: Record<AqiCategory, Record<Language, string>> = {
  good: { en: 'Good', hi: 'अच्छा', hinglish: 'Good', mr: 'चांगली' },
  satisfactory: { en: 'Satisfactory', hi: 'संतोषजनक', hinglish: 'Satisfactory', mr: 'समाधानकारक' },
  moderate: { en: 'Moderately polluted', hi: 'मध्यम प्रदूषित', hinglish: 'Moderate', mr: 'मध्यम प्रदूषित' },
  poor: { en: 'Poor', hi: 'खराब', hinglish: 'Poor', mr: 'वाईट' },
  very_poor: { en: 'Very poor', hi: 'बहुत खराब', hinglish: 'Very poor', mr: 'अतिशय वाईट' },
  severe: { en: 'Severe', hi: 'गंभीर', hinglish: 'Severe', mr: 'गंभीर' },
}
// WHO UV colours
const UV_COLOR: Record<UvCategory, string> = {
  low: '#3fb950',
  moderate: '#f5d90a',
  high: '#ff9900',
  very_high: '#ff3b30',
  extreme: '#b04bd8',
}
const UV_LABEL: Record<UvCategory, Record<Language, string>> = {
  low: { en: 'Low', hi: 'कम', hinglish: 'Low', mr: 'कमी' },
  moderate: { en: 'Moderate', hi: 'मध्यम', hinglish: 'Moderate', mr: 'मध्यम' },
  high: { en: 'High', hi: 'उच्च', hinglish: 'High', mr: 'जास्त' },
  very_high: { en: 'Very high', hi: 'बहुत उच्च', hinglish: 'Very high', mr: 'खूप जास्त' },
  extreme: { en: 'Extreme', hi: 'अत्यधिक', hinglish: 'Extreme', mr: 'अतिजास्त' },
}

const fmt = (v: number | null | undefined) => (v == null ? '—' : formatValue(v))

export interface AirState {
  key: string
  data?: AirQualityReport
  error?: string
}

/** Air quality for a point (GET /api/air-quality); null while loading. */
export function useAirQuality(latitude: number | null | undefined, longitude: number | null | undefined): AirState | null {
  const key = latitude != null && longitude != null ? `${latitude.toFixed(4)},${longitude.toFixed(4)}` : null
  const [state, setState] = useState<AirState | null>(null)

  useEffect(() => {
    if (key == null || latitude == null || longitude == null) return
    const ctrl = new AbortController()
    getAirQuality(latitude, longitude, ctrl.signal)
      .then((data) => setState({ key, data }))
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return
        setState({ key, error: err instanceof Error ? err.message : 'Unavailable' })
      })
    return () => ctrl.abort()
    // latitude/longitude are identified by key
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return state?.key === key ? state : null
}

export function AirErrorPanel({ error }: { error: string }) {
  const { t } = useI18n()
  return (
    <motion.div variants={panelItem} className="h-full">
    <GlassPanel label={t('panel.air')} className="h-full">
      <p className="text-sm text-sev-watch">{error}</p>
    </GlassPanel>
    </motion.div>
  )
}

export function AqiPanel({ report: r }: { report: AirQualityReport }) {
  const { t, language } = useI18n()
  const aq = r.last_24h
  const cat = aq?.aqi_category ?? null
  return (
    <motion.div variants={panelItem} className="h-full">
        <GlassPanel label={t('panel.air')} className="h-full" aside={<Wind className="size-4 text-accent" />}>
          {aq?.aqi == null || !cat ? (
            <p className="text-sm text-hud-dim">—</p>
          ) : (
            <>
              <div className="flex items-center gap-4">
                <div
                  className="grid size-24 shrink-0 place-items-center rounded-full border-4 bg-black/30"
                  style={{ borderColor: AQI_COLOR[cat], boxShadow: `0 0 24px -6px ${AQI_COLOR[cat]}` }}
                >
                  <span className="font-hud text-3xl font-bold">{aq.aqi}</span>
                </div>
                <div className="min-w-0">
                  <p className="font-hud text-lg font-semibold" style={{ color: AQI_COLOR[cat] }}>
                    {AQI_LABEL[cat][language]}
                  </p>
                  <p className="mt-1 font-readout text-xs text-hud-dim">
                    PM2.5 {fmt(aq.pm2_5)} · PM10 {fmt(aq.pm10)} µg/m³
                  </p>
                  {r.next_24h?.aqi != null && r.next_24h.aqi_category && (
                    <p className="mt-1 font-readout text-xs text-hud-dim">
                      Next 24 h: AQI {r.next_24h.aqi} · {AQI_LABEL[r.next_24h.aqi_category][language]}
                    </p>
                  )}
                </div>
              </div>
              <p className="mt-3 text-[10px] leading-snug text-hud-dim">{aq.note}</p>
            </>
          )}
        </GlassPanel>
    </motion.div>
  )
}

export function UvPanel({ report: r }: { report: AirQualityReport }) {
  const { t, language } = useI18n()
  const uvCat = r.uv_category
  return (
    <motion.div variants={panelItem} className="h-full">
        <GlassPanel label={t('panel.uv')} className="h-full" aside={<Sun className="size-4 text-accent" />}>
          {r.uv_index == null || !uvCat ? (
            <p className="text-sm text-hud-dim">—</p>
          ) : (
            <div className="flex items-center gap-4">
              <div
                className="grid size-24 shrink-0 place-items-center rounded-full border-4 bg-black/30"
                style={{ borderColor: UV_COLOR[uvCat] }}
              >
                <span className="font-hud text-3xl font-bold">{fmt(r.uv_index)}</span>
              </div>
              <div>
                <p className="font-hud text-lg font-semibold" style={{ color: UV_COLOR[uvCat] }}>
                  {UV_LABEL[uvCat][language]}
                </p>
                {r.uv_max_today != null && r.uv_max_category && (
                  <p className="mt-1 font-readout text-xs text-hud-dim">
                    Max today {fmt(r.uv_max_today)} · {UV_LABEL[r.uv_max_category][language]}
                  </p>
                )}
                <p className="mt-1 text-[10px] text-hud-dim">Open-Meteo</p>
              </div>
            </div>
          )}
        </GlassPanel>
    </motion.div>
  )
}
