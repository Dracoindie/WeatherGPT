"use client";

import { useEffect } from 'react';
import type { DataState, WeatherResponse } from '@/components/weather/forecastTypes';

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
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {data.forecast.map((day) => (
        <div key={day.date} className="rounded-[12px] border border-line bg-panel p-3">
          <div className="font-medium text-ink">{day.date}</div>
          <div className="text-sm text-ink-soft">
            <div>High: {day.temperatureMaxC}°C</div>
            <div>Low: {day.temperatureMinC}°C</div>
            <div>Precip: {day.precipitationMm} mm</div>
            <div>Prob: {day.precipitationProbability}%</div>
            <div>Wind: {day.windSpeedKmh} km/h</div>
            <div>Cond: {day.condition}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
