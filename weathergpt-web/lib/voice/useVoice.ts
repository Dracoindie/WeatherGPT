'use client'

/**
 * Voice for the Living Sky console: mic input (en-IN / hi-IN / mr-IN) and
 * spoken replies, with a mute switch remembered on this device. Everything
 * degrades to "unsupported" when the browser lacks the Web Speech APIs.
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { getBrowserVoiceSupport, VoiceService, type VoiceLanguage, type VoiceStatus } from './voiceService'

const MUTE_KEY = 'wgpt:voice-muted'
const muteListeners = new Set<() => void>()

function readMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === '1'
  } catch {
    return false
  }
}

function subscribeMuted(cb: () => void) {
  muteListeners.add(cb)
  return () => muteListeners.delete(cb)
}

export function setVoiceMuted(muted: boolean) {
  try {
    localStorage.setItem(MUTE_KEY, muted ? '1' : '0')
  } catch {
    // storage blocked
  }
  if (muted && typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel()
  muteListeners.forEach((l) => l())
}

const noSupport = { stt: false, tts: false }
let supportCache: { stt: boolean; tts: boolean } | null = null
function readSupport() {
  if (!supportCache) supportCache = getBrowserVoiceSupport()
  return supportCache
}

export interface UseVoice {
  supported: { stt: boolean; tts: boolean }
  status: VoiceStatus
  interim: string
  error: string | null
  muted: boolean
  listen: (language: VoiceLanguage) => void
  stopListening: () => void
  speak: (text: string, language: VoiceLanguage) => void
  stopSpeaking: () => void
  setMuted: (muted: boolean) => void
}

export function useVoice(onFinalTranscript: (text: string) => void): UseVoice {
  const supported = useSyncExternalStore(() => () => {}, readSupport, () => noSupport)
  const muted = useSyncExternalStore(subscribeMuted, readMuted, () => false)
  const [status, setStatus] = useState<VoiceStatus>('idle')
  const [interim, setInterim] = useState('')
  const [error, setError] = useState<string | null>(null)
  const service = useRef<VoiceService | null>(null)
  const onFinal = useRef(onFinalTranscript)

  useEffect(() => {
    onFinal.current = onFinalTranscript
  }, [onFinalTranscript])

  useEffect(() => {
    const svc = new VoiceService({
      onStatusChange: setStatus,
      onError: setError,
      onTranscript: (text, isFinal) => {
        if (isFinal) {
          setInterim('')
          onFinal.current(text)
        } else {
          setInterim(text)
        }
      },
    })
    service.current = svc
    return () => {
      svc.destroy()
      service.current = null
    }
  }, [])

  const listen = useCallback((language: VoiceLanguage) => {
    setError(null)
    setInterim('')
    service.current?.startListening(language)
  }, [])

  const stopListening = useCallback(() => service.current?.stopListening(), [])
  const speak = useCallback((text: string, language: VoiceLanguage) => service.current?.speak(text, language), [])
  const stopSpeaking = useCallback(() => service.current?.stopSpeaking(), [])

  return { supported, status, interim, error, muted, listen, stopListening, speak, stopSpeaking, setMuted: setVoiceMuted }
}
