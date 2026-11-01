import type { ChatResponse } from '@/lib/api/chat'

export interface ThreadEntry {
  id: number
  query: string
  /** true when the query was sent with browser GPS coordinates */
  usedGps: boolean
  askedAt: Date
  status: 'pending' | 'done' | 'error'
  response?: ChatResponse
  error?: string
  /** restored from this device's last answer while offline */
  saved?: boolean
}
