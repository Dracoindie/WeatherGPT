import type { ForecastResponse } from '@/components/weather/forecastTypes';

export async function fetchForecast(params: {
  latitude: number;
  longitude: number;
  days?: number;
}): Promise<ForecastResponse> {
  const base =
    process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, '') ?? 'http://localhost:8000';
  const url = new URL(`${base}/api/forecast`);
  url.searchParams.set('latitude', String(params.latitude));
  url.searchParams.set('longitude', String(params.longitude));
  url.searchParams.set('days', String(params.days ?? 5));
  const resp = await fetch(url.toString());
  if (!resp.ok) {
    throw new Error(`Forecast API error: ${resp.status}`);
  }
  const data: ForecastResponse = await resp.json();
  return data;
}
