'use client'

import { WifiOff } from 'lucide-react'
import { AppShell } from '@/components/ui/AppShell'
import { GlassPanel } from '@/components/panels/GlassPanel'
import { SkyLinkButton } from '@/components/ui/SkyButton'
import { useI18n } from '@/context/I18nContext'

/** Fallback page the service worker serves when a page was never cached. */
export default function OfflinePage() {
  const { t } = useI18n()
  return (
    <AppShell mainClassName="flex items-center justify-center py-10">
      <GlassPanel wet={false} className="w-full max-w-md p-8 text-center">
        <WifiOff className="mx-auto size-10 text-sev-watch-text" aria-hidden="true" />
        <h1 className="mt-4 font-hud text-2xl font-bold text-hud">{t('offline.title')}</h1>
        <p className="mt-2 text-sm text-hud-dim">{t('offline.body')}</p>
        <SkyLinkButton href="/" variant="ghost" className="mt-6">
          {t('offline.open')}
        </SkyLinkButton>
      </GlassPanel>
    </AppShell>
  )
}
