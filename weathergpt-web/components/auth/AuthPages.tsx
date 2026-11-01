'use client'

import Link from 'next/link'
import { useI18n } from '@/context/I18nContext'
import { AuthCard } from './AuthCard'
import SignInForm from './SignInForm'
import SignUpForm from './SignUpForm'

export function LoginView() {
  const { t } = useI18n()
  return (
    <AuthCard
      title="auth.signinTitle"
      subtitle="auth.signinSub"
      footer={
        <>
          {t('auth.noAccount')}{' '}
          <Link href="/signup" className="font-medium text-accent hover:underline">
            {t('auth.signup')}
          </Link>
        </>
      }
    >
      <SignInForm />
    </AuthCard>
  )
}

export function SignupView() {
  const { t } = useI18n()
  return (
    <AuthCard
      title="auth.signupTitle"
      subtitle="auth.signupSub"
      footer={
        <>
          {t('auth.haveAccount')}{' '}
          <Link href="/login" className="font-medium text-accent hover:underline">
            {t('auth.signin')}
          </Link>
        </>
      }
    >
      <SignUpForm />
    </AuthCard>
  )
}
