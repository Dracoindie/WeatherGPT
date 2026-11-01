/**
 * /login page
 *
 * Rendered when: unauthenticated user visits /login or is redirected
 * from /dashboard by middleware.  Authenticated users are redirected
 * to /dashboard immediately by middleware.
 */

import Link from 'next/link'
import SignInForm from '@/components/auth/SignInForm'

export const metadata = { title: 'Sign in — WeatherGPT' }

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 px-4 dark:bg-zinc-950">
      <div className="w-full max-w-sm">
        {/* Header */}
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-white">
            🌤️ WeatherGPT
          </h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            SIH 2026 — Sign in to your account
          </p>
        </div>

        {/* Card */}
        <div className="rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="mb-6 text-lg font-semibold text-zinc-800 dark:text-zinc-200">
            Welcome back
          </h2>
          <SignInForm />
          <p className="mt-5 text-center text-sm text-zinc-500 dark:text-zinc-400">
            Don&apos;t have an account?{' '}
            <Link
              href="/signup"
              className="font-medium text-blue-600 hover:underline dark:text-blue-400"
            >
              Sign up
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}
