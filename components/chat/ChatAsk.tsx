/**
 * Minimal ask box for POST /api/chat.
 * Layout/styling matches the existing dashboard cards — not a redesign.
 * Displays only the grounded message returned by the backend.
 */

'use client'

import { useState } from 'react'
import { postChat, ChatApiError, type ChatResponse } from '@/lib/api/chat'

interface ChatAskProps {
  latitude?: number
  longitude?: number
  accessToken?: string | null
}

export default function ChatAsk({ latitude, longitude, accessToken }: ChatAskProps) {
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<ChatResponse | null>(null)

  const hasRequestCoords = latitude != null && longitude != null

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const text = message.trim()
    if (!text) {
      setError('Type a weather question first.')
      return
    }

    setError('')
    setResult(null)
    setLoading(true)
    try {
      const payload: { message: string; latitude?: number; longitude?: number } = {
        message: text,
      }
      if (hasRequestCoords) {
        payload.latitude = latitude
        payload.longitude = longitude
      }
      const data = await postChat(payload, accessToken)
      setResult(data)
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
  }

  return (
    <div className="mt-6 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
      <p className="mb-3 text-sm font-semibold text-zinc-700 dark:text-zinc-300">
        Ask about the weather
      </p>
      {!hasRequestCoords && (
        <p className="mb-2 text-xs text-zinc-500 dark:text-zinc-400">
          Name a city in your question, or pick a location above. Weather cannot be
          answered without a place.
        </p>
      )}
      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          type="text"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Pune mein kal baarish hogi kya?"
          disabled={loading}
          className="flex-1 rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
        />
        <button
          type="submit"
          disabled={loading || !message.trim()}
          className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? '…' : 'Ask'}
        </button>
      </form>
      {loading && (
        <p className="mt-2 text-xs text-zinc-400">Fetching a grounded answer…</p>
      )}
      {error && (
        <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>
      )}
      {result && !loading && (
        <div className="mt-3 space-y-1 text-sm text-zinc-700 dark:text-zinc-300">
          <p>{result.message}</p>
          <p className="text-xs text-zinc-400">
            Source: {result.source}
            {result.location
              ? ` · ${result.location.name} (${result.location.latitude.toFixed(2)}, ${result.location.longitude.toFixed(2)})`
              : ''}
          </p>
        </div>
      )}
    </div>
  )
}
