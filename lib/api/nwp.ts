import { NwpResponse } from '@/types/nwp';
import { API_BASE } from '@/lib/api/base';

/** The backend has no NWP support (xarray / cfgrib / ecCodes missing): HTTP 503. */
export class NwpUnavailableError extends Error {
  constructor() {
    super('NWP unavailable');
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
  const resp = await fetch(url.toString());
  if (resp.status === 503) throw new NwpUnavailableError();
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`NWP request failed: ${resp.status} ${err}`);
  }
  return resp.json();
}
