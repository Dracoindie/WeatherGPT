/**
 * Demo replay awareness. With DEMO_REPLAY=1 the backend answers prepared demo
 * questions from recorded fixtures and marks each such response with the
 * header X-WeatherGPT-Replay: <recorded_at, UTC ISO>. Every backend call goes
 * through apiFetch, which notes that header, so <ReplayBadge> can say
 * "Replay: recorded data from …". Recorded data is never shown as live: once
 * any replayed response arrives, the badge stays until the page reloads.
 */

import { useSyncExternalStore } from 'react'

export const REPLAY_HEADER = 'X-WeatherGPT-Replay'

let recordedAt: string | null = null
const listeners = new Set<() => void>()

/** Remember the oldest recording time seen (the most conservative label). */
export function noteReplay(resp: Response): void {
  const ts = resp.headers.get(REPLAY_HEADER)
  if (!ts) return
  if (recordedAt === null || ts < recordedAt) {
    recordedAt = ts
    listeners.forEach((l) => l())
  }
}

/** fetch() for backend calls: same behaviour, plus replay detection. */
export async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const resp = await fetch(input, init)
  noteReplay(resp)
  return resp
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** The recording time of replayed data shown in this session, or null if all data is live. */
export function useReplayRecordedAt(): string | null {
  return useSyncExternalStore(subscribe, () => recordedAt, () => null)
}
