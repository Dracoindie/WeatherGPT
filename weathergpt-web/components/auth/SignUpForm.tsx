/**
 * SignUpForm: email/password registration. Validates client-side before
 * calling Supabase Auth signUp; on success asks the user to confirm their email.
 */

'use client'

import { useState } from 'react'
import { CircleCheck, LoaderCircle, UserPlus } from 'lucide-react'
import { useAuthContext } from '@/context/AuthContext'
import { useI18n, type TranslationKey } from '@/context/I18nContext'
import { SkyButton } from '@/components/ui/SkyButton'
import { SkyField, SkyInput } from '@/components/ui/SkyInput'
import { FieldError, FormError } from './AuthCard'

const MIN_PASSWORD_LENGTH = 8

function validateEmail(email: string): TranslationKey | '' {
  if (!email) return 'auth.emailRequired'
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'auth.emailInvalid'
  return ''
}

function validatePassword(password: string): TranslationKey | '' {
  if (!password) return 'auth.passwordRequired'
  if (password.length < MIN_PASSWORD_LENGTH) return 'auth.passwordShort'
  return ''
}

export default function SignUpForm({ onSuccess }: { onSuccess?: () => void }) {
  const { signUp } = useAuthContext()
  const { t } = useI18n()
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [errors, setErrors] = useState<Record<string, TranslationKey>>({})
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)
  const [serverError, setServerError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const next: Record<string, TranslationKey> = {}
    const emailErr = validateEmail(email.trim())
    if (emailErr) next.email = emailErr
    const pwErr = validatePassword(password)
    if (pwErr) next.password = pwErr
    setErrors(next)
    if (Object.keys(next).length) return

    setServerError('')
    setSubmitting(true)
    const { error } = await signUp(email.trim(), password, fullName.trim())
    setSubmitting(false)
    if (error) {
      setServerError(error.message)
      return
    }
    setDone(true)
    onSuccess?.()
  }

  if (done) {
    return (
      <div role="status" className="flex items-start gap-3 rounded-xl border border-sev-none/40 bg-sev-none/10 p-4 text-sm text-hud">
        <CircleCheck className="mt-0.5 size-5 shrink-0 text-sev-none-text" />
        {t('auth.created')}
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
      {serverError && <FormError>{serverError}</FormError>}
      <SkyField label={t('auth.fullName')} htmlFor="signup-name">
        <SkyInput id="signup-name" type="text" autoComplete="name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
      </SkyField>
      <SkyField label={t('auth.email')} htmlFor="signup-email">
        <SkyInput
          id="signup-email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          aria-invalid={!!errors.email}
          aria-describedby={errors.email ? 'signup-email-error' : undefined}
        />
        <FieldError id="signup-email-error">{errors.email && t(errors.email)}</FieldError>
      </SkyField>
      <SkyField label={t('auth.password')} htmlFor="signup-password">
        <SkyInput
          id="signup-password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={t('auth.passwordHint')}
          aria-invalid={!!errors.password}
          aria-describedby={errors.password ? 'signup-password-error' : undefined}
        />
        <FieldError id="signup-password-error">{errors.password && t(errors.password)}</FieldError>
      </SkyField>
      <SkyButton type="submit" variant="primary" disabled={submitting} className="mt-1 w-full">
        {submitting ? <LoaderCircle className="size-4 animate-spin" /> : <UserPlus className="size-4" />}
        {submitting ? t('auth.creating') : t('auth.create')}
      </SkyButton>
    </form>
  )
}
