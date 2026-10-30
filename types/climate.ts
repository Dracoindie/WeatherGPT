// Climate endpoint TypeScript types
export interface HistoricalDaily {
  date: string; // ISO YYYY-MM-DD
  temperature_max?: number | null;
  temperature_min?: number | null;
  precipitation_sum?: number | null;
}

export interface ClimateResponse {
  source: string;
  latitude: number;
  longitude: number;
  timezone: string;
  generation_time: number;
  daily: HistoricalDaily[];
}
