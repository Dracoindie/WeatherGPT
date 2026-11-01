/**
 * SignInForm: email/password login, plus the in-memory demo session.
 *
 * Client-side validation before calling Supabase Auth signIn. On success the
 * AuthProvider's onAuthStateChange fires and we go to /dashboard.
 */

'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { LoaderCircle, LogIn, Sparkles } from 'lucide-react'
import { useAuthContext } from '@/context/AuthContext'
import { useDemoContext } from '@/context/DemoContext'
import { useI18n, type TranslationKey } from '@/context/I18nContext'
import { SkyButton } from '@/components/ui/SkyButton'
import { SkyField, SkyInput } from '@/components/ui/SkyInput'
import { FieldError, FormError } from './AuthCard'

export default function SignInForm({ onSuccess }: { onSuccess?: () => void }) {
  const { signIn } = useAuthContext()
  const { enterDemo } = useDemoContext()
  const { t } = useI18n()
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [errors, setErrors] = useState<Record<string, TranslationKey>>({})
  const [submitting, setSubmitting] = useState(false)
  const [serverError, setServerError] = useState('')

  function validate(): boolean {
    const next: Record<string, TranslationKey> = {}
    if (!email.trim()) next.email = 'auth.emailRequired'
    if (!password) next.password = 'auth.passwordRequired'
    setErrors(next)
    return Object.keys(next).length === 0
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!validate()) return
    setServerError('')
    setSubmitting(true)
    const { error } = await signIn(email.trim(), password)
    setSubmitting(false)
    if (error) {
      // Keep the provider error for diagnosis; never log the password.
      console.error('Supabase sign-in failed', { code: error.code, message: error.message, status: error.status })
      setServerError(
        process.env.NODE_ENV !== 'production'
          ? `Supabase authentication error${error.code ? ` (${error.code})` : ''}: ${error.message}`
          : t('auth.signinFailed')
      )
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
      {serverError && <FormError>{serverError}</FormError>}
      <SkyField label={t('auth.email')} htmlFor="signin-email">
        <SkyInput
          id="signin-email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          aria-invalid={!!errors.email}
          aria-describedby={errors.email ? 'signin-email-error' : undefined}
        />
        <FieldError id="signin-email-error">{errors.email && t(errors.email)}</FieldError>
      </SkyField>
      <SkyField label={t('auth.password')} htmlFor="signin-password">
        <SkyInput
          id="signin-password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          aria-invalid={!!errors.password}
          aria-describedby={errors.password ? 'signin-password-error' : undefined}
        />
        <FieldError id="signin-password-error">{errors.password && t(errors.password)}</FieldError>
      </SkyField>
      <SkyButton type="submit" variant="primary" disabled={submitting} className="mt-1 w-full">
        {submitting ? <LoaderCircle className="size-4 animate-spin" /> : <LogIn className="size-4" />}
        {submitting ? t('auth.signingIn') : t('auth.signin')}
      </SkyButton>
      <div className="flex items-center gap-3 text-[11px] uppercase tracking-[0.2em] text-hud-dim">
        <span className="h-px flex-1 bg-white/10" />
        {t('auth.or')}
        <span className="h-px flex-1 bg-white/10" />
      </div>
      <SkyButton onClick={handleEnterDemo} variant="ghost" className="w-full">
        <Sparkles className="size-4" />
        {t('auth.demo')}
      </SkyButton>
      <p className="-mt-1 text-center text-xs text-hud-dim">{t('auth.demoNote')}</p>
    </form>
  )
}
