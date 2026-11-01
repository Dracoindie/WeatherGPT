'use client'

import { motion } from 'framer-motion'
import { AlertTriangle, Crosshair, MapPinOff, RadioTower } from 'lucide-react'
import { useI18n } from '@/context/I18nContext'
import { cn } from '@/lib/utils'
import { RainGlass } from '@/components/panels/RainGlass'
import { Typewriter } from './Typewriter'
import { ShareWhatsApp } from '@/components/common/ShareWhatsApp'
import type { ThreadEntry } from './types'

const DEVANAGARI = /[ऀ-ॿ]/

interface ReplyCardProps {
  entry: ThreadEntry
  onTyped: () => void
  onUseLocation: () => void
}

/** The grounded reply (typewriter) or a graceful error / need-location state. */
export function ReplyCard({ entry, onTyped, onUseLocation }: ReplyCardProps) {
  const { t } = useI18n()

  if (entry.status === 'error') {
    return (
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="sky-glass flex items-start gap-3 border-rose-500/30 p-4"
        role="alert"
      >
        <AlertTriangle className="mt-0.5 size-5 shrink-0 text-rose-400" />
        <div>
          <p className="sky-label !text-rose-300">{t('sky.error')}</p>
          <p className="mt-1 text-sm text-hud">{entry.error}</p>
        </div>
      </motion.div>
    )
  }

  const res = entry.response
  if (!res) return null
  const needsLocation = res.location === null

  return (
    <motion.div
      key={entry.id}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn('sky-glass p-4 sm:p-5', needsLocation && 'border-amber-400/30')}
    >
      <RainGlass />
      <div className="mb-2 flex items-center gap-2">
        {needsLocation ? (
          <MapPinOff className="size-4 text-amber-300" />
        ) : (
          <RadioTower className="size-4 text-accent" />
        )}
        <span className={cn('sky-label', needsLocation && '!text-amber-200')}>
          {needsLocation
            ? t('sky.needLocation')
            : entry.saved
              ? `Saved forecast · ${entry.askedAt.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}`
              : `WeatherGPT · ${res.intent.language}`}
        </span>
      </div>
      <Typewriter
        text={res.message}
        onDone={onTyped}
        className={cn(
          'text-[17px] leading-relaxed text-hud sm:text-lg',
          DEVANAGARI.test(res.message) && 'deva'
        )}
      />
      {!needsLocation && (
        <div className="mt-3 flex justify-end">
          <ShareWhatsApp tone="sky" text={`${entry.query}\n${res.message}`} />
        </div>
      )}
      {needsLocation && (
        <button
          type="button"
          onClick={onUseLocation}
          className="mt-3 flex items-center gap-1.5 rounded-full border border-amber-300/40 bg-amber-300/10 px-3 py-1.5 text-[13px] text-amber-200 hover:bg-amber-300/20"
        >
          <Crosshair className="size-3.5" />
          {t('sky.useLocation')}
        </button>
      )}
    </motion.div>
  )
}
