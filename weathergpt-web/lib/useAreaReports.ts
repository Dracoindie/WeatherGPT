'use client'

/**
 * Live community reports near a set of places (the risk board's districts):
 * one GET /api/reports for the box around them, then each place's reports
 * within RADIUS_KM. Community reports are unverified and never change a
 * district's level (docs/REPORTS.md). Low-trust reports are only counted
 * (hiddenByPlace), as on the map, where they can be shown.
 */

import { useEffect, useMemo, useState } from 'react'
import { fetchReports, hiddenByDefault, MAX_BOX_DEG, ReportError, type Report, type ReportErrorCode } from '@/lib/api/reports'

export const RADIUS_KM = 25
const PAD_DEG = 0.3

export function km(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r = 6371
  const p1 = (lat1 * Math.PI) / 180
  const p2 = (lat2 * Math.PI) / 180
  const dp = p2 - p1
  const dl = ((lon2 - lon1) * Math.PI) / 180
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2
  return 2 * r * Math.asin(Math.sqrt(a))
}

export function useAreaReports(places: Array<{ name: string; latitude: number; longitude: number }>, refreshKey = 0) {
  const [reports, setReports] = useState<Report[]>([])
  const [error, setError] = useState<ReportErrorCode | null>(null)

  // one request for the box around every place (skipped when it is wider than the API allows)
  const box = useMemo(() => {
    if (places.length === 0) return null
    const lats = places.map((p) => p.latitude)
    const lons = places.map((p) => p.longitude)
    const b = {
      south: Math.min(...lats) - PAD_DEG,
      north: Math.max(...lats) + PAD_DEG,
      west: Math.min(...lons) - PAD_DEG,
      east: Math.max(...lons) + PAD_DEG,
    }
    return b.north - b.south > MAX_BOX_DEG || b.east - b.west > MAX_BOX_DEG ? null : b
  }, [places])
  const key = box ? `${box.south.toFixed(2)},${box.west.toFixed(2)},${box.north.toFixed(2)},${box.east.toFixed(2)}` : ''

  useEffect(() => {
    if (!box) return
    const ctrl = new AbortController()
    const id = window.setTimeout(() => {
      fetchReports(box, null, ctrl.signal)
        .then((r) => {
          setReports(r.reports)
          setError(null)
        })
        .catch((err: unknown) => {
          if (err instanceof DOMException && err.name === 'AbortError') return
          setError(err instanceof ReportError ? err.code : 'unavailable')
        })
    }, 300)
    return () => {
      window.clearTimeout(id)
      ctrl.abort()
    }
    // the box is captured by its rounded key
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, refreshKey])

  const { byPlace, hiddenByPlace } = useMemo(() => {
    const byPlace: Record<string, Report[]> = {}
    const hiddenByPlace: Record<string, number> = {}
    for (const p of places) {
      const near = reports.filter((r) => km(p.latitude, p.longitude, r.latitude, r.longitude) <= RADIUS_KM)
      byPlace[p.name] = near.filter((r) => !hiddenByDefault(r))
      hiddenByPlace[p.name] = near.length - byPlace[p.name].length
    }
    return { byPlace, hiddenByPlace }
  }, [places, reports])

  return { byPlace, hiddenByPlace, error }
}
