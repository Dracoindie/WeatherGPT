'use client'

/**
 * Living Sky home — orchestrates chat, sky scene, panels and timeline.
 *
 * Every weather number on screen comes from POST /api/chat or
 * GET /api/weather. The scene store only receives derived visual params.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ShieldCheck } from 'lucide-react'
import { postChat, ChatApiError } from '@/lib/api/chat'
import { useAuthContext } from '@/context/AuthContext'
import { useDemoContext } from '@/context/DemoContext'
import { useI18n } from '@/context/I18nContext'
import { useGeolocation } from '@/lib/location/useGeolocation'
import { sky } from '@/lib/skyStore'
import { sceneFromFacts } from '@/lib/weatherScene'
import { StaticSky } from '@/components/sky/StaticSky'
import { AskConsole } from './AskConsole'
import { ConversationThread } from './ConversationThread'
import { ReplyCard } from './ReplyCard'
import { ScanningLoader } from './ScanningLoader'
import { SkyNav } from './SkyNav'
import type { ThreadEntry } from './types'

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
      <StaticSky />
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

          {res && typedId === active?.id && res.weather && (
            <pre className="mx-auto mt-6 max-w-3xl overflow-x-auto font-readout text-xs text-hud-dim">
              {JSON.stringify(res.weather, null, 2)}
            </pre>
          )}
        </div>

        <aside className="lg:sticky lg:top-4 lg:self-start lg:pt-6">
          <ConversationThread entries={entries} activeId={activeId} onSelect={setActiveId} />
        </aside>
      </main>
    </div>
  )
}
