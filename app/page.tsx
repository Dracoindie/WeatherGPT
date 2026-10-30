import { redirect } from 'next/navigation'

/**
 * Root route — redirect to /dashboard.
 * Middleware will further redirect unauthenticated users to /login.
 */
export default function Home() {
  redirect('/dashboard')
}
