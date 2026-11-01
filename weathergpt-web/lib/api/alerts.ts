import type { AlertsResponse } from '@/types/alerts';
import { API_BASE } from '@/lib/api/base';

export async function fetchAlerts(params: {
  latitude: number;
  longitude: number;
}): Promise<AlertsResponse> {
  const url = new URL(`${API_BASE}/api/alerts`);
  url.searchParams.set('latitude', String(params.latitude));
  url.searchParams.set('longitude', String(params.longitude));

  const resp = await fetch(url.toString());
  if (!resp.ok) {
    throw new Error(`Alerts API error: ${resp.status}`);
  }
  const data: AlertsResponse = await resp.json();
  return data;
}
