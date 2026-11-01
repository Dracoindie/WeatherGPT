/**
 * AuthGuard — Client Component wrapper that redirects unauthenticated users.
 *
 * While the session is loading it shows a spinner.
 * Once resolved:
 *  - If no user → redirect to /login
 *  - If user present → render children
 *
 * NOTE: Middleware also handles the redirect server-side for /dashboard routes,
 * so this is a secondary safety net for client-rendered components.
 */

'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuthContext } from '@/context/AuthContext'
import { useDemoContext } from '@/context/DemoContext'

interface AuthGuardProps {
  children: React.ReactNode
}

export default function AuthGuard({ children }: AuthGuardProps) {
  const { user, loading } = useAuthContext()
  const { isDemo } = useDemoContext()
  const router = useRouter()

  useEffect(() => {
    if (!isDemo && !loading && !user) {
      router.replace('/login')
    }
  }, [isDemo, user, loading, router])

  if (!isDemo && loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <span className="text-zinc-400 text-sm animate-pulse">Loading…</span>
      </div>
    )
  }

  if (!isDemo && !user) return null

  return <>{children}</>
}
