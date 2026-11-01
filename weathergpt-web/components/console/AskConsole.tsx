'use client'

/**
 * "Ask the Sky" command console — terminal-style input with a glowing
 * animated border, cycling multilingual placeholder and quick chips.
 */

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ArrowUpRight, Crosshair, LoaderCircle } from 'lucide-react'
import { useReducedMotion } from 'framer-motion'
import { useI18n } from '@/context/I18nContext'
import { cn } from '@/lib/utils'

const EXAMPLES = [
  'Pune mein kal baarish hogi kya?',
  'What is the temperature in Delhi right now?',
  'मुंबई में आज बारिश होगी क्या?',
  'Will it be windy in Chennai tonight?',
  'Jaipur mein aaj garmi kitni hai?',
  'बेंगलुरु में अभी मौसम कैसा है?',
]

const CHIPS = [
  'Mumbai mein abhi mausam?',
  'Will it rain in Pune tomorrow?',
  'दिल्ली में आज तापमान?',
]

const DEVANAGARI = /[ऀ-ॿ]/

interface AskConsoleProps {
  busy: boolean
  locating: boolean
  onAsk: (message: string) => void
  onUseLocation: () => void
}

/** Types out each example, pauses, erases, moves to the next. */
function useCyclingPlaceholder(active: boolean): string {
  const reduced = useReducedMotion()
  const [text, setText] = useState(EXAMPLES[0])

  useEffect(() => {
    if (!active || reduced) return
    let example = 0
    let chars = 0
    let deleting = false
    let timer = 0
    const tick = () => {
      const full = Array.from(EXAMPLES[example])
      if (!deleting) {
        chars += 1
        setText(full.slice(0, chars).join(''))
        if (chars >= full.length) {
          deleting = true
          timer = window.setTimeout(tick, 1800)
          return
        }
        timer = window.setTimeout(tick, 45)
      } else {
        chars -= 2
        setText(full.slice(0, Math.max(0, chars)).join(''))
        if (chars <= 0) {
          deleting = false
          chars = 0
          example = (example + 1) % EXAMPLES.length
          timer = window.setTimeout(tick, 350)
          return
        }
        timer = window.setTimeout(tick, 18)
      }
    }
    timer = window.setTimeout(tick, 400)
    return () => window.clearTimeout(timer)
  }, [active, reduced])

  return text
}

export function AskConsole({ busy, locating, onAsk, onUseLocation }: AskConsoleProps) {
  const { t } = useI18n()
  const [value, setValue] = useState('')
  const [focused, setFocused] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const placeholder = useCyclingPlaceholder(value === '')

  function submit(e: FormEvent) {
    e.preventDefault()
    const text = value.trim()
    if (!text || busy) return
    onAsk(text)
    setValue('')
  }

  return (
    <div className="w-full">
      <form onSubmit={submit} className="sky-console">
        <div className="flex items-center gap-3 rounded-[19px] bg-[#040811]/90 px-4 py-3 backdrop-blur-xl sm:px-5 sm:py-4">
          <span className="font-readout text-sm text-accent select-none" aria-hidden="true">
            ~/sky&nbsp;›
          </span>
          <div className="relative min-w-0 flex-1">
            <input
              ref={inputRef}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              maxLength={2000}
              aria-label={t('chat.label')}
              placeholder={EXAMPLES[0]}
              className={cn(
                'w-full bg-transparent text-base text-hud caret-[var(--sky-accent)] outline-none placeholder:text-transparent sm:text-lg',
                DEVANAGARI.test(value) && 'deva'
              )}
              autoComplete="off"
              spellCheck={false}
            />
            {value === '' && (
              <span
                aria-hidden="true"
                className={cn(
                  'pointer-events-none absolute inset-0 flex items-center overflow-hidden whitespace-nowrap text-base text-hud-dim sm:text-lg',
                  DEVANAGARI.test(placeholder) && 'deva'
                )}
              >
                {placeholder}
                {!focused && <span className="sky-caret" />}
              </span>
            )}
          </div>
          <button
            type="submit"
            disabled={busy || value.trim() === ''}
            className="flex shrink-0 items-center gap-1.5 rounded-xl bg-accent px-3 py-2 font-hud text-xs font-bold uppercase tracking-[0.18em] text-black shadow-[0_0_24px_-4px_var(--sky-accent)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40 sm:px-4"
          >
            {busy ? <LoaderCircle className="size-4 animate-spin" /> : <ArrowUpRight className="size-4" />}
            <span className="hidden sm:inline">{t('sky.send')}</span>
          </button>
        </div>
      </form>

      <div className="mt-4 flex flex-wrap justify-center gap-2">
        {CHIPS.map((chip) => (
          <button
            key={chip}
            type="button"
            disabled={busy}
            onClick={() => onAsk(chip)}
            className={cn(
              'rounded-full border border-white/10 bg-black/35 px-3.5 py-1.5 text-[13px] text-hud-dim backdrop-blur-md transition hover:border-accent/50 hover:text-hud disabled:opacity-40',
              DEVANAGARI.test(chip) && 'deva'
            )}
          >
            {chip}
          </button>
        ))}
        <button
          type="button"
          disabled={busy || locating}
          onClick={onUseLocation}
          className="flex items-center gap-1.5 rounded-full border border-accent/50 bg-black/45 px-3.5 py-1.5 text-[13px] text-accent backdrop-blur-md transition hover:bg-black/60 disabled:opacity-40"
        >
          {locating ? <LoaderCircle className="size-3.5 animate-spin" /> : <Crosshair className="size-3.5" />}
          {locating ? t('sky.locating') : t('sky.useLocation')}
        </button>
      </div>
    </div>
  )
}
