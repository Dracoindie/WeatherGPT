'use client'

/**
 * ChatPanel — replaces ChatAsk with the Lovable design language.
 * Calls the existing POST /api/chat endpoint.
 * Shows the advisory card inline when the backend returns one.
 * Never invents numbers or advisory content.
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { contextFrom, postChat, ChatApiError, type ChatResponse } from '@/lib/api/chat'
import { useRole } from '@/lib/role'
import { Panel } from '@/components/common/Panel'
import { WeatherIntelligence } from '@/components/weather/WeatherIntelligence'
import { TrustStrip } from '@/components/common/TrustStrip'
import { useI18n } from '@/context/I18nContext'
import { Bot, Mic, MicOff, Send, Sparkles, Volume2, VolumeX } from 'lucide-react'
import type { AdvisoryResult } from '@/components/weather/WeatherIntelligence'
import { VoiceService, type VoiceStatus, getBrowserVoiceSupport } from '@/lib/voice/voiceService'

interface ChatPanelProps {
  latitude?: number
  longitude?: number
  accessToken?: string | null
  onAdvisoryChange?: (advisory: AdvisoryResult | null) => void
}

const suggestedPrompts = [
  'Will it rain tomorrow?',
  'Should I travel tomorrow?',
  'How hot will it get?',
  'Strong winds today?',
  'Kal baarish hogi?',
]

export function ChatPanel({ latitude, longitude, accessToken, onAdvisoryChange }: ChatPanelProps) {
  const { t, language } = useI18n()
  const { role } = useRole()
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<ChatResponse | null>(null)

  // Voice state
  const [voiceStatus, setVoiceStatus] = useState<VoiceStatus>('idle')
  const [voiceError, setVoiceError] = useState<string | null>(null)
  const [hasVoiceSupport, setHasVoiceSupport] = useState(false)
  const voiceServiceRef = useRef<VoiceService | null>(null)

  const hasCoords = latitude != null && longitude != null

  const submitQuery = useCallback(async (queryText: string) => {
    const text = queryText.trim()
    if (!text) {
      setError('Type or speak a weather question first.')
      return
    }

    setError('')
    setVoiceError(null)
    setResult(null)
    onAdvisoryChange?.(null)
    setLoading(true)

    try {
      const payload: Parameters<typeof postChat>[0] = {
        message: text,
        context: contextFrom(result),
        role,
      }
      if (hasCoords) {
        payload.latitude = latitude
        payload.longitude = longitude
      }
      const data = await postChat(payload, accessToken)
      setResult(data)
      onAdvisoryChange?.(data.advisory)

      // Automatically speak the grounded response back using TTS if voice was active
      if (voiceServiceRef.current && data.message) {
        voiceServiceRef.current.speak(data.message, language)
      }
    } catch (err: unknown) {
      setResult(null)
      if (err instanceof ChatApiError) {
        setError(
          err.status === 0
            ? err.message
            : err.message || 'The chat API could not answer this request.'
        )
      } else {
        setError('Could not reach the chat API. Is the backend running?')
      }
    } finally {
      setLoading(false)
    }
  }, [hasCoords, latitude, longitude, accessToken, onAdvisoryChange, language, result, role])

  useEffect(() => {
    // Avoid synchronous setState during render cycle
    Promise.resolve().then(() => {
      const support = getBrowserVoiceSupport()
      setHasVoiceSupport(support.stt || support.tts)
    })

    const service = new VoiceService({
      onStatusChange: (status) => {
        setVoiceStatus(status)
      },
      onTranscript: (transcript, isFinal) => {
        setMessage(transcript)
        if (isFinal) {
          // Final speech transcript received — send to chat automatically
          submitQuery(transcript)
        }
      },
      onError: (err) => {
        setVoiceError(err)
      },
    })
    voiceServiceRef.current = service

    return () => {
      service.destroy()
    }
  }, [submitQuery])

  function handleVoiceToggle() {
    if (!voiceServiceRef.current) return
    setVoiceError(null)

    if (voiceStatus === 'listening') {
      voiceServiceRef.current.stopListening()
    } else if (voiceStatus === 'speaking') {
      voiceServiceRef.current.stopSpeaking()
    } else {
      voiceServiceRef.current.startListening(language)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    // If speaking, stop on manual interaction
    voiceServiceRef.current?.stopSpeaking()
    await submitQuery(message)
  }

  return (
    <Panel className="min-h-[360px] p-5 sm:p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-fog">{t('chat.label')}</p>
          <h2 className="mt-2 font-display text-xl font-semibold tracking-tight text-ink">Ask WeatherGPT</h2>
          <p className="mt-1 text-sm text-ink-soft">Grounded answers from weather data, explained clearly.</p>
        </div>
        <div className="flex items-center gap-2">
          {voiceStatus === 'speaking' && (
            <button
              type="button"
              onClick={() => voiceServiceRef.current?.stopSpeaking()}
              className="flex items-center gap-1.5 rounded-lg border border-teal/30 bg-teal-soft px-2.5 py-1 text-xs text-teal hover:bg-teal-soft/80"
              title={t('voice.stopSpeaking')}
            >
              <VolumeX className="size-3.5" />
              <span className="font-mono text-[11px]">Mute</span>
            </button>
          )}
          <div className="grid size-10 place-items-center rounded-xl bg-teal-soft text-teal" aria-hidden="true">
            <Bot className="size-5" />
          </div>
        </div>
      </div>

      {!hasCoords && (
        <p className="mt-4 rounded-lg border border-line bg-canvas px-3 py-2 font-body text-xs text-ink-soft">{t('chat.hint')}</p>
      )}

      {/* Voice Status Indicator */}
      {voiceStatus === 'listening' && (
        <div className="mt-4 flex items-center gap-2.5 rounded-lg border border-teal/40 bg-teal-soft/50 px-3.5 py-2 text-xs text-teal animate-pulse">
          <span className="size-2 rounded-full bg-teal" />
          <span className="font-medium">{t('voice.listening')}</span>
        </div>
      )}

      {voiceStatus === 'speaking' && (
        <div className="mt-4 flex items-center gap-2.5 rounded-lg border border-teal/30 bg-teal-soft/30 px-3.5 py-2 text-xs text-teal">
          <Volume2 className="size-4 animate-bounce" />
          <span>{t('voice.speaking')}</span>
        </div>
      )}

      {voiceError && (
        <p className="mt-2 font-body text-xs text-coral">{voiceError}</p>
      )}

      {!result && !loading && (
        <div className="mt-6">
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-fog">Try asking</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {suggestedPrompts.map((prompt) => (
              <button
                key={prompt}
                type="button"
                onClick={() => {
                  setMessage(prompt)
                  submitQuery(prompt)
                }}
                className="rounded-full border border-line bg-canvas px-3 py-1.5 text-xs font-medium text-ink-soft transition-colors hover:border-teal hover:text-teal focus:outline-none focus:ring-2 focus:ring-teal/40"
              >
                {prompt}
              </button>
            ))}
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="mt-6 flex gap-2 rounded-[14px] border border-line bg-canvas p-2 focus-within:border-teal focus-within:ring-2 focus-within:ring-teal/20">
        <input
          type="text"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder={voiceStatus === 'listening' ? t('voice.listening') : t('chat.placeholder')}
          disabled={loading}
          className="min-w-0 flex-1 bg-transparent px-2 py-2 font-body text-sm text-ink placeholder-fog focus:outline-none disabled:opacity-50"
        />

        {/* Real browser voice interaction button */}
        <button
          type="button"
          onClick={handleVoiceToggle}
          disabled={loading || !hasVoiceSupport}
          title={
            !hasVoiceSupport
              ? t('voice.unsupported')
              : voiceStatus === 'listening'
              ? t('voice.stop')
              : voiceStatus === 'speaking'
              ? t('voice.stopSpeaking')
              : t('voice.start')
          }
          aria-label={
            voiceStatus === 'listening'
              ? t('voice.stop')
              : t('voice.start')
          }
          className={`grid size-9 place-items-center rounded-[10px] transition-colors ${
            voiceStatus === 'listening'
              ? 'bg-coral text-panel animate-pulse'
              : voiceStatus === 'speaking'
              ? 'bg-teal text-panel'
              : hasVoiceSupport
              ? 'bg-panel text-ink hover:bg-line/40'
              : 'text-fog opacity-50 cursor-not-allowed'
          }`}
        >
          {voiceStatus === 'listening' ? (
            <MicOff className="size-4" />
          ) : voiceStatus === 'speaking' ? (
            <Volume2 className="size-4" />
          ) : (
            <Mic className="size-4" />
          )}
        </button>

        <button
          type="submit"
          disabled={loading || !message.trim()}
          className="grid size-9 place-items-center rounded-[10px] bg-ink text-panel hover:bg-ink/90 disabled:opacity-50 transition-colors"
        >
          {loading ? <span className="font-mono">{t('chat.asking')}</span> : <Send className="size-4" aria-hidden="true" />}
        </button>
      </form>

      {loading && (
        <p className="mt-2 font-body text-xs text-fog">Fetching a grounded answer…</p>
      )}

      {error && (
        <p className="mt-2 font-body text-xs text-coral">{error}</p>
      )}

      {result && !loading && (
        <div className="mt-4 space-y-4">
          {/* Natural language answer */}
          <div className="rounded-[12px] border border-teal/15 bg-teal-soft/45 p-4">
            <div className="flex items-center justify-between">
              <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-teal">WeatherGPT</p>
              {hasVoiceSupport && (
                <button
                  type="button"
                  onClick={() => {
                    if (voiceStatus === 'speaking') {
                      voiceServiceRef.current?.stopSpeaking()
                    } else if (result.message) {
                      voiceServiceRef.current?.speak(result.message, language)
                    }
                  }}
                  className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-teal hover:underline"
                  title="Speak response"
                >
                  <Volume2 className="size-3" />
                  {voiceStatus === 'speaking' ? 'Stop' : 'Listen'}
                </button>
              )}
            </div>
            <p className="mt-1 font-body text-sm leading-relaxed text-ink">{result.message}</p>
            {result.location && (
              <p className="mt-2 font-mono text-[10px] text-fog">
                {result.location.name} ·{' '}
                {result.location.latitude.toFixed(2)}, {result.location.longitude.toFixed(2)}
              </p>
            )}
          </div>

          {/* Advisory card — only shown when the backend returns one */}
          {result.advisory && (
            <WeatherIntelligence advisory={result.advisory} />
          )}

          <div className="flex items-center gap-2 border-t border-line pt-3 font-mono text-[10px] uppercase tracking-[0.14em] text-fog">
            <Sparkles className="size-3" aria-hidden="true" />
            Weather facts are sourced by the API; WeatherGPT explains them.
          </div>

          <TrustStrip />
        </div>
      )}
    </Panel>
  )
}

