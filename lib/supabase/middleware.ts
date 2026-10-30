/**
 * Supabase session refresh for Next.js middleware.
 *
 * Called from middleware.ts on every request to keep the user's session
 * alive.  Must use the request/response cookies pattern so the updated
 * session cookie propagates to the browser.
 */

import { createServerClient } from '@supabase/ssr'
import { type NextRequest, NextResponse } from 'next/server'

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // Refresh the session (don't destructure — keep session token alive)
  const { data: { user } } = await supabase.auth.getUser()

  // /dashboard is protected by AuthGuard in the browser so its explicitly
  // in-memory demo state can be checked after client navigation. Do not add
  // server-rendered user data to this route. Other protected routes must keep
  // their server-side checks here.
  const url = request.nextUrl.clone()
  const isAuthPage = url.pathname === '/login' || url.pathname === '/signup'

  // If already logged in and visiting auth pages, redirect to dashboard
  if (isAuthPage && user) {
    url.pathname = '/dashboard'
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}
