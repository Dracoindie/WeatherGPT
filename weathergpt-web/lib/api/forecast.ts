import { apiFetch } from '@/lib/replay'
import type { ForecastResponse } from '@/components/weather/forecastTypes';
import { API_BASE } from '@/lib/api/base';

export async function fetchForecast(params: {
  latitude: number;
  longitude: number;
  days?: number;
}): Promise<ForecastResponse> {
  const url = new URL(`${API_BASE}/api/forecast`);
  url.searchParams.set('latitude', String(params.latitude));
  url.searchParams.set('longitude', String(params.longitude));
  // the 7-day panel; demo fixtures are recorded with the same days=7 (record_demo_fixtures.py)
  url.searchParams.set('days', String(params.days ?? 7));
  const resp = await apiFetch(url.toString());
  if (!resp.ok) {
    throw new Error(`Forecast API error: ${resp.status}`);
  }
  const data: ForecastResponse = await resp.json();
  return data;
}
