/**
 * Next.js request proxy.
 *
 * Refreshes the Supabase session, protects /dashboard, and keeps authenticated
 * users out of the sign-in routes. This is the Next.js 16 replacement for the
 * former middleware file convention.
 */

import { type NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'

export async function proxy(request: NextRequest) {
  return updateSession(request)
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon\\.ico|sitemap\\.xml|robots\\.txt|.*\\.(?:svg|png|jpg|jpeg|webp|ico)$).*)',
  ],
}
