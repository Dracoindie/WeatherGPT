'use client'

/**
 * Living Sky home — orchestrates chat, sky scene, panels and timeline.
 *
 * Every weather number on screen comes from POST /api/chat or
 * GET /api/weather. The scene store only receives derived visual params.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { AnimatePresence, motion } from 'framer-motion'
import { ShieldCheck } from 'lucide-react'
import { postChat, ChatApiError } from '@/lib/api/chat'
import { getWeather, type WeatherResponse } from '@/lib/api/weather'
import { useAuthContext } from '@/context/AuthContext'
import { useDemoContext } from '@/context/DemoContext'
import { useI18n } from '@/context/I18nContext'
import { useGeolocation } from '@/lib/location/useGeolocation'
import { sky } from '@/lib/skyStore'
import { sceneFromFacts } from '@/lib/weatherScene'
import { SkyEngine } from '@/components/sky/SkyEngine'
import { DemoPanel } from '@/components/sky/DemoPanel'
import { AskConsole } from './AskConsole'
import { ConversationThread } from './ConversationThread'
import { ReplyCard } from './ReplyCard'
import { ScanningLoader } from './ScanningLoader'
import { SkyNav } from './SkyNav'
import { AdvisoryPanel, HighSeverityHud } from '@/components/panels/Advisory'
import {
  HumidityPanel,
  LocationPanel,
  RainPanel,
  TemperaturePanel,
  WindPanel,
} from '@/components/panels/WeatherPanels'
import { RainGlass } from '@/components/panels/RainGlass'
import { GlassPanel } from '@/components/panels/GlassPanel'
import { ForecastTimeline } from '@/components/panels/ForecastTimeline'
import type { ThreadEntry } from './types'

const SkyMap = dynamic(() => import('@/components/panels/SkyMap'), {
  ssr: false,
  loading: () => <div className="h-full min-h-[280px] animate-pulse rounded-xl bg-white/[0.03]" />,
})

interface ForecastState {
  key: string
  data?: WeatherResponse
  error?: string
}

const HERE_QUERY = { en: "What's the weather here right now?", hi: 'अभी यहाँ मौसम कैसा है?' } as const

export default function LivingSky() {
  const { t, language } = useI18n()
  const { session, user } = useAuthContext()
  const { isDemo } = useDemoContext()
  const geo = useGeolocation()

  const [entries, setEntries] = useState<ThreadEntry[]>([])
  const [activeId, setActiveId] = useState<number | null>(null)
  const [typedId, setTypedId] = useState<number | null>(null)
  const nextId = useRef(1)
  const geoPending = useRef(false)

  const busy = entries.some((e) => e.status === 'pending')
  const active = entries.find((e) => e.id === activeId) ?? null
  const res = active?.status === 'done' ? active.response ?? null : null
  const severity = res?.advisory?.severity ?? 'low'

  // Same rule as the dashboard: no token while in (auth) demo mode.
  const accessToken = isDemo ? undefined : session?.access_token

  const ask = useCallback(
    async (message: string, coords?: { latitude: number; longitude: number }) => {
      const id = nextId.current++
      setEntries((prev) => [
        ...prev,
        { id, query: message, usedGps: !!coords, askedAt: new Date(), status: 'pending' },
      ])
      setActiveId(id)
      try {
        const response = await postChat({ message, ...coords }, accessToken)
        setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, status: 'done', response } : e)))
      } catch (err: unknown) {
        const error =
          err instanceof ChatApiError ? err.message : 'Could not reach the chat API. Is the backend running?'
        setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, status: 'error', error } : e)))
      }
    },
    [accessToken]
  )

  // Drive the sky from the active response's verified facts.
  useEffect(() => {
    if (res?.weather && res.weather.period_available) {
      sky.setData(sceneFromFacts(res.weather, res.intent.date_reference))
      sky.setPreview(null)
    }
  }, [res])

  // Hourly forecast for the timeline whenever the answered location changes.
  const loc = res?.location ?? null
  const locKey = loc ? `${loc.latitude.toFixed(4)},${loc.longitude.toFixed(4)}` : null
  const [forecast, setForecast] = useState<ForecastState | null>(null)
  useEffect(() => {
    if (!loc || !locKey) return
    const ctrl = new AbortController()
    getWeather(loc.latitude, loc.longitude, ctrl.signal)
      .then((data) => setForecast({ key: locKey, data }))
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return
        setForecast({ key: locKey, error: err instanceof Error ? err.message : 'Forecast unavailable' })
      })
    return () => ctrl.abort()
    // loc is identified by locKey
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locKey])
  const forecastForLoc = forecast && forecast.key === locKey ? forecast : null

  // "Use my location": ask once the browser resolves coordinates.
  const { coords, status: geoStatus, requestLocation } = geo
  useEffect(() => {
    if (!geoPending.current) return
    if (geoStatus === 'granted' && coords) {
      geoPending.current = false
      void ask(HERE_QUERY[language], { latitude: coords.latitude, longitude: coords.longitude })
    } else if (geoStatus !== 'requesting' && geoStatus !== 'idle') {
      geoPending.current = false
    }
  }, [coords, geoStatus, ask, language])

  const useLocation = useCallback(() => {
    geoPending.current = true
    requestLocation()
  }, [requestLocation])

  return (
    <div className="sky-root" data-severity={severity}>
      <SkyEngine />
      <DemoPanel />
      <HighSeverityHud advisory={res?.advisory ?? null} />
      <SkyNav />

      <main className="relative z-10 mx-auto grid max-w-[1500px] gap-6 px-4 pb-16 sm:px-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0">
          <section className="mx-auto max-w-3xl pt-6 text-center sm:pt-12">
            <p className="sky-label">{t('sky.subtitle')}</p>
            <h1 className="mt-3 font-hud text-4xl font-bold tracking-tight sm:text-6xl">
              <span className="bg-gradient-to-b from-white to-white/55 bg-clip-text text-transparent">
                {t('sky.title')}
              </span>
            </h1>
            <div className="mt-8">
              <AskConsole
                busy={busy}
                locating={geoStatus === 'requesting'}
                onAsk={(m) => void ask(m)}
                onUseLocation={useLocation}
              />
            </div>
            {geo.error && <p className="mt-3 text-xs text-amber-200">{geo.error}</p>}
            {user && !isDemo && (
              <p className="mt-3 flex items-center justify-center gap-1.5 font-readout text-[10px] uppercase tracking-[0.2em] text-hud-dim">
                <ShieldCheck className="size-3 text-accent" /> {t('sky.signedIn')}
              </p>
            )}
          </section>

          <section className="mx-auto mt-8 max-w-3xl">
            <AnimatePresence mode="wait">
              {active?.status === 'pending' && (
                <motion.div
                  key="scan"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="sky-glass p-5"
                >
                  <RainGlass />
                  <ScanningLoader />
                </motion.div>
              )}
              {active && active.status !== 'pending' && (
                <ReplyCard
                  key={active.id}
                  entry={active}
                  onTyped={() => setTypedId(active.id)}
                  onUseLocation={useLocation}
                />
              )}
            </AnimatePresence>
          </section>

          <AnimatePresence>
            {res?.location && typedId === active?.id && (
              <motion.section
                key={active.id}
                initial="hidden"
                animate="show"
                exit={{ opacity: 0 }}
                variants={{ show: { transition: { staggerChildren: 0.09 } } }}
                className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3"
              >
                <LocationPanel location={res.location} facts={res.weather} />
                {res.weather?.period_available && (
                  <>
                    <TemperaturePanel facts={res.weather} />
                    <RainPanel facts={res.weather} />
                    <WindPanel facts={res.weather} />
                    <HumidityPanel facts={res.weather} />
                  </>
                )}
                {res.advisory && <AdvisoryPanel advisory={res.advisory} />}
              </motion.section>
            )}
          </AnimatePresence>

          {loc && typedId === active?.id && (
            <section className="mt-4 grid gap-4 xl:grid-cols-5">
              <div className="min-w-0 xl:col-span-3">
                {forecastForLoc?.data ? (
                  <ForecastTimeline weather={forecastForLoc.data} resetKey={activeId} />
                ) : (
                  <GlassPanel label={t('panel.timeline')} className="h-full">
                    {forecastForLoc?.error ? (
                      <p className="text-sm text-rose-300">{forecastForLoc.error}</p>
                    ) : (
                      <div className="h-[230px] animate-pulse rounded-xl bg-white/[0.03]" />
                    )}
                  </GlassPanel>
                )}
              </div>
              <GlassPanel label={t('panel.map')} wet={false} className="flex min-h-[340px] flex-col xl:col-span-2">
                <div className="min-h-0 flex-1">
                  <SkyMap latitude={loc.latitude} longitude={loc.longitude} label={loc.name} />
                </div>
              </GlassPanel>
            </section>
          )}
        </div>

        <aside className="lg:sticky lg:top-4 lg:self-start lg:pt-6">
          <ConversationThread entries={entries} activeId={activeId} onSelect={setActiveId} />
        </aside>
      </main>
    </div>
  )
}
