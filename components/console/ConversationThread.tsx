'use client'

import { AnimatePresence, motion } from 'framer-motion'
import { AlertTriangle, Crosshair, LoaderCircle, MapPin } from 'lucide-react'
import { useI18n } from '@/context/I18nContext'
import { cn } from '@/lib/utils'
import type { ThreadEntry } from './types'

interface ConversationThreadProps {
  entries: ThreadEntry[]
  activeId: number | null
  onSelect: (id: number) => void
}

const DEVANAGARI = /[ऀ-ॿ]/

function time(d: Date) {
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
}

/** In-memory transmission log (lost on reload by design). */
export function ConversationThread({ entries, activeId, onSelect }: ConversationThreadProps) {
  const { t } = useI18n()

  return (
    <div className="sky-glass flex max-h-[70vh] flex-col p-4 lg:max-h-[calc(100dvh-7rem)]">
      <header className="mb-3 flex items-center justify-between">
        <h2 className="sky-label">{t('sky.thread')}</h2>
        <span className="font-readout text-[10px] text-hud-dim">{entries.length.toString().padStart(2, '0')}</span>
      </header>
      {entries.length === 0 ? (
        <p className="text-sm text-hud-dim">{t('sky.threadEmpty')}</p>
      ) : (
        <ol className="sky-scroll -mr-2 flex-1 space-y-2 overflow-y-auto pr-2">
          <AnimatePresence initial={false}>
            {[...entries].reverse().map((e) => {
              const reply = e.response?.message ?? e.error ?? ''
              const loc = e.response?.location
              return (
                <motion.li
                  key={e.id}
                  layout
                  initial={{ opacity: 0, x: 24 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0 }}
                >
                  <button
                    type="button"
                    onClick={() => e.status === 'done' && onSelect(e.id)}
                    aria-current={activeId === e.id}
                    className={cn(
                      'w-full rounded-xl border px-3 py-2.5 text-left transition',
                      activeId === e.id
                        ? 'border-accent/50 bg-accent/10'
                        : 'border-white/5 bg-white/[0.02] hover:border-white/15'
                    )}
                  >
                    <div className="flex items-center justify-between gap-2 font-readout text-[10px] text-hud-dim">
                      <span className="flex items-center gap-1">
                        {e.usedGps && <Crosshair className="size-3" />}
                        {time(e.askedAt)}
                      </span>
                      {e.status === 'pending' && <LoaderCircle className="size-3 animate-spin text-accent" />}
                      {e.status === 'error' && <AlertTriangle className="size-3 text-rose-400" />}
                      {loc && (
                        <span className="flex min-w-0 items-center gap-1 truncate text-accent/90">
                          <MapPin className="size-3 shrink-0" />
                          <span className="truncate">{loc.name.split(',')[0]}</span>
                        </span>
                      )}
                    </div>
                    <p className={cn('mt-1 text-sm font-medium text-hud', DEVANAGARI.test(e.query) && 'deva')}>
                      {e.query}
                    </p>
                    {reply && (
                      <p
                        className={cn(
                          'mt-1 line-clamp-2 text-xs',
                          e.status === 'error' ? 'text-rose-300' : 'text-hud-dim',
                          DEVANAGARI.test(reply) && 'deva'
                        )}
                      >
                        {reply}
                      </p>
                    )}
                  </button>
                </motion.li>
              )
            })}
          </AnimatePresence>
        </ol>
      )}
    </div>
  )
}
