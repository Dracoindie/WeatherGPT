/**
 * SignInForm — email/password login form.
 *
 * Client-side validation before calling Supabase Auth signIn.
 * On success, the AuthProvider's onAuthStateChange fires and
 * middleware redirects to /dashboard.
 */

'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuthContext } from '@/context/AuthContext'
import { useDemoContext } from '@/context/DemoContext'

interface SignInFormProps {
  onSuccess?: () => void
}

export default function SignInForm({ onSuccess }: SignInFormProps) {
  const { signIn } = useAuthContext()
  const { enterDemo } = useDemoContext()
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)
  const [serverError, setServerError] = useState('')

  function validate(): boolean {
    const newErrors: Record<string, string> = {}
    if (!email.trim()) newErrors.email = 'Email is required.'
    if (!password) newErrors.password = 'Password is required.'
    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!validate()) return

    setServerError('')
    setSubmitting(true)
    const { error } = await signIn(email.trim(), password)
    setSubmitting(false)

    if (error) {
      // Keep the provider error available for diagnosis. Do not log the
      // password; Supabase receives the exact values passed to signIn().
      console.error('Supabase sign-in failed', {
        code: error.code,
        message: error.message,
        status: error.status,
      })

      if (process.env.NODE_ENV !== 'production') {
        setServerError(
          `Supabase authentication error${error.code ? ` (${error.code})` : ''}: ${error.message}`
        )
      } else {
        setServerError('Unable to sign in. Please try again.')
      }
      return
    }

    onSuccess?.()
    router.push('/dashboard')
    router.refresh()
  }

  function handleEnterDemo() {
    enterDemo()
    router.push('/dashboard')
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
      {serverError && (
        <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300">
          {serverError}
        </div>
      )}

      <div>
        <label className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Email
        </label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          className="w-full rounded-lg border border-zinc-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
        />
        {errors.email && <p className="mt-1 text-xs text-red-500">{errors.email}</p>}
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Password
        </label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Your password"
          className="w-full rounded-lg border border-zinc-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
        />
        {errors.password && (
          <p className="mt-1 text-xs text-red-500">{errors.password}</p>
        )}
      </div>

      <button
        type="submit"
        disabled={submitting}
        className="rounded-lg bg-blue-600 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
      >
        {submitting ? 'Signing in…' : 'Sign in'}
      </button>

      <button
        type="button"
        onClick={handleEnterDemo}
        className="rounded-lg border border-zinc-300 py-2.5 text-sm font-semibold text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-800"
      >
        Enter Demo
      </button>
    </form>
  )
}
