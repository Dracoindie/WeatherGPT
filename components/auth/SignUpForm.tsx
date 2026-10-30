/**
 * SignUpForm — email/password registration form.
 *
 * Validates client-side before calling Supabase Auth signUp.
 * Shows inline errors.  On success, shows a confirmation message
 * asking the user to verify their email.
 */

'use client'

import { useState } from 'react'
import { useAuthContext } from '@/context/AuthContext'

const MIN_PASSWORD_LENGTH = 8

function validateEmail(email: string): string {
  if (!email) return 'Email is required.'
  // RFC 5322–like basic check
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'Please enter a valid email address.'
  return ''
}

function validatePassword(password: string): string {
  if (!password) return 'Password is required.'
  if (password.length < MIN_PASSWORD_LENGTH)
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`
  return ''
}

interface SignUpFormProps {
  onSuccess?: () => void
}

export default function SignUpForm({ onSuccess }: SignUpFormProps) {
  const { signUp } = useAuthContext()
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)
  const [successMsg, setSuccessMsg] = useState('')
  const [serverError, setServerError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const newErrors: Record<string, string> = {}

    const emailErr = validateEmail(email)
    if (emailErr) newErrors.email = emailErr

    const pwErr = validatePassword(password)
    if (pwErr) newErrors.password = pwErr

    if (Object.keys(newErrors).length) {
      setErrors(newErrors)
      return
    }

    setErrors({})
    setServerError('')
    setSubmitting(true)

    const { error } = await signUp(email.trim(), password, fullName.trim())
    setSubmitting(false)

    if (error) {
      setServerError(error.message)
      return
    }

    setSuccessMsg(
      'Account created! Check your email to confirm your address before logging in.'
    )
    onSuccess?.()
  }

  if (successMsg) {
    return (
      <div className="rounded-xl border border-green-200 bg-green-50 p-6 text-center text-green-800 dark:border-green-800 dark:bg-green-900/20 dark:text-green-300">
        <p className="text-lg font-semibold">✅ {successMsg}</p>
      </div>
    )
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
          Full name (optional)
        </label>
        <input
          type="text"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          placeholder="Priya Sharma"
          className="w-full rounded-lg border border-zinc-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
        />
      </div>

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
          placeholder="Min. 8 characters"
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
        {submitting ? 'Creating account…' : 'Create account'}
      </button>
    </form>
  )
}
