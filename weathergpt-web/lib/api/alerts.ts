import type { AlertsResponse } from '@/types/alerts';
import { API_BASE } from '@/lib/api/base';

export const ALERTS_UNAVAILABLE_MESSAGE =
  'Weather alerts are temporarily unavailable — the weather service is not responding. Please try again in a minute.';

/** Alerts could not be evaluated (backend unreachable or upstream weather service down). */
export class AlertsUnavailableError extends Error {
  status: number;

  constructor(status: number, message = ALERTS_UNAVAILABLE_MESSAGE) {
    super(message);
    this.name = 'AlertsUnavailableError';
    this.status = status;
  }
}

export async function fetchAlerts(params: {
  latitude: number;
  longitude: number;
}): Promise<AlertsResponse> {
  const url = new URL(`${API_BASE}/api/alerts`);
  url.searchParams.set('latitude', String(params.latitude));
  url.searchParams.set('longitude', String(params.longitude));

  let resp: Response;
  try {
    resp = await fetch(url.toString());
  } catch {
    throw new AlertsUnavailableError(0, 'Could not reach the WeatherGPT backend, so alerts are unavailable.');
  }
  if (!resp.ok) {
    let detail: string | undefined;
    try {
      const body = (await resp.json()) as { detail?: unknown };
      if (typeof body.detail === 'string') detail = body.detail;
    } catch {
      // keep the generic message
    }
    throw new AlertsUnavailableError(resp.status, resp.status >= 500 ? ALERTS_UNAVAILABLE_MESSAGE : detail);
  }
  const data: AlertsResponse = await resp.json();
  return data;
}
