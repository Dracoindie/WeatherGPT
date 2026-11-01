'use client'

/**
 * Role mode (citizen / farmer / aviation / disaster manager / researcher).
 *
 * Remembered on this device; when signed in it is also saved to the
 * profile (profiles.role) and loaded from it on sign-in. The role changes
 * what replies and panels emphasise, never the numbers.
 */

import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { useAuthContext } from '@/context/AuthContext'
import { getProfile, upsertProfile } from '@/lib/profile/profileService'

export type UserRole = 'citizen' | 'farmer' | 'aviation' | 'disaster_manager' | 'researcher'

export const ROLES: readonly UserRole[] = ['citizen', 'farmer', 'aviation', 'disaster_manager', 'researcher']

export const ROLE_LABELS: Record<UserRole, { en: string; hi: string; hinglish: string }> = {
  citizen: { en: 'Citizen', hi: 'नागरिक', hinglish: 'Citizen' },
  farmer: { en: 'Farmer', hi: 'किसान', hinglish: 'Kisan' },
  aviation: { en: 'Aviation', hi: 'विमानन', hinglish: 'Aviation' },
  disaster_manager: { en: 'Disaster manager', hi: 'आपदा प्रबंधक', hinglish: 'Disaster manager' },
  researcher: { en: 'Researcher', hi: 'शोधकर्ता', hinglish: 'Researcher' },
}

const STORAGE_KEY = 'wgpt:role'
let current: UserRole | null = null
const listeners = new Set<() => void>()

function isRole(v: unknown): v is UserRole {
  return typeof v === 'string' && (ROLES as readonly string[]).includes(v)
}

function read(): UserRole {
  if (current) return current
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    current = isRole(v) ? v : 'citizen'
  } catch {
    current = 'citizen'
  }
  return current
}

function write(role: UserRole) {
  current = role
  try {
    localStorage.setItem(STORAGE_KEY, role)
  } catch {
    // storage blocked: the role lasts for this page only
  }
  listeners.forEach((l) => l())
}

function subscribe(cb: () => void) {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

export function useRole(): { role: UserRole; setRole: (role: UserRole) => void } {
  const role = useSyncExternalStore(subscribe, read, () => 'citizen' as UserRole)
  const { user } = useAuthContext()
  const userId = user?.id

  // Signed in: the profile's role wins over this device's choice.
  useEffect(() => {
    if (!userId) return
    let cancelled = false
    getProfile(userId).then((p) => {
      if (!cancelled && p && isRole(p.role) && p.role !== read()) write(p.role)
    })
    return () => {
      cancelled = true
    }
  }, [userId])

  const setRole = useCallback(
    (next: UserRole) => {
      write(next)
      if (userId) void upsertProfile(userId, { role: next })
    },
    [userId]
  )
  return { role, setRole }
}
