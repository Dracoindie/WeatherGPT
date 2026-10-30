'use client'

import React, { useMemo } from 'react'
import type { ClimateResponse } from '@/types/climate'
import { Calendar, TrendingUp, CloudRain, Thermometer, Info } from 'lucide-react'

interface ClimatePanelProps {
  data: ClimateResponse | null
  loading: boolean
  error: string | null
  locationName?: string
}

export function ClimatePanel({
  data,
  loading,
  error,
  locationName,
}: ClimatePanelProps) {
  // Compute basic statistical aggregates and trend comparisons
  const summary = useMemo(() => {
    if (!data || !data.daily || data.daily.length === 0) return null

    const validTempsMax = data.daily
      .map((d) => d.temperature_max)
      .filter((v): v is number => typeof v === 'number' && !isNaN(v))

    const validTempsMin = data.daily
      .map((d) => d.temperature_min)
      .filter((v): v is number => typeof v === 'number' && !isNaN(v))

    const validPrecip = data.daily
      .map((d) => d.precipitation_sum)
      .filter((v): v is number => typeof v === 'number' && !isNaN(v))

    const avgMax = validTempsMax.length
      ? validTempsMax.reduce((a, b) => a + b, 0) / validTempsMax.length
      : null

    const avgMin = validTempsMin.length
      ? validTempsMin.reduce((a, b) => a + b, 0) / validTempsMin.length
      : null

    const peakMax = validTempsMax.length ? Math.max(...validTempsMax) : null
    const lowestMin = validTempsMin.length ? Math.min(...validTempsMin) : null
    const totalPrecip = validPrecip.reduce((a, b) => a + b, 0)
    const rainyDays = validPrecip.filter((p) => p > 0.1).length

    // Period Comparison (First Half vs Second Half of the retrieved window)
    const midpoint = Math.floor(data.daily.length / 2)
    let firstHalfAvgMax: number | null = null
    let secondHalfAvgMax: number | null = null
    let tempTrendDiff: number | null = null

    if (midpoint > 0) {
      const firstHalfMax = data.daily
        .slice(0, midpoint)
        .map((d) => d.temperature_max)
        .filter((v): v is number => typeof v === 'number' && !isNaN(v))

      const secondHalfMax = data.daily
        .slice(midpoint)
        .map((d) => d.temperature_max)
        .filter((v): v is number => typeof v === 'number' && !isNaN(v))

      if (firstHalfMax.length && secondHalfMax.length) {
        firstHalfAvgMax = firstHalfMax.reduce((a, b) => a + b, 0) / firstHalfMax.length
        secondHalfAvgMax = secondHalfMax.reduce((a, b) => a + b, 0) / secondHalfMax.length
        tempTrendDiff = secondHalfAvgMax - firstHalfAvgMax
      }
    }

    return {
      daysCount: data.daily.length,
      avgMax,
      avgMin,
      peakMax,
      lowestMin,
      totalPrecip,
      rainyDays,
      firstHalfAvgMax,
      secondHalfAvgMax,
      tempTrendDiff,
    }
  }, [data])

  if (loading) {
    return (
      <div className="rounded-[16px] border border-line bg-panel p-8 text-center">
        <div className="mx-auto size-8 animate-spin rounded-full border-2 border-teal border-t-transparent" />
        <p className="mt-3 font-mono text-xs uppercase tracking-widest text-ink-soft">
          Fetching verified historical archive data…
        </p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-[16px] border border-coral/30 bg-coral-soft p-5 text-sm text-coral">
        <div className="flex items-center gap-2 font-medium">
          <Info className="size-4 shrink-0" />
          <span>Historical climate data unavailable</span>
        </div>
        <p className="mt-1 text-xs opacity-90">{error}</p>
      </div>
    )
  }

  if (!data || !data.daily || data.daily.length === 0) {
    return (
      <div className="rounded-[16px] border border-line bg-panel p-8 text-center text-ink-soft">
        <Calendar className="mx-auto size-8 text-ink-soft mb-2" />
        <p className="text-sm">No historical climate records found for this location and time range.</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Top Aggregates Summary */}
      {summary && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-[14px] border border-line bg-panel p-4">
            <div className="flex items-center gap-2 text-teal">
              <Thermometer className="size-4" />
              <span className="font-mono text-[11px] uppercase tracking-wider">Avg Maximum</span>
            </div>
            <p className="mt-2 font-display text-2xl font-bold text-ink">
              {summary.avgMax !== null ? `${summary.avgMax.toFixed(1)}°C` : 'N/A'}
            </p>
            <p className="mt-1 text-[11px] text-ink-soft">
              Peak: {summary.peakMax !== null ? `${summary.peakMax.toFixed(1)}°C` : 'N/A'}
            </p>
          </div>

          <div className="rounded-[14px] border border-line bg-panel p-4">
            <div className="flex items-center gap-2 text-teal">
              <Thermometer className="size-4" />
              <span className="font-mono text-[11px] uppercase tracking-wider">Avg Minimum</span>
            </div>
            <p className="mt-2 font-display text-2xl font-bold text-ink">
              {summary.avgMin !== null ? `${summary.avgMin.toFixed(1)}°C` : 'N/A'}
            </p>
            <p className="mt-1 text-[11px] text-ink-soft">
              Lowest: {summary.lowestMin !== null ? `${summary.lowestMin.toFixed(1)}°C` : 'N/A'}
            </p>
          </div>

          <div className="rounded-[14px] border border-line bg-panel p-4">
            <div className="flex items-center gap-2 text-teal">
              <CloudRain className="size-4" />
              <span className="font-mono text-[11px] uppercase tracking-wider">Total Rainfall</span>
            </div>
            <p className="mt-2 font-display text-2xl font-bold text-ink">
              {summary.totalPrecip.toFixed(1)} mm
            </p>
            <p className="mt-1 text-[11px] text-ink-soft">
              {summary.rainyDays} rainy days observed
            </p>
          </div>

          <div className="rounded-[14px] border border-line bg-panel p-4">
            <div className="flex items-center gap-2 text-teal">
              <TrendingUp className="size-4" />
              <span className="font-mono text-[11px] uppercase tracking-wider">Period Shift</span>
            </div>
            <p className="mt-2 font-display text-2xl font-bold text-ink">
              {summary.tempTrendDiff !== null
                ? `${summary.tempTrendDiff > 0 ? '+' : ''}${summary.tempTrendDiff.toFixed(1)}°C`
                : 'N/A'}
            </p>
            <p className="mt-1 text-[11px] text-ink-soft">
              {summary.tempTrendDiff !== null
                ? summary.tempTrendDiff > 0
                  ? 'Warming trend between periods'
                  : 'Cooling trend between periods'
                : 'Insufficient period span'}
            </p>
          </div>
        </div>
      )}

      {/* Historical Data Table */}
      <div className="rounded-[16px] border border-line bg-panel p-5 overflow-hidden">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="font-display text-base font-semibold text-ink">
              Daily Meteorological Observations {locationName ? `for ${locationName}` : ''}
            </h2>
            <p className="text-xs text-ink-soft mt-0.5">
              Source: Open-Meteo Historical API ({data.daily.length} days recorded)
            </p>
          </div>
          <span className="font-mono text-[11px] text-ink-soft">
            TZ: {data.timezone} | Source: {data.source}
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-line text-ink-soft font-mono uppercase text-[10px]">
                <th className="py-2 px-3">Date</th>
                <th className="py-2 px-3 text-right">Max Temp (°C)</th>
                <th className="py-2 px-3 text-right">Min Temp (°C)</th>
                <th className="py-2 px-3 text-right">Precipitation (mm)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/30 font-body">
              {data.daily.map((record) => (
                <tr key={record.date} className="hover:bg-canvas/40 transition-colors">
                  <td className="py-2.5 px-3 font-mono font-medium text-ink">{record.date}</td>
                  <td className="py-2.5 px-3 text-right font-mono text-ink">
                    {record.temperature_max !== null && record.temperature_max !== undefined
                      ? `${record.temperature_max.toFixed(1)}°C`
                      : '—'}
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono text-ink">
                    {record.temperature_min !== null && record.temperature_min !== undefined
                      ? `${record.temperature_min.toFixed(1)}°C`
                      : '—'}
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono text-ink">
                    {record.precipitation_sum !== null && record.precipitation_sum !== undefined
                      ? `${record.precipitation_sum.toFixed(1)} mm`
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
