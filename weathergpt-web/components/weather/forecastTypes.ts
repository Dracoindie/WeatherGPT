export interface DataState<T> {
  status: 'idle' | 'loading' | 'ready' | 'error';
  data?: T;
  error?: string;
}

export interface DailyForecast {
  date: string;
  weather_code: number;
  max_temperature: number | null;
  min_temperature: number | null;
  precipitation_sum: number | null;
  precipitation_probability_max: number | null;
  max_wind_speed: number | null;
}

export interface ForecastResponse {
  source: string;
  latitude: number;
  longitude: number;
  timezone: string;
  retrieved_at: string;
  daily: DailyForecast[];
}

export interface ForecastDay {
  date: string;
  temperatureMaxC: number;
  temperatureMinC: number;
  precipitationMm: number;
  precipitationProbability: number;
  windSpeedKmh: number;
  /** English fallback; the UI shows describeWeather(weatherCode) in the selected language. */
  condition: string;
  weatherCode?: number | null;
}

export interface WeatherResponse {
  forecast: ForecastDay[];
}
