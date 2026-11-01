'use client'

/**
 * "Ask the Sky" command console — terminal-style input with a glowing
 * animated border, cycling multilingual placeholder and quick chips.
 */

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ArrowUpRight, Crosshair, LoaderCircle, Mic, MicOff, Volume2, VolumeX } from 'lucide-react'
import type { UseVoice } from '@/lib/voice/useVoice'
import type { VoiceLanguage } from '@/lib/voice/voiceService'
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
  'पुण्यात उद्या पाऊस पडेल का?',
  'What is the AQI in Delhi today?',
]

const CHIPS = [
  'Mumbai mein abhi mausam?',
  'Will it rain in Pune tomorrow?',
  'दिल्ली में आज तापमान?',
  'पुण्यात उद्या पाऊस पडेल का?',
]

const DEVANAGARI = /[ऀ-ॿ]/

interface AskConsoleProps {
  busy: boolean
  /** docked at the bottom on phones: hide the chips to keep it compact */
  docked?: boolean
  locating: boolean
  onAsk: (message: string) => void
  onUseLocation: () => void
  /** mic input + spoken replies; omitted = no voice controls */
  voice?: UseVoice
  voiceLang?: VoiceLanguage
  onVoiceLang?: (lang: VoiceLanguage) => void
}

const VOICE_LANGS: { value: VoiceLanguage; label: string }[] = [
  { value: 'en', label: 'EN-IN' },
  { value: 'hi', label: 'हिंदी' },
  { value: 'mr', label: 'मराठी' },
]

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

export function AskConsole({
  busy,
  docked = false,
  locating,
  onAsk,
  onUseLocation,
  voice,
  voiceLang = 'en',
  onVoiceLang,
}: AskConsoleProps) {
  const { t } = useI18n()
  const [value, setValue] = useState('')
  const [focused, setFocused] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const listening = voice?.status === 'listening'
  const placeholder = useCyclingPlaceholder(value === '' && !listening)

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
            {value === '' && listening && (
              <span aria-live="polite" className="pointer-events-none absolute inset-0 flex items-center overflow-hidden whitespace-nowrap text-base text-accent sm:text-lg">
                {voice?.interim || t('voice.listening')}
              </span>
            )}
            {value === '' && !listening && (
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
          {voice && (
            <>
              <select
                value={voiceLang}
                onChange={(e) => onVoiceLang?.(e.target.value as VoiceLanguage)}
                aria-label="Speech language"
                disabled={!voice.supported.stt}
                className="hidden shrink-0 cursor-pointer rounded-lg bg-transparent font-readout text-[11px] text-hud-dim outline-none disabled:opacity-40 sm:block [&>option]:bg-[#0b1220]"
              >
                {VOICE_LANGS.map((l) => (
                  <option key={l.value} value={l.value}>
                    {l.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => (listening ? voice.stopListening() : voice.listen(voiceLang))}
                disabled={busy || !voice.supported.stt}
                aria-pressed={listening}
                aria-label={
                  !voice.supported.stt ? 'Voice input is not supported in this browser' : listening ? t('voice.stop') : t('voice.start')
                }
                title={!voice.supported.stt ? 'Voice input is not supported in this browser. Type your question instead.' : undefined}
                className={cn(
                  'grid size-11 shrink-0 place-items-center rounded-xl border transition disabled:cursor-not-allowed disabled:opacity-40',
                  listening ? 'animate-pulse border-rose-400/70 bg-rose-500/20 text-rose-200' : 'border-white/10 bg-black/30 text-hud-dim hover:text-hud'
                )}
              >
                {voice.supported.stt ? <Mic className="size-4" /> : <MicOff className="size-4" />}
              </button>
              {voice.supported.tts && (
                <button
                  type="button"
                  onClick={() => voice.setMuted(!voice.muted)}
                  aria-pressed={voice.muted}
                  aria-label={voice.muted ? 'Unmute spoken replies' : 'Mute spoken replies'}
                  className="hidden size-11 shrink-0 place-items-center rounded-xl border border-white/10 bg-black/30 text-hud-dim hover:text-hud sm:grid"
                >
                  {voice.muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
                </button>
              )}
            </>
          )}
          <button
            type="submit"
            disabled={busy || value.trim() === ''}
            className="flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-1.5 rounded-xl bg-accent px-3 py-2 font-hud text-xs font-bold uppercase tracking-[0.18em] text-black shadow-[0_0_24px_-4px_var(--sky-accent)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40 sm:px-4"
          >
            {busy ? <LoaderCircle className="size-4 animate-spin" /> : <ArrowUpRight className="size-4" />}
            <span className="hidden sm:inline">{t('sky.send')}</span>
          </button>
        </div>
      </form>

      {voice?.error && (
        <p role="status" className="mt-2 text-center text-xs text-amber-200">
          {voice.error}
        </p>
      )}

      {/* one swipeable row on phones, wrapped and centred from sm up */}
      <div
        className={cn(
          'mt-4 -mx-4 flex snap-x gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:justify-center sm:overflow-visible sm:px-0',
          docked && 'max-sm:hidden'
        )}
      >
        {CHIPS.map((chip) => (
          <button
            key={chip}
            type="button"
            disabled={busy}
            onClick={() => onAsk(chip)}
            className={cn(
              'min-h-11 shrink-0 snap-start whitespace-nowrap rounded-full border border-white/10 bg-black/35 px-3.5 py-1.5 text-[13px] text-hud-dim backdrop-blur-md transition hover:border-accent/50 hover:text-hud disabled:opacity-40 sm:min-h-0',
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
          className="flex min-h-11 shrink-0 snap-start items-center gap-1.5 whitespace-nowrap rounded-full border border-accent/50 bg-black/45 px-3.5 py-1.5 sm:min-h-0 text-[13px] text-accent backdrop-blur-md transition hover:bg-black/60 disabled:opacity-40"
        >
          {locating ? <LoaderCircle className="size-3.5 animate-spin" /> : <Crosshair className="size-3.5" />}
          {locating ? t('sky.locating') : t('sky.useLocation')}
        </button>
      </div>
    </div>
  )
}
