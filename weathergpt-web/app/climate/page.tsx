'use client'

/**
 * /climate: the last 30 days from the Open-Meteo archive for a picked place.
 * Nothing loads until a place is picked (no hard-coded coordinates).
 */

import { useCallback, useState } from 'react'
import { History, Info } from 'lucide-react'
import AuthGuard from '@/components/auth/AuthGuard'
import { TrustStrip } from '@/components/common/TrustStrip'
import { askHref } from '@/components/console/AskCard'
import LocationPicker, { type LocationData } from '@/components/location/LocationPicker'
import { GlassPanel } from '@/components/panels/GlassPanel'
import { AppShell } from '@/components/ui/AppShell'
import { PageHeader } from '@/components/ui/PageHeader'
import { SkyLinkButton } from '@/components/ui/SkyButton'
import { ClimatePanel } from '@/components/weather/ClimatePanel'
import { fill, useI18n } from '@/context/I18nContext'
import { fetchClimate } from '@/lib/api/climate'
import type { ClimateResponse } from '@/types/climate'

export default function ClimatePage() {
  const { t } = useI18n()
  const [location, setLocation] = useState<LocationData | null>(null)
  const [data, setData] = useState<ClimateResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const select = useCallback(async (loc: LocationData) => {
    setLocation(loc)
    setLoading(true)
    setError(null)
    try {
      setData(await fetchClimate(loc.latitude, loc.longitude))
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to fetch historical climate data.')
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [])

  const place = location?.name.split(',')[0]

  return (
    <AppShell>
      <AuthGuard>
        <PageHeader
          eyebrow={t('climate.eyebrow')}
          icon={<History className="size-3.5" />}
          title={place ? `${t('climate.title')} · ${place}` : t('climate.title')}
          description={t('climate.intro')}
          actions={<LocationPicker onLocationSelected={select} defaultLocation={location} />}
        />

        {!location ? (
          <div className="sky-glass p-8 text-center text-sm text-hud-dim">{t('climate.pick')}</div>
        ) : (
          <div className="space-y-5">
            <ClimatePanel data={data} loading={loading} error={error} />
            <GlassPanel wet={false} label={t('climate.about')} aside={<Info className="size-3.5 text-accent-text" />}>
              <ul className="grid gap-2 text-sm text-hud-dim md:grid-cols-3">
                <li>{t('climate.about1')}</li>
                <li>{t('climate.about2')}</li>
                <li>{t('climate.about3')}</li>
              </ul>
              <SkyLinkButton href={askHref(fill(t('ask.q.climate'), { place: place ?? '' }), location)} variant="ghost" className="mt-4">
                {t('ask.open')}
              </SkyLinkButton>
            </GlassPanel>
            <TrustStrip />
          </div>
        )}
      </AuthGuard>
    </AppShell>
  )
}
