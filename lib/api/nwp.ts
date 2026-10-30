import { NwpResponse } from '@/types/nwp';

export async function fetchNwp(
  latitude: number,
  longitude: number,
  hours = 24
): Promise<NwpResponse> {
  const resp = await fetch(
    `/api/nwp?latitude=${latitude}&longitude=${longitude}&hours=${hours}`
  );
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`NWP request failed: ${resp.status} ${err}`);
  }
  return resp.json();
}
