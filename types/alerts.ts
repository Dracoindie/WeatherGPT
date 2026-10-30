export type AlertSeverity = 'advisory' | 'watch' | 'warning';
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
}
