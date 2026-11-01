'use client'

/**
 * Mobile bottom navigation (below the lg breakpoint): thumb-reachable 44 px+
 * targets, safe-area aware, the same dark glass on every page. Same links as
 * SkyNav (NAV_LINKS). Hidden on the sign-in and offline pages.
 */

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { BellRing, ChartLine, CloudSun, LayoutDashboard, Map as MapIcon, ShieldAlert } from 'lucide-react'
import { isActive } from '@/components/console/SkyNav'
import { useI18n, type TranslationKey } from '@/context/I18nContext'
import { cn } from '@/lib/utils'

const ITEMS: { href: string; label: TranslationKey; Icon: typeof CloudSun }[] = [
  { href: '/', label: 'nav.home', Icon: CloudSun },
  { href: '/dashboard', label: 'nav.dashboard', Icon: LayoutDashboard },
  { href: '/map', label: 'nav.map', Icon: MapIcon },
  { href: '/alerts', label: 'nav.alerts', Icon: BellRing },
  { href: '/climate', label: 'nav.climate', Icon: ChartLine },
  { href: '/disaster', label: 'nav.disaster', Icon: ShieldAlert },
]

const HIDDEN = new Set(['/login', '/signup', '/offline'])

/** Height of the bar, for content that must sit above it. */
export const BOTTOM_NAV_HEIGHT = 'calc(4rem + env(safe-area-inset-bottom))'

export function BottomNav() {
  const pathname = usePathname()
  const { t } = useI18n()
  if (HIDDEN.has(pathname)) return null

  return (
    <>
      <nav
        aria-label="Bottom navigation"
        className={cn(
          'fixed inset-x-0 bottom-0 z-50 border-t pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden',
          'border-white/10 bg-[#040811]/85'
        )}
      >
        <ul className="mx-auto grid h-16 max-w-lg grid-cols-6">
          {ITEMS.map(({ href, label, Icon }) => {
            const active = isActive(href, pathname)
            return (
              <li key={href}>
                <Link
                  href={href}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'flex h-full flex-col items-center justify-center gap-1 text-[10px] font-medium transition-colors',
                    active ? 'text-[var(--sky-accent,#22d3ee)]' : 'text-white/60 hover:text-white'
                  )}
                >
                  <Icon className="size-5" />
                  <span className="max-w-full truncate px-1">{t(label)}</span>
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>
    </>
  )
}
