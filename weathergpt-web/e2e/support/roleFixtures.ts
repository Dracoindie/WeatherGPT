/** Role endpoint fixtures shared by e2e specs and the screenshot pass. */

const NOTE =
  'Guidance computed from Open-Meteo forecast thresholds by WeatherGPT; not an official IMD / agro-met / aviation product.'

export const FARM = {
  timezone: 'Asia/Kolkata',
  spray_windows: [
    { start: '2026-11-02T06:00', end: '2026-11-02T10:00', hours: 5, max_wind_kmh: 9.5, max_temperature_c: 27.1 },
    { start: '2026-11-03T15:00', end: '2026-11-03T18:00', hours: 4, max_wind_kmh: 11.2, max_temperature_c: 28.4 },
  ],
  irrigation: {
    status: 'delay',
    rain_next_48h_mm: 6.2,
    max_precipitation_probability_24h: 65,
    max_temperature_48h_c: 29.0,
    reason: 'Rain is likely (6.2 mm in 48 h, up to 65% chance in 24 h); wait and check soil moisture.',
  },
  harvest_days: [
    { date: '2026-11-02', precipitation_mm: 0, max_precipitation_probability: 10, max_wind_kmh: 12, max_temperature_c: 29, harvest: 'good', reasons: [] },
    { date: '2026-11-03', precipitation_mm: 4.2, max_precipitation_probability: 70, max_wind_kmh: 18, max_temperature_c: 27, harvest: 'avoid', reasons: ['4.2 mm rain', '70% rain chance'] },
    { date: '2026-11-04', precipitation_mm: 0.2, max_precipitation_probability: 20, max_wind_kmh: 14, max_temperature_c: 30, harvest: 'good', reasons: [] },
  ],
  sowing: { status: 'dry', rain_next_72h_mm: 6.2, max_daily_rain_mm: 4.2, reason: 'Only 6.2 mm of rain in 3 days: sow only with irrigation.' },
  thresholds: { spray_max_wind_kmh: 15 },
  note: NOTE,
}

export const AVIATION = {
  observation_time: '2026-11-01T15:00',
  visibility_km: 6.4,
  visibility_band: 'moderate',
  cloud_cover_percent: 78,
  wind_kmh: 18.4,
  wind_kt: 10,
  wind_direction_deg: 250,
  gust_kmh: 42.1,
  gust_kt: 23,
  precipitation_mm: 0.6,
  weather_code: 61,
  weather_description: 'Light rain',
  next_hours: 6,
  next_min_visibility_km: 3.2,
  next_max_gust_kmh: 47.5,
  next_max_wind_kmh: 22.0,
  next_precipitation_mm: 4.8,
  next_max_weather_code: 95,
  flags: [
    'Thunderstorm in the model within 6 h (WMO 95).',
    'Visibility down to 3.2 km.',
    'Gusty: gusts 47.5 km/h vs wind 22 km/h.',
    'Strong wind: up to 47.5 km/h.',
  ],
  note: NOTE,
}

export const COMPARE = {
  timezone: 'Asia/Kolkata',
  gfs_run: '2026-11-01T06:00:00+00:00',
  rows: Array.from({ length: 24 }, (_, i) => ({
    valid_time_utc: `2026-11-01T${String((7 + i) % 24).padStart(2, '0')}:00Z`,
    open_meteo_temperature_c: Math.round((24 + 4 * Math.sin(i / 3.8)) * 10) / 10,
    gfs_temperature_c: Math.round((24.6 + 4.3 * Math.sin(i / 3.8 - 0.2)) * 10) / 10,
    open_meteo_precipitation_mm: i % 7 === 0 ? 0.4 : 0,
    gfs_precipitation_mm: i % 6 === 0 ? 0.6 : 0,
    open_meteo_wind_kmh: 12,
    gfs_wind_kmh: 13.5,
  })),
  stats: {
    pairs: 24,
    temperature_bias_c: 0.62,
    temperature_mae_c: 0.91,
    wind_bias_kmh: 1.5,
    wind_mae_kmh: 1.5,
    open_meteo_precipitation_total_mm: 1.6,
    gfs_precipitation_total_mm: 2.4,
  },
  note: 'Both are model output for the same valid hours: GFS 0.25° from NOAA NOMADS and the Open-Meteo best-match blend. Differences are not errors against observations.',
}

export const BOARD = {
  generated_at: '2026-11-01T10:00:00Z',
  note: NOTE,
  districts: [
    { name: 'Ratnagiri', latitude: 16.99, longitude: 73.31, severity: 'warning', alerts_count: 2, headline: 'Warning: Extreme rainfall (72.4 mm)', rain_24h_mm: 72.4, max_wind_24h_kmh: 38, max_temperature_24h_c: 27, error: null },
    { name: 'Raigad (Alibag)', latitude: 18.64, longitude: 72.87, severity: 'watch', alerts_count: 1, headline: 'Heavy rain expected', rain_24h_mm: 48.5, max_wind_24h_kmh: 31, max_temperature_24h_c: 28, error: null },
    { name: 'Pune', latitude: 18.52, longitude: 73.86, severity: 'watch', alerts_count: 1, headline: 'Heavy rain expected', rain_24h_mm: 41, max_wind_24h_kmh: 22, max_temperature_24h_c: 28, error: null },
    { name: 'Kolhapur', latitude: 16.7, longitude: 74.24, severity: 'advisory', alerts_count: 1, headline: 'Gusty winds', rain_24h_mm: 12, max_wind_24h_kmh: 35, max_temperature_24h_c: 29, error: null },
    { name: 'Nagpur', latitude: 21.15, longitude: 79.09, severity: 'none', alerts_count: 0, headline: null, rain_24h_mm: 0, max_wind_24h_kmh: 12, max_temperature_24h_c: 31, error: null },
    { name: 'Latur', latitude: 18.41, longitude: 76.56, severity: 'unknown', alerts_count: 0, headline: null, rain_24h_mm: null, max_wind_24h_kmh: null, max_temperature_24h_c: null, error: 'Weather service did not respond' },
  ],
}
