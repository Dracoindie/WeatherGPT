'use client'

import { useState, useEffect } from 'react'
import AuthGuard from '@/components/auth/AuthGuard'
import { TopNav } from '@/components/layout/TopNav'
import LocationPicker, { type LocationData } from '@/components/location/LocationPicker'
import { ClimatePanel } from '@/components/weather/ClimatePanel'
import { TrustStrip } from '@/components/common/TrustStrip'
import { fetchClimate } from '@/lib/api/climate'
import type { ClimateResponse } from '@/types/climate'
import { ChartNoAxesColumnIncreasing, History } from 'lucide-react'

export default function ClimatePage() {
  const [location, setLocation] = useState<LocationData | null>(null)
  const [climateData, setClimateData] = useState<ClimateResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Load climate when location changes or default to Pune on mount
  useEffect(() => {
    let active = true
    const lat = location ? location.latitude : 18.5204
    const lon = location ? location.longitude : 73.8567

    const runFetch = async () => {
      await Promise.resolve()
      if (!active) return
      setLoading(true)
      setError(null)
      try {
        const data = await fetchClimate(lat, lon)
        if (active) setClimateData(data)
      } catch (err: unknown) {
        if (active) {
          setError(err instanceof Error ? err.message : 'Failed to fetch historical climate data.')
          setClimateData(null)
        }
      } finally {
        if (active) setLoading(false)
      }
    }

    runFetch()

    return () => {
      active = false
    }
  }, [location])

  function handleLocationSelected(loc: LocationData) {
    setLocation(loc)
  }

  return (
    <AuthGuard>
      <div className="min-h-screen bg-canvas flex flex-col">
        <TopNav />

        <main className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6 lg:py-8 flex-grow w-full">
          <div className="mb-6 flex flex-col justify-between gap-4 border-b border-line pb-6 sm:flex-row sm:items-end">
            <div>
              <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.2em] text-teal">
                <History className="size-3.5" />
                Open-Meteo Historical Archive
              </div>
              <h1 className="mt-2 font-display text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
                Climate & Historical Weather Analysis
              </h1>
              <p className="mt-1 text-xs text-ink-soft">
                Scientific historical meteorological records, temperature trends, and precipitation totals over the past 30 days from Open-Meteo Historical API.
              </p>
            </div>
            <LocationPicker
              onLocationSelected={handleLocationSelected}
              defaultLocation={location}
            />
          </div>

          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
            <section aria-label="Climate analysis panel">
              <ClimatePanel
                data={climateData}
                loading={loading}
                error={error}
                locationName={location?.name}
              />
            </section>

            <aside className="space-y-5">
              <div className="rounded-[16px] border border-line bg-panel p-5">
                <div className="flex items-center gap-2 font-display text-sm font-semibold text-ink">
                  <ChartNoAxesColumnIncreasing className="size-4 text-teal" />
                  Meteorological Grounding
                </div>
                <p className="mt-2 text-xs leading-relaxed text-ink-soft">
                  Historical archive data is fetched directly from the Open-Meteo Historical API.
                </p>
                <div className="mt-4 border-t border-line/60 pt-3 text-[11px] font-mono text-ink-soft space-y-1.5">
                  <div>• 30-Day Moving Baseline</div>
                  <div>• Daily Max / Min Temperatures</div>
                  <div>• Cumulative Precipitation</div>
                  <div>• Two-Period Trend Analysis</div>
                </div>
              </div>

              <TrustStrip />
            </aside>
          </div>
        </main>
      </div>
    </AuthGuard>
  )
}
