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
}
