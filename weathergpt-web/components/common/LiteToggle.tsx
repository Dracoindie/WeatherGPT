'use client'

import { Feather } from 'lucide-react'
import { setLitePref, useLiteMode, type LiteReason } from '@/lib/liteMode'
import { cn } from '@/lib/utils'

const REASON: Record<Exclude<LiteReason, null>, string> = {
  'save-data': 'Data Saver is on',
  'slow-connection': 'slow connection',
  'low-end-device': 'low-power device',
  'software-renderer': 'no graphics acceleration',
}

/** Lite mode switch: shows the effective state; auto-detection explains itself. */
export function LiteToggle({ className }: { className?: string }) {
  const { lite, pref, reason } = useLiteMode()
  const why =
    pref === 'auto'
      ? reason
        ? `Lite mode on automatically (${REASON[reason]}). Tap to show the animated sky.`
        : 'Lite mode off. Tap to use a static sky and save battery and data.'
      : lite
        ? 'Lite mode on. Tap to show the animated sky.'
        : 'Animated sky on. Tap for lite mode.'

  return (
    <button
      type="button"
      onClick={() => setLitePref(lite ? 'off' : 'on')}
      aria-pressed={lite}
      title={why}
      aria-label={`Lite mode${pref === 'auto' && reason ? ' (auto)' : ''}`}
      className={cn(
        'flex min-h-9 items-center gap-1.5 rounded-full border px-2.5 py-1 font-readout text-[11px] uppercase tracking-[0.14em] transition-colors',
        lite ? 'border-accent/60 bg-accent/15 text-accent-text' : 'border-white/10 bg-black/30 text-hud-dim hover:text-hud',
        className
      )}
    >
      <Feather className="size-3.5" />
      Lite
      {pref === 'auto' && reason && <span className="text-[9px] opacity-70">auto</span>}
    </button>
  )
}
