export interface NwpForecast {
  hour: number;
  temperatureC: number;
  precipitationMm: number;
  windMs: number;
}

export interface NwpMetadata {
  model: string;
  generationTime: string;
  latitude: number;
  longitude: number;
}

export interface NwpResponse {
  metadata: NwpMetadata;
  forecasts: NwpForecast[];
  /** When this GFS data was fetched from NOAA NOMADS (UTC ISO) */
  retrievedAt?: string | null;
  /** NOMADS failed just now; this is the last good result */
  stale?: boolean;
  staleReason?: string | null;
}
