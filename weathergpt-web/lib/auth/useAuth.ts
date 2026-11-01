/**
 * useAuth — React hook for Supabase authentication.
 *
 * Provides:
 *   user     - current Supabase User | null
 *   session  - current Session | null
 *   loading  - true while the initial session is being resolved
 *   signUp   - email/password signup
 *   signIn   - email/password login
 *   signOut  - logout
 *
 * NOTE: Google OAuth is architected for but not enabled in this prototype.
 * To enable: call supabase.auth.signInWithOAuth({ provider: 'google' })
 * after configuring the Google provider in the Supabase Dashboard.
 */

'use client'

import { useEffect, useState, useCallback } from 'react'
import type { Session, User, AuthError } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/client'

export interface AuthResult {
  error: AuthError | null
}

export interface UseAuthReturn {
  user: User | null
  session: Session | null
  loading: boolean
  signUp: (email: string, password: string, fullName?: string) => Promise<AuthResult>
  signIn: (email: string, password: string) => Promise<AuthResult>
  signOut: () => Promise<AuthResult>
}

export function useAuth(): UseAuthReturn {
  const supabase = createClient()
  const [user, setUser] = useState<User | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Resolve initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setUser(session?.user ?? null)
      setLoading(false)
    })

    // Subscribe to auth state changes (login, logout, token refresh)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setSession(session)
        setUser(session?.user ?? null)
        setLoading(false)
      }
    )

    return () => subscription.unsubscribe()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const signUp = useCallback(
    async (email: string, password: string, fullName?: string): Promise<AuthResult> => {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { full_name: fullName ?? '' },
        },
      })
      return { error }
    },
    [] // eslint-disable-line react-hooks/exhaustive-deps
  )

  const signIn = useCallback(
    async (email: string, password: string): Promise<AuthResult> => {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      return { error }
    },
    [] // eslint-disable-line react-hooks/exhaustive-deps
  )

  const signOut = useCallback(async (): Promise<AuthResult> => {
    const { error } = await supabase.auth.signOut()
    return { error }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return { user, session, loading, signUp, signIn, signOut }
}
