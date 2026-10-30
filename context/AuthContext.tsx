/**
 * AuthContext — application-wide authentication state.
 *
 * Wraps the app in RootLayout so any Client Component can call
 * useAuthContext() to get the current user without prop-drilling.
 */

'use client'

import React, { createContext, useContext } from 'react'
import { useAuth, type UseAuthReturn } from '@/lib/auth/useAuth'

const AuthContext = createContext<UseAuthReturn | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const auth = useAuth()
  return <AuthContext.Provider value={auth}>{children}</AuthContext.Provider>
}

/**
 * useAuthContext — consume the auth context.
 * Must be used inside <AuthProvider>.
 */
export function useAuthContext(): UseAuthReturn {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuthContext must be used within <AuthProvider>')
  }
  return ctx
}
