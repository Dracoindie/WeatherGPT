export type AlertSeverity = 'advisory' | 'watch' | 'warning' | 'severe';
export type AlertCategory = 'rain' | 'heat' | 'wind' | 'cold' | 'storm';

export interface WeatherAlert {
  id: string;
  alert_type: AlertCategory;
  severity: AlertSeverity;
  condition: string;
  headline: string;
  description: string;
  recommended_action: string;
  relevant_parameter: string;
  relevant_value: number;
  threshold_value: number;
  unit: string;
  time_window: string;
  source: string;
  created_at: string;
}

export interface AlertsResponse {
  latitude: number;
  longitude: number;
  timezone: string;
  retrieved_at: string;
  active_alerts_count: number;
  alerts: WeatherAlert[];
  /** true when the weather service was down and the last good data was used */
  stale?: boolean;
  /** UTC time the evaluated weather data was fetched */
  data_retrieved_at?: string | null;
}
