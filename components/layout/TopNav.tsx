'use client'

/**
 * TopNav — adapted from Lovable's TopNav.tsx.
 * TanStack Router <Link> replaced with Next.js <Link>.
 * Wired to useI18n and useAuthContext.
 */

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Menu, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { LANGUAGE_LABELS, LANGUAGES, useI18n } from '@/context/I18nContext'
import { useAuthContext } from '@/context/AuthContext'
import { useDemoContext } from '@/context/DemoContext'

const links: { href: string; label: string }[] = [
  { href: '/dashboard', label: 'nav.dashboard' },
  { href: '/map', label: 'nav.map' },
  { href: '/alerts', label: 'nav.alerts' },
  { href: '/climate', label: 'nav.climate' },
  { href: '#settings', label: 'nav.settings' },
]

export function TopNav() {
  const { t, language, setLanguage } = useI18n()
  const { user, signOut } = useAuthContext()
  const { isDemo } = useDemoContext()
  const pathname = usePathname()
  const [open, setOpen] = useState(false)

  const initials = user?.user_metadata?.full_name
    ? user.user_metadata.full_name
        .split(' ')
        .slice(0, 2)
        .map((n: string) => n[0])
        .join('')
        .toUpperCase()
    : user?.email?.slice(0, 2).toUpperCase() ?? '??'

  return (
    <header className="sticky top-0 z-30 border-b border-line/70 bg-canvas/85 backdrop-blur-sm">
      <div className="mx-auto flex h-14 max-w-[1400px] items-center gap-6 px-4 sm:px-6">
        <Link href="/dashboard" className="flex items-center gap-2.5" aria-label="WeatherGPT home">
          <span className="grid size-8 place-items-center rounded-[9px] bg-ink">
            <span className="font-mono text-[13px] font-medium tracking-tight text-panel">W</span>
          </span>
          <span className="leading-none">
            <span className="font-display text-[15px] font-semibold tracking-tight">WeatherGPT</span>
            <span className="ml-2 hidden font-mono text-[10px] uppercase tracking-[0.18em] text-fog sm:inline">
              {t('brand.tag')}
            </span>
          </span>
        </Link>

        <nav className="ml-2 hidden items-center gap-1 lg:flex" aria-label={t('nav.primary')}>
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={cn(
                'relative rounded-md px-3 py-1.5 text-sm font-medium text-ink-soft transition-colors hover:text-ink',
                (l.href === '/dashboard' && pathname === l.href) && 'bg-teal-soft text-teal'
              )}
            >
              {t(l.label as Parameters<typeof t>[0])}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-3">
          {isDemo && (
            <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-1 font-mono text-[10px] font-semibold uppercase tracking-wide text-amber-800 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-200">
              Demo Mode
            </span>
          )}

          {/* Language toggle */}
          <div
            className="hidden items-center gap-1 rounded-md border border-line/80 bg-panel p-0.5 sm:flex"
            role="group"
            aria-label="Language"
          >
            {LANGUAGES.map((code) => (
              <button
                key={code}
                type="button"
                onClick={() => setLanguage(code)}
                aria-pressed={language === code}
                className={cn(
                  'rounded px-2 py-1 text-xs font-medium transition-colors',
                  language === code ? 'bg-ink text-panel' : 'text-ink-soft hover:text-ink'
                )}
              >
                {LANGUAGE_LABELS[code]}
              </button>
            ))}
          </div>

          {/* Avatar / profile */}
          {user && (
            <span
              className="grid size-8 place-items-center rounded-full bg-teal-soft font-display text-xs font-semibold text-teal"
              aria-label="Profile"
            >
              {initials}
            </span>
          )}

          {/* Sign out */}
          {user && (
            <button
              type="button"
              onClick={() => signOut()}
              className="hidden rounded-md px-3 py-1.5 text-xs font-medium text-ink-soft hover:text-ink sm:block"
            >
              Sign out
            </button>
          )}

          {/* Hamburger */}
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-label={t('nav.menu')}
            className="grid size-8 place-items-center rounded-md border border-line/80 bg-panel text-ink-soft lg:hidden"
          >
            {open ? <X className="size-4" /> : <Menu className="size-4" />}
          </button>
        </div>
      </div>

      {open && (
        <nav
          className="border-t border-line bg-panel px-4 py-2 lg:hidden"
          aria-label={`${t('nav.primary')} mobile`}
        >
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              onClick={() => setOpen(false)}
              className={cn(
                'block rounded-md px-3 py-2 text-sm font-medium text-ink-soft',
                (l.href === '/dashboard' && pathname === l.href) && 'bg-teal-soft text-teal'
              )}
            >
              {t(l.label as Parameters<typeof t>[0])}
            </Link>
          ))}
          {user && (
            <button
              type="button"
              onClick={() => { signOut(); setOpen(false) }}
              className="block rounded-md px-3 py-2 text-sm font-medium text-ink-soft"
            >
              Sign out
            </button>
          )}
          <div className="mt-2 flex gap-1 border-t border-line pt-2">
            {LANGUAGES.map((code) => (
              <button
                key={code}
                type="button"
                onClick={() => setLanguage(code)}
                aria-pressed={language === code}
                className={cn(
                  'rounded px-2.5 py-1 text-xs font-medium',
                  language === code ? 'bg-ink text-panel' : 'text-ink-soft'
                )}
              >
                {LANGUAGE_LABELS[code]}
              </button>
            ))}
          </div>
        </nav>
      )}
    </header>
  )
}
