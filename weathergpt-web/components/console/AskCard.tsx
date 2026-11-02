'use client'

/**
 * Entry point to the ONE chat: the Living Sky console on "/". Inner pages do
 * not embed a second chat box; they link here with the question and the
 * picked coordinates (/?q=…&lat=…&lon=…), and the console asks it.
 */

import Link from 'next/link'
import { ArrowUpRight, MessageSquareText } from 'lucide-react'
import { GlassPanel } from '@/components/panels/GlassPanel'
import { fill, useI18n, type TranslationKey } from '@/context/I18nContext'

const QUESTIONS: TranslationKey[] = ['ask.q.now', 'ask.q.rain', 'ask.q.heat', 'ask.q.wind']

export function askHref(question: string, coords?: { latitude: number; longitude: number } | null): string {
  const p = new URLSearchParams({ q: question })
  if (coords) {
    p.set('lat', coords.latitude.toFixed(4))
    p.set('lon', coords.longitude.toFixed(4))
  }
  return `/?${p.toString()}`
}

export function AskCard({ place, coords }: { place?: string | null; coords?: { latitude: number; longitude: number } | null }) {
  const { t } = useI18n()
  const short = place ? place.split(',')[0] : null
  return (
    <GlassPanel wet={false} className="h-full" label={short ? fill(t('ask.title'), { place: short }) : t('ask.titleAny')} aside={<MessageSquareText className="size-4 text-accent-text" />}>
      <p className="text-sm text-hud-dim">{t('ask.intro')}</p>
      <ul className="mt-4 flex flex-wrap gap-2">
        {QUESTIONS.map((key) => (
          <li key={key}>
            <Link
              href={askHref(t(key), coords)}
              className="inline-flex min-h-9 items-center rounded-full border border-white/10 bg-black/30 px-3 text-sm text-hud transition-colors hover:border-accent/50 hover:text-accent-text"
            >
              {t(key)}
            </Link>
          </li>
        ))}
      </ul>
      <Link href={coords ? askHref(t('ask.q.now'), coords) : '/'} className="sky-btn sky-btn-ghost mt-5">
        {t('ask.open')} <ArrowUpRight className="size-3.5" />
      </Link>
    </GlassPanel>
  )
}
