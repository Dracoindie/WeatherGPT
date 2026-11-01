'use client'

/**
 * Web Push subscriptions for early-warning alerts.
 *
 * The browser subscribes with the server's VAPID public key, then the row is
 * stored in Supabase (public.alert_subscriptions, RLS: own rows only). The
 * backend job reads the rows and pushes when severity becomes high.
 */

import { API_BASE } from '@/lib/api/base'
import { createClient } from '@/lib/supabase/client'

export interface PushConfig {
  available: boolean
  vapid_public_key: string | null
  reason: string | null
}

export interface AlertSubscription {
  id: string
  location_name: string
  latitude: number
  longitude: number
  endpoint: string
  created_at: string
}

export function browserSupportsPush(): boolean {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}

export async function getPushConfig(): Promise<PushConfig> {
  const resp = await fetch(`${API_BASE}/api/push/config`)
  if (!resp.ok) throw new Error('Push configuration unavailable')
  return (await resp.json()) as PushConfig
}

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(padded)
  const out = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

async function registration(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration('/')
  if (existing) return existing
  await navigator.serviceWorker.register('/sw.js', { scope: '/' })
  return navigator.serviceWorker.ready
}

export async function subscribeToAlerts(
  location: { name: string; latitude: number; longitude: number },
  vapidPublicKey: string,
  language: string
): Promise<void> {
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') throw new Error('Notifications are blocked for this site.')
  const reg = await registration()
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) }))
  const json = sub.toJSON()
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) throw new Error('The browser returned an incomplete subscription.')
  const { error } = await createClient()
    .from('alert_subscriptions')
    .upsert(
      {
        location_name: location.name,
        latitude: location.latitude,
        longitude: location.longitude,
        endpoint: json.endpoint,
        p256dh: json.keys.p256dh,
        auth: json.keys.auth,
        language,
      },
      { onConflict: 'user_id,endpoint,latitude,longitude' }
    )
  if (error) throw new Error(error.message)
}

export async function listAlertSubscriptions(): Promise<AlertSubscription[]> {
  const { data, error } = await createClient()
    .from('alert_subscriptions')
    .select('id,location_name,latitude,longitude,endpoint,created_at')
    .order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []) as AlertSubscription[]
}

export async function deleteAlertSubscription(id: string): Promise<void> {
  const { error } = await createClient().from('alert_subscriptions').delete().eq('id', id)
  if (error) throw new Error(error.message)
}
