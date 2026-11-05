import { apiFetch } from '@/lib/replay'
import { NwpResponse } from '@/types/nwp';
import { API_BASE } from '@/lib/api/base';

/**
 * GFS is not available. ``temporary``: NOAA NOMADS did not answer and there is
 * no recent result (HTTP 503 "GFS model temporarily unavailable: ..."), or the
 * request failed in another way; false: this server has no GFS support at all
 * (xarray / cfgrib / ecCodes missing). The UI shows a friendly message either
 * way, never the raw error.
 */
export class NwpUnavailableError extends Error {
  constructor(public temporary: boolean) {
    super(temporary ? 'GFS temporarily unavailable' : 'NWP unavailable');
    this.name = 'NwpUnavailableError';
  }
}

export async function fetchNwp(
  latitude: number,
  longitude: number,
  hours = 24
): Promise<NwpResponse> {
  const url = new URL(`${API_BASE}/api/nwp`);
  url.searchParams.set('latitude', String(latitude));
  url.searchParams.set('longitude', String(longitude));
  url.searchParams.set('hours', String(hours));
  let resp: Response;
  try {
    resp = await apiFetch(url.toString());
  } catch {
    throw new NwpUnavailableError(true);
  }
  if (resp.ok) return resp.json();
  let detail = '';
  try {
    const body = (await resp.json()) as { detail?: unknown };
    if (typeof body.detail === 'string') detail = body.detail;
  } catch {
    // no JSON body
  }
  // the stub for a build without GFS support says "NWP unavailable"
  throw new NwpUnavailableError(!(resp.status === 503 && detail === 'NWP unavailable'));
}
