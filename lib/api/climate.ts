// Climate API wrapper
import type { ClimateResponse } from "@/types/climate";

export async function fetchClimate(
  latitude: number,
  longitude: number,
  startDate?: string,
  endDate?: string
): Promise<ClimateResponse> {
  const base =
    process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, "") ?? "http://localhost:8000";
  const url = new URL(`${base}/api/climate`);
  url.searchParams.set("latitude", latitude.toString());
  url.searchParams.set("longitude", longitude.toString());
  if (startDate) url.searchParams.set("start_date", startDate);
  if (endDate) url.searchParams.set("end_date", endDate);
  const res = await fetch(url.toString());
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Climate API error ${res.status}: ${txt}`);
  }
  return (await res.json()) as ClimateResponse;
}
