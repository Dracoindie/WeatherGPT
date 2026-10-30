import type { AlertsResponse } from '@/types/alerts';

export async function fetchAlerts(params: {
  latitude: number;
  longitude: number;
}): Promise<AlertsResponse> {
  const base =
    process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, '') ?? 'http://localhost:8000';
  const url = new URL(`${base}/api/alerts`);
  url.searchParams.set('latitude', String(params.latitude));
  url.searchParams.set('longitude', String(params.longitude));

  const resp = await fetch(url.toString());
  if (!resp.ok) {
    throw new Error(`Alerts API error: ${resp.status}`);
  }
  const data: AlertsResponse = await resp.json();
  return data;
}
