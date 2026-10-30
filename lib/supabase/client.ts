/**
 * Supabase browser client (singleton).
 *
 * Usage: import { createClient } from '@/lib/supabase/client'
 *
 * Used in:  Client Components, hooks, browser-side services.
 * NOT for:  Server Components, Route Handlers, or middleware (use server.ts).
 *
 * Credentials come from environment variables only — never hardcoded.
 */

import { createBrowserClient } from '@supabase/ssr'

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}
