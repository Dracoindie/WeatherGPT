'use client'

/**
 * Living Sky home — orchestrates chat, sky scene, panels and timeline.
 *
 * Every weather number on screen comes from POST /api/chat or
 * GET /api/weather. The scene store only receives derived visual params.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { AnimatePresence, MotionConfig, motion } from 'framer-motion'
import { ShieldCheck } from 'lucide-react'
import { contextFrom, postChat, ChatApiError } from '@/lib/api/chat'
import { getWeather, type WeatherResponse } from '@/lib/api/weather'
import { useAuthContext } from '@/context/AuthContext'
import { useDemoContext } from '@/context/DemoContext'
import { useI18n, type Language } from '@/context/I18nContext'
import { useGeolocation } from '@/lib/location/useGeolocation'
import { sky } from '@/lib/skyStore'
import { sceneFromFacts } from '@/lib/weatherScene'
import { cn } from '@/lib/utils'
import { useRole } from '@/lib/role'
import { useVoice } from '@/lib/voice/useVoice'
import type { VoiceLanguage } from '@/lib/voice/voiceService'
import { RolePanel } from '@/components/panels/RolePanels'
import { SkyEngine } from '@/components/sky/SkyEngine'
import { DemoPanel } from '@/components/sky/DemoPanel'
import { AskConsole } from './AskConsole'
import { ConversationThread } from './ConversationThread'
import { ReplyCard } from './ReplyCard'
import { ScanningLoader } from './ScanningLoader'
import { AppShell } from '@/components/ui/AppShell'
import { AdvisoryPanel, HighSeverityHud } from '@/components/panels/Advisory'
import {
  HumidityPanel,
  LocationPanel,
  RainPanel,
  TemperaturePanel,
  WindPanel,
} from '@/components/panels/WeatherPanels'
import { RainGlass } from '@/components/panels/RainGlass'
import { ClimateComparePanel, GfsPanel } from '@/components/panels/SourcePanels'
import { AirErrorPanel, AqiPanel, UvPanel, useAirQuality } from '@/components/panels/AirPanels'
import { PANEL_GRID, panelSpanClasses, type Slot } from '@/lib/gridFill'
import { GlassPanel } from '@/components/panels/GlassPanel'
import { ForecastTimeline } from '@/components/panels/ForecastTimeline'
import type { ThreadEntry } from './types'
import type { ChatResponse } from '@/lib/api/chat'

const SkyMap = dynamic(() => import('@/components/panels/SkyMap'), {
  ssr: false,
  loading: () => <div className="h-full min-h-[280px] animate-pulse rounded-xl bg-white/[0.03]" />,
})

interface ForecastState {
  key: string
  data?: WeatherResponse
  error?: string
}

/** Last grounded answer on this device, shown again when offline. */
const SAVED_KEY = 'wgpt:last-answer'

interface SavedAnswer {
  query: string
  askedAt: string
  response: ChatResponse
}

function readSaved(): SavedAnswer | null {
  try {
    const raw = localStorage.getItem(SAVED_KEY)
    const saved = raw ? (JSON.parse(raw) as SavedAnswer) : null
    return saved?.response?.weather ? saved : null
  } catch {
    return null
  }
}

const HERE_QUERY: Record<Language, string> = {
  en: "What's the weather here right now?",
  hi: 'अभी यहाँ मौसम कैसा है?',
  hinglish: 'Yahan abhi mausam kaisa hai?',
  mr: 'इथे आत्ता हवामान कसे आहे?',
}

export default function LivingSky() {
  const { t, language } = useI18n()
  const { session, user } = useAuthContext()
  const { isDemo } = useDemoContext()
  const geo = useGeolocation()
  const { role } = useRole()

  const [entries, setEntries] = useState<ThreadEntry[]>([])
  const [activeId, setActiveId] = useState<number | null>(null)
  const [typedId, setTypedId] = useState<number | null>(null)
  const nextId = useRef(1)
  const geoPending = useRef(false)

  const busy = entries.some((e) => e.status === 'pending')
  const docked = entries.length > 0
  const active = entries.find((e) => e.id === activeId) ?? null
  const res = active?.status === 'done' ? active.response ?? null : null
  const severity = res?.advisory?.severity ?? 'low'

  // Same rule as the dashboard: no token while in (auth) demo mode.
  const accessToken = isDemo ? undefined : session?.access_token

  // Follow-up context: the latest answer that resolved a location.
  const lastAnswered = [...entries].reverse().find((e) => e.status === 'done' && e.response?.location)
  const context = contextFrom(lastAnswered?.response)

  const ask = useCallback(
    async (message: string, coords?: { latitude: number; longitude: number }, viaVoice = false) => {
      const id = nextId.current++
      setEntries((prev) => [
        ...prev,
        { id, query: message, usedGps: !!coords, askedAt: new Date(), status: 'pending', viaVoice },
      ])
      setActiveId(id)
      try {
        const response = await postChat({ message, ...coords, context, role }, accessToken)
        setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, status: 'done', response } : e)))
      } catch (err: unknown) {
        const error =
          err instanceof ChatApiError ? err.message : 'Could not reach the chat API. Is the backend running?'
        setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, status: 'error', error } : e)))
      }
    },
    [accessToken, context, role]
  )

  // Questions handed over from other pages: /?q=…&lat=…&lon=… (see AskCard).
  const urlAsked = useRef(false)
  useEffect(() => {
    if (urlAsked.current) return
    urlAsked.current = true
    const p = new URLSearchParams(window.location.search)
    const q = p.get('q')?.trim()
    if (!q) return
    const lat = Number(p.get('lat'))
    const lon = Number(p.get('lon'))
    const coords =
      p.has('lat') && p.has('lon') && Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180
        ? { latitude: lat, longitude: lon }
        : undefined
    window.history.replaceState(null, '', '/')
    // Not cleared on re-run: urlAsked guarantees it is scheduled exactly once.
    window.setTimeout(() => void ask(q.slice(0, 500), coords), 0)
  }, [ask])

  // Voice: mic questions go straight to ask(); their answers are spoken unless muted.
  const voice = useVoice((text) => void ask(text, undefined, true))
  const [voiceLangChoice, setVoiceLang] = useState<VoiceLanguage | null>(null)
  const voiceLang: VoiceLanguage = voiceLangChoice ?? (language === 'hi' || language === 'mr' ? language : 'en')
  const spoken = useRef(new Set<number>())
  const { muted, speak } = voice
  useEffect(() => {
    for (const e of entries) {
      if (e.viaVoice && e.status === 'done' && e.response && !spoken.current.has(e.id)) {
        spoken.current.add(e.id)
        if (!muted) speak(e.response.message, e.response.intent.language)
      }
    }
  }, [entries, muted, speak])

  // Remember the latest grounded answer for offline viewing.
  useEffect(() => {
    const last = [...entries].reverse().find((e) => e.status === 'done' && !e.saved && e.response?.weather)
    if (!last?.response) return
    try {
      const saved: SavedAnswer = { query: last.query, askedAt: last.askedAt.toISOString(), response: last.response }
      localStorage.setItem(SAVED_KEY, JSON.stringify(saved))
    } catch {
      // storage full or blocked: nothing to restore later
    }
  }, [entries])

  // Offline with nothing asked yet: show the saved answer (labelled as saved).
  useEffect(() => {
    const restore = () => {
      const saved = readSaved()
      if (!saved) return
      setEntries((prev) => {
        if (prev.length) return prev
        const id = nextId.current++
        setActiveId(id)
        return [
          { id, query: saved.query, usedGps: false, askedAt: new Date(saved.askedAt), status: 'done', response: saved.response, saved: true },
        ]
      })
    }
    const initial = navigator.onLine ? 0 : window.setTimeout(restore, 0)
    window.addEventListener('offline', restore)
    return () => {
      window.clearTimeout(initial)
      window.removeEventListener('offline', restore)
    }
  }, [])

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

  // Panels for the active answer, in reading order. Widths are balanced per
  // breakpoint by lib/gridFill so rows never end with a hole.
  const air = useAirQuality(res?.location?.latitude, res?.location?.longitude)
  const panels: (Slot & { node: React.ReactNode })[] = []
  if (res?.location) {
    const w = res.weather
    panels.push({ key: 'loc', span: 1, node: <LocationPanel location={res.location} facts={w} /> })
    if (w?.period_available) {
      panels.push({ key: 'temp', span: 1, node: <TemperaturePanel facts={w} /> })
      panels.push({ key: 'rain', span: 1, node: <RainPanel facts={w} /> })
      panels.push({ key: 'wind', span: 1, node: <WindPanel facts={w} /> })
      panels.push({ key: 'hum', span: 1, node: <HumidityPanel facts={w} /> })
    }
    if (res.climate) panels.push({ key: 'climate', span: 2, node: <ClimateComparePanel facts={res.climate} /> })
    if (res.nwp) panels.push({ key: 'gfs', span: 2, node: <GfsPanel facts={res.nwp} /> })
    if (air?.error) panels.push({ key: 'air', span: 1, node: <AirErrorPanel error={air.error} /> })
    else if (air?.data) {
      panels.push({ key: 'aqi', span: 1, node: <AqiPanel report={air.data} /> })
      panels.push({ key: 'uv', span: 1, node: <UvPanel report={air.data} /> })
    }
    // last: a sentence reads well across a wide row
    if (res.advisory) panels.push({ key: 'adv', span: 2, node: <AdvisoryPanel advisory={res.advisory} window={w?.requested_time} /> })
  }
  const panelSpans = panelSpanClasses(panels)

  return (
    <MotionConfig reducedMotion="user">
    <AppShell
      severity={severity}
      background={<SkyEngine />}
      overlay={
        <>
          <DemoPanel />
          <HighSeverityHud advisory={res?.advisory ?? null} />
        </>
      }
      mainClassName={cn(
        'grid max-w-[1500px] gap-6 pt-0 lg:pt-0 lg:grid-cols-[minmax(0,1fr)_340px]',
        // clear the docked console on phones
        docked && 'max-sm:pb-[calc(10rem+env(safe-area-inset-bottom))]'
      )}
    >
        <div className="min-w-0">
          <section className="mx-auto max-w-3xl pt-6 text-center sm:pt-12">
            <p className="sky-label">{t('sky.subtitle')}</p>
            <h1 className="mt-3 font-hud text-4xl font-bold tracking-tight sm:text-6xl">
              <span className="bg-gradient-to-b from-white to-white/55 bg-clip-text text-transparent">
                {t('sky.title')}
              </span>
            </h1>
            {/* On phones the console docks above the bottom nav once a question was asked. */}
            <div
              className={cn(
                'mt-8',
                docked &&
                  'max-sm:fixed max-sm:inset-x-0 max-sm:bottom-[calc(4rem+env(safe-area-inset-bottom))] max-sm:z-40 max-sm:mt-0 max-sm:bg-gradient-to-t max-sm:from-[#02040a] max-sm:via-[#02040a]/90 max-sm:to-transparent max-sm:px-3 max-sm:pb-2 max-sm:pt-6'
              )}
            >
              <AskConsole
                busy={busy}
                docked={docked}
                voice={voice}
                voiceLang={voiceLang}
                onVoiceLang={setVoiceLang}
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
                  onListen={
                    voice.supported.tts && active.response
                      ? () => voice.speak(active.response!.message, active.response!.intent.language)
                      : undefined
                  }
                />
              )}
            </AnimatePresence>
          </section>

        </div>

        <aside className="max-lg:order-last lg:sticky lg:top-4 lg:self-start lg:pt-6">
          <ConversationThread entries={entries} activeId={activeId} onSelect={setActiveId} />
        </aside>

        {/* Answer panels span the full width under the console and the log: no empty column. */}
        <div className="min-w-0 lg:col-span-2">
          <AnimatePresence>
            {res?.location && typedId === active?.id && (
              <motion.section
                key={active.id}
                initial="hidden"
                animate="show"
                exit={{ opacity: 0 }}
                variants={{ show: { transition: { staggerChildren: 0.09 } } }}
                className={cn('mt-2', PANEL_GRID)}
              >
                {panels.map((p, i) => (
                  <div key={p.key} className={cn('min-w-0', panelSpans[i])}>
                    {p.node}
                  </div>
                ))}
              </motion.section>
            )}
          </AnimatePresence>

          {loc && typedId === active?.id && (
            <RolePanel role={role} latitude={loc.latitude} longitude={loc.longitude} />
          )}

          {loc && typedId === active?.id && (
            <section className="mt-4 grid gap-4 xl:grid-cols-5">
              <div className="min-w-0 xl:col-span-3">
                {forecastForLoc?.data ? (
                  <ForecastTimeline key={`${activeId}-${locKey}`} weather={forecastForLoc.data} />
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
    </AppShell>
    </MotionConfig>
  )
}
