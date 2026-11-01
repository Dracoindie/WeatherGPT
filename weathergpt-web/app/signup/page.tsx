/**
 * /signup: new account, in the shared Living Sky shell.
 * Signed-in users are redirected to /dashboard by the proxy.
 */

import { SignupView } from '@/components/auth/AuthPages'

export const metadata = { title: 'Create account — WeatherGPT' }

export default function SignupPage() {
  return <SignupView />
}
