'use client'

import { UserRound } from 'lucide-react'
import { useI18n } from '@/context/I18nContext'
import { ROLE_LABELS, ROLES, useRole, type UserRole } from '@/lib/role'
import { cn } from '@/lib/utils'

/** Role mode picker; `tone` matches the sky (dark) or panel (light) nav. */
export function RoleSelector({ tone = 'sky', className }: { tone?: 'sky' | 'light'; className?: string }) {
  const { role, setRole } = useRole()
  const { language } = useI18n()
  return (
    <label
      className={cn(
        'flex min-h-9 items-center gap-1.5 rounded-full border px-2.5',
        tone === 'sky' ? 'border-white/10 bg-black/30 text-hud-dim' : 'border-line bg-panel text-ink-soft',
        className
      )}
    >
      <UserRound className="size-3.5 shrink-0" aria-hidden="true" />
      <span className="sr-only">Role</span>
      <select
        value={role}
        onChange={(e) => setRole(e.target.value as UserRole)}
        aria-label="Role"
        className={cn(
          'cursor-pointer bg-transparent py-1 text-[12px] outline-none',
          tone === 'sky' ? 'text-hud [&>option]:bg-[#0b1220]' : 'text-ink'
        )}
      >
        {ROLES.map((r) => (
          <option key={r} value={r}>
            {ROLE_LABELS[r][language]}
          </option>
        ))}
      </select>
    </label>
  )
}
