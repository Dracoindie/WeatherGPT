'use client'

/**
 * The ONE navigation bar, on every page (rendered by components/ui/AppShell).
 *
 * - The logo and the first link always lead back to the Living Sky home.
 * - The active page is highlighted (aria-current="page").
 * - Settings (role, lite mode, language) is a real panel, not a dead link.
 *   Language and role also sit in the bar on wide screens.
 * - Below lg the links move into the menu; BottomNav covers thumb reach.
 */

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Menu, Settings2, X } from 'lucide-react'
import { LiteToggle } from '@/components/common/LiteToggle'
import { OfflineMapPrep } from '@/components/common/OfflineMapPrep'
import { RoleSelector } from '@/components/common/RoleSelector'
import { cn } from '@/lib/utils'
import { LANGUAGE_LABELS, LANGUAGES, useI18n, type TranslationKey } from '@/context/I18nContext'
import { useAuthContext } from '@/context/AuthContext'
import { useDemoContext } from '@/context/DemoContext'

export const NAV_LINKS: { href: string; label: TranslationKey }[] = [
  { href: '/', label: 'nav.home' },
  { href: '/dashboard', label: 'nav.dashboard' },
  { href: '/map', label: 'nav.map' },
  { href: '/alerts', label: 'nav.alerts' },
  { href: '/climate', label: 'nav.climate' },
  { href: '/disaster', label: 'nav.disaster' },
]

export function isActive(href: string, pathname: string): boolean {
  return href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`)
}

export function SkyNav() {
  const { t, language, setLanguage } = useI18n()
  const { user, signOut } = useAuthContext()
  const { isDemo } = useDemoContext()
  const pathname = usePathname() ?? '/'
  const [open, setOpen] = useState(false)
  const [settings, setSettings] = useState(false)
  const settingsRef = useRef<HTMLDivElement>(null)

  // Close the settings panel on outside click / Escape.
  useEffect(() => {
    if (!settings) return
    const onDown = (e: MouseEvent) => {
      if (settingsRef.current && !settingsRef.current.contains(e.target as Node)) setSettings(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setSettings(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [settings])

  const langToggle = (
    <div className="flex items-center rounded-full border border-white/10 bg-black/30 p-0.5" role="group" aria-label={t('nav.language')}>
      {LANGUAGES.map((code) => (
        <button
          key={code}
          type="button"
          onClick={() => setLanguage(code)}
          aria-pressed={language === code}
          className={cn(
            'min-h-8 rounded-full px-2.5 py-1 font-readout text-[11px] transition-colors',
            language === code ? 'bg-accent text-black' : 'text-hud-dim hover:text-hud'
          )}
        >
          {LANGUAGE_LABELS[code]}
        </button>
      ))}
    </div>
  )

  const account = user ? (
    <button
      type="button"
      onClick={() => {
        signOut()
        setOpen(false)
      }}
      className="sky-btn sky-btn-subtle min-h-9 px-3"
    >
      {t('nav.signout')}
    </button>
  ) : (
    <Link href="/login" onClick={() => setOpen(false)} className="sky-btn sky-btn-ghost min-h-9 px-3">
      {t('nav.signin')}
    </Link>
  )

  const settingsBody = (
    <div className="space-y-3">
      <div>
        <p className="sky-label mb-1.5">{t('nav.language')}</p>
        {langToggle}
      </div>
      <div>
        <p className="sky-label mb-1.5">{t('nav.role')}</p>
        <RoleSelector />
      </div>
      <div>
        <p className="sky-label mb-1.5">{t('nav.lite')}</p>
        <LiteToggle />
      </div>
      <div>
        <p className="sky-label mb-1.5">{t('offlineMap.title')}</p>
        <OfflineMapPrep />
      </div>
    </div>
  )

  return (
    // Soft scrim keeps nav text readable over a bright clear-sky scene.
    <header className="relative z-40 bg-gradient-to-b from-black/45 via-black/15 to-transparent">
      <div className="mx-auto flex h-16 max-w-[1500px] items-center gap-4 px-4 sm:px-6">
        <Link href="/" className="group flex shrink-0 items-center gap-3">
          <span aria-hidden="true" className="relative grid size-9 place-items-center rounded-xl border border-accent/40 bg-black/40 shadow-[0_0_24px_-6px_var(--sky-accent)]">
            <span className="absolute inset-1.5 rounded-lg border border-accent/25" />
            <span className="font-hud text-sm font-bold text-accent-text">W</span>
          </span>
          <span className="leading-none">
            <span className="font-hud text-[17px] font-semibold tracking-tight text-hud">
              Weather<span className="text-accent-text">GPT</span>
            </span>
            <span className="mt-1 block font-readout text-[9px] uppercase tracking-[0.3em] text-hud-dim">SIH26068</span>
          </span>
        </Link>

        <nav className="ml-2 hidden items-center gap-0.5 lg:flex" aria-label={t('nav.primary')}>
          {NAV_LINKS.map((l) => {
            const active = isActive(l.href, pathname)
            return (
              <Link
                key={l.href}
                href={l.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'whitespace-nowrap rounded-full px-3 py-1.5 font-readout text-[11px] uppercase tracking-[0.14em] transition-colors',
                  active ? 'bg-accent/15 text-accent-text shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--sky-accent)_40%,transparent)]' : 'text-hud-dim hover:bg-white/5 hover:text-hud'
                )}
              >
                {t(l.label)}
              </Link>
            )
          })}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          {isDemo && (
            <span className="rounded-full border border-sev-watch/50 bg-sev-watch/10 px-2 py-1 font-readout text-[10px] uppercase tracking-[0.16em] text-sev-watch-text">
              {t('nav.demo')}
            </span>
          )}
          <RoleSelector className="hidden xl:flex" />
          <div className="hidden sm:block">{langToggle}</div>

          <div ref={settingsRef} className="relative hidden lg:block">
            <button
              type="button"
              onClick={() => setSettings((v) => !v)}
              aria-expanded={settings}
              aria-label={t('nav.settings')}
              className={cn(
                'grid size-9 place-items-center rounded-full border border-white/10 bg-black/30 text-hud-dim hover:text-hud',
                settings && 'border-accent/50 text-accent-text'
              )}
            >
              <Settings2 className="size-4" />
            </button>
            {settings && (
              <div role="dialog" aria-label={t('nav.settings')} className="sky-glass sky-popover absolute right-0 top-11 w-72 p-4">
                {settingsBody}
              </div>
            )}
          </div>

          <div className="hidden sm:block">{account}</div>
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
          {NAV_LINKS.map((l) => {
            const active = isActive(l.href, pathname)
            return (
              <Link
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'block rounded-lg px-3 py-2.5 font-readout text-xs uppercase tracking-[0.16em]',
                  active ? 'bg-accent/15 text-accent-text' : 'text-hud-dim hover:text-hud'
                )}
              >
                {t(l.label)}
              </Link>
            )
          })}
          <div className="mt-2 space-y-3 border-t border-white/10 px-3 pb-2 pt-3">
            <p className="sky-label">{t('nav.settings')}</p>
            {settingsBody}
            <div className="pt-1">{account}</div>
          </div>
        </nav>
      )}
    </header>
  )
}
