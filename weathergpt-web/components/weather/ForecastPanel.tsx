"use client";

import { useEffect } from 'react';
import type { DataState, WeatherResponse } from '@/components/weather/forecastTypes';

/** "Sun, 1 Nov" for an ISO date, without a timezone shift. */
function dayLabel(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}

/**
 * Simple forecast panel displaying a list of forecast days.
 * Handles loading / error / empty states based on the DataState.
 */
export function ForecastPanel({ state }: { state: DataState<WeatherResponse> }) {
  const { status, data, error } = state;

  useEffect(() => {
    // No side‑effects needed; placeholder for potential future logic.
  }, []);

  if (status === 'loading') {
    return (
      <div className="rounded-[12px] border border-line bg-panel p-4 text-center text-sm text-ink-soft">
        Loading forecast…
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="rounded-[12px] border border-coral/30 bg-coral-soft p-4 text-sm text-coral">
        Forecast error: {error ?? 'unknown'}
      </div>
    );
  }

  if (!data || !data.forecast || data.forecast.length === 0) {
    return (
      <div className="rounded-[12px] border border-line bg-panel p-4 text-center text-sm text-ink-soft">
        No forecast data available.
      </div>
    );
  }

  return (
    // Compact day cards: 2 columns on phones and tablets, 1 in the narrow
    // dashboard sidebar (lg+). No horizontal scroller: it widened the mobile
    // layout viewport in Chrome.
    <ul className="grid grid-cols-2 gap-2 lg:grid-cols-1">
      {data.forecast.map((day) => (
        <li key={day.date} className="min-w-0 rounded-[12px] border border-line bg-panel p-3">
          <div className="flex flex-wrap items-baseline justify-between gap-x-2">
            <span className="font-medium text-ink">{dayLabel(day.date)}</span>
            <span className="font-mono text-sm text-ink">
              {day.temperatureMaxC}° <span className="text-ink-soft">/ {day.temperatureMinC}°</span>
            </span>
          </div>
          <div className="mt-0.5 truncate text-xs text-ink-soft">{day.condition}</div>
          <dl className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-[11px] text-ink-soft">
            <div>
              <dt className="sr-only">Rain chance</dt>
              <dd>{day.precipitationProbability}%</dd>
            </div>
            <div>
              <dt className="sr-only">Precipitation</dt>
              <dd>{day.precipitationMm} mm</dd>
            </div>
            <div>
              <dt className="sr-only">Wind</dt>
              <dd>{day.windSpeedKmh} km/h</dd>
            </div>
          </dl>
        </li>
      ))}
    </ul>
  );
}
