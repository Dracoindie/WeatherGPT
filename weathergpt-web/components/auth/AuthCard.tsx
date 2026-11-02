'use client'

/** Shared frame for /login and /signup: Living Sky glass card inside AppShell. */

import Link from 'next/link'
import type { ReactNode } from 'react'
import { ArrowLeft } from 'lucide-react'
import { AppShell } from '@/components/ui/AppShell'
import { GlassPanel } from '@/components/panels/GlassPanel'
import { useI18n, type TranslationKey } from '@/context/I18nContext'

export function AuthCard({
  title,
  subtitle,
  children,
  footer,
}: {
  title: TranslationKey
  subtitle: TranslationKey
  children: ReactNode
  footer: ReactNode
}) {
  const { t } = useI18n()
  return (
    <AppShell mainClassName="flex flex-col items-center justify-center py-10">
      <div className="w-full max-w-md">
        <Link href="/" className="sky-label mb-4 inline-flex items-center gap-1.5 hover:text-hud">
          <ArrowLeft className="size-3.5" /> {t('auth.back')}
        </Link>
        <GlassPanel wet={false} className="p-6 sm:p-8">
          <h1 className="font-hud text-2xl font-bold tracking-tight text-hud sm:text-3xl">{t(title)}</h1>
          <p className="mt-2 text-sm text-hud-dim">{t(subtitle)}</p>
          <div className="mt-6">{children}</div>
          <div className="mt-6 border-t border-white/10 pt-4 text-center text-sm text-hud-dim">{footer}</div>
        </GlassPanel>
      </div>
    </AppShell>
  )
}

export function FormError({ children }: { children: ReactNode }) {
  return (
    <div role="alert" className="rounded-xl border border-sev-warning/40 bg-sev-warning/10 px-4 py-3 text-sm text-sev-warning-text">
      {children}
    </div>
  )
}

export function FieldError({ id, children }: { id: string; children?: ReactNode }) {
  if (!children) return null
  return (
    <p id={id} className="mt-1.5 text-xs text-sev-warning-text">
      {children}
    </p>
  )
}
