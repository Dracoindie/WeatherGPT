/**
 * Supabase server client.
 *
 * Usage: import { createClient } from '@/lib/supabase/server'
 *
 * Used in:  Server Components, Route Handlers, Server Actions.
 * NOT for:  Client Components (use client.ts instead).
 *
 * Reads/writes cookies via Next.js `cookies()` so sessions are preserved
 * across server renders.
 */

import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // setAll() may be called from a Server Component where cookies
            // are read-only.  Middleware handles the actual refresh.
          }
        },
      },
    }
  )
}
