/**
 * /login: email sign-in and the demo session, in the shared Living Sky shell.
 * Signed-in users are redirected to /dashboard by the proxy.
 */

import { LoginView } from '@/components/auth/AuthPages'

export const metadata = { title: 'Sign in — WeatherGPT' }

export default function LoginPage() {
  return <LoginView />
}
