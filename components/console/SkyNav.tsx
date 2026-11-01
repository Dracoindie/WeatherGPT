'use client'

/**
 * Living Sky navigation — HUD-styled counterpart to components/layout/TopNav.
 * Links to the existing (auth-guarded) pages so they stay reachable from `/`.
 */

import { useState } from 'react'
import Link from 'next/link'
import { Menu, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { LANGUAGE_LABELS, LANGUAGES, useI18n, type TranslationKey } from '@/context/I18nContext'
import { useAuthContext } from '@/context/AuthContext'

const links: { href: string; label: TranslationKey }[] = [
  { href: '/dashboard', label: 'nav.dashboard' },
  { href: '/map', label: 'nav.map' },
  { href: '/alerts', label: 'nav.alerts' },
  { href: '/climate', label: 'nav.climate' },
  { href: '/classic', label: 'nav.classic' },
]

export function SkyNav() {
  const { t, language, setLanguage } = useI18n()
  const { user, signOut } = useAuthContext()
  const [open, setOpen] = useState(false)

  const langToggle = (
    <div className="flex items-center rounded-full border border-white/10 bg-black/30 p-0.5" role="group" aria-label="Language">
      {LANGUAGES.map((code) => (
        <button
          key={code}
          type="button"
          onClick={() => setLanguage(code)}
          aria-pressed={language === code}
          className={cn(
            'rounded-full px-2.5 py-1 font-readout text-[11px] transition-colors',
            language === code ? 'bg-accent text-black' : 'text-hud-dim hover:text-hud'
          )}
        >
          {LANGUAGE_LABELS[code]}
        </button>
      ))}
    </div>
  )

  return (
    <header className="relative z-40">
      <div className="mx-auto flex h-16 max-w-[1500px] items-center gap-6 px-4 sm:px-6">
        <Link href="/" className="group flex items-center gap-3" aria-label="WeatherGPT — Living Sky">
          <span className="relative grid size-9 place-items-center rounded-xl border border-accent/40 bg-black/40 shadow-[0_0_24px_-6px_var(--sky-accent)]">
            <span className="absolute inset-1.5 rounded-lg border border-accent/25" />
            <span className="font-hud text-sm font-bold text-accent">W</span>
          </span>
          <span className="leading-none">
            <span className="font-hud text-[17px] font-semibold tracking-tight">
              Weather<span className="text-accent">GPT</span>
            </span>
            <span className="mt-1 block font-readout text-[9px] uppercase tracking-[0.3em] text-hud-dim">
              {t('nav.home')} · SIH26068
            </span>
          </span>
        </Link>

        <nav className="ml-4 hidden items-center gap-1 lg:flex" aria-label={t('nav.primary')}>
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="rounded-full px-3 py-1.5 font-readout text-[11px] uppercase tracking-[0.16em] text-hud-dim transition-colors hover:bg-white/5 hover:text-hud"
            >
              {t(l.label)}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-3">
          <div className="hidden sm:block">{langToggle}</div>
          {user ? (
            <button
              type="button"
              onClick={() => signOut()}
              className="hidden rounded-full border border-white/10 px-3 py-1.5 font-readout text-[11px] uppercase tracking-[0.14em] text-hud-dim hover:text-hud sm:block"
            >
              Sign out
            </button>
          ) : (
            <Link
              href="/login"
              className="hidden rounded-full border border-accent/40 px-3 py-1.5 font-readout text-[11px] uppercase tracking-[0.14em] text-accent hover:bg-accent/10 sm:block"
            >
              {t('nav.signin')}
            </Link>
          )}
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-label={t('nav.menu')}
            className="grid size-9 place-items-center rounded-xl border border-white/10 bg-black/30 text-hud-dim lg:hidden"
          >
            {open ? <X className="size-4" /> : <Menu className="size-4" />}
          </button>
        </div>
      </div>

      {open && (
        <nav className="sky-glass mx-4 mb-2 p-2 lg:hidden" aria-label={`${t('nav.primary')} mobile`}>
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              onClick={() => setOpen(false)}
              className="block rounded-lg px-3 py-2 font-readout text-xs uppercase tracking-[0.16em] text-hud-dim hover:text-hud"
            >
              {t(l.label)}
            </Link>
          ))}
          <div className="mt-2 flex items-center justify-between border-t border-white/10 px-3 pt-3">
            {langToggle}
            {user ? (
              <button type="button" onClick={() => { signOut(); setOpen(false) }} className="font-readout text-xs text-hud-dim">
                Sign out
              </button>
            ) : (
              <Link href="/login" className="font-readout text-xs text-accent">{t('nav.signin')}</Link>
            )}
          </div>
        </nav>
      )}
    </header>
  )
}
