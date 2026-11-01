import { redirect } from 'next/navigation'

/**
 * Classic entry — the former root route, kept reachable after the Living Sky
 * home took over `/`. Redirects to /dashboard; AuthGuard there sends
 * unauthenticated users to /login.
 */
export default function ClassicHome() {
  redirect('/dashboard')
}
