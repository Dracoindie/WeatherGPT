"use client";

import AuthGuard from '@/components/auth/AuthGuard';
import { API_BASE } from '@/lib/api/base';
import { TopNav } from '@/components/layout/TopNav';
import LocationPicker, { type LocationData } from '@/components/location/LocationPicker';
import { useAuthContext } from '@/context/AuthContext';
import { useDemoContext } from '@/context/DemoContext';
import { upsertProfile } from '@/lib/profile/profileService';
import { fetchForecast } from '@/lib/api/forecast';
import { ALERTS_UNAVAILABLE_MESSAGE, fetchAlerts } from '@/lib/api/alerts';
import { CurrentWeatherHero } from '@/components/weather/CurrentWeatherHero';
import { ForecastPanel } from '@/components/weather/ForecastPanel';
import { WeatherIntelligence } from '@/components/weather/WeatherIntelligence';
import { ChatPanel } from '@/components/chat/ChatPanel';
import { TrustStrip } from '@/components/common/TrustStrip';
import dynamic from 'next/dynamic';

// Leaflet touches `window` at import time, so the map must not render on the server.
const InteractiveMap = dynamic(
  () => import('@/components/map/InteractiveMap').then((m) => m.InteractiveMap),
  { ssr: false }
);
import { AlertBanner } from '@/components/alerts/AlertBanner';
import type { AdvisoryResult } from '@/components/weather/WeatherIntelligence';
import type { DataState, WeatherResponse } from '@/components/weather/forecastTypes';
import type { WeatherAlert } from '@/types/alerts';
import { useState } from 'react';

// Reuse same WMO description mapping from dashboard
const WMO_DESCRIPTIONS: Record<number, string> = {
  0: 'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast',
  45: 'Fog', 48: 'Icy fog',
  51: 'Light drizzle', 53: 'Drizzle', 55: 'Dense drizzle',
  61: 'Light rain', 63: 'Rain', 65: 'Heavy rain',
  71: 'Light snow', 73: 'Snow', 75: 'Heavy snow',
  80: 'Light showers', 81: 'Showers', 82: 'Heavy showers',
  95: 'Thunderstorm', 96: 'Thunderstorm with hail', 99: 'Heavy thunderstorm',
};

interface WeatherApiResponse {
  source: string;
  timezone: string;
  current: {
    temperature_2m: number;
    relative_humidity_2m: number;
    precipitation: number;
    wind_speed_10m: number;
    weather_code: number;
    time: string;
  };
}

type WeatherStatus = 'idle' | 'loading' | 'ready' | 'error';

export default function MapPage() {
  const { user, session } = useAuthContext();
  const { isDemo } = useDemoContext();
  const [location, setLocation] = useState<LocationData | null>(null);
  const [weatherData, setWeatherData] = useState<WeatherApiResponse | null>(null);
  const [weatherStatus, setWeatherStatus] = useState<WeatherStatus>('idle');
  const [weatherError, setWeatherError] = useState('');
  const [advisory, setAdvisory] = useState<AdvisoryResult | null>(null);
  const [forecastState, setForecastState] = useState<DataState<WeatherResponse>>({ status: 'idle' });
  const [alerts, setAlerts] = useState<WeatherAlert[]>([]);
  const [alertsLoading, setAlertsLoading] = useState(false);
  const [alertsError, setAlertsError] = useState<string | null>(null);
  const [alertsStaleSince, setAlertsStaleSince] = useState<string | null>(null);

  async function handleLocationSelected(loc: LocationData) {
    setLocation(loc);
    setWeatherError('');
    setWeatherStatus('loading');

    if (user && !isDemo) {
      await upsertProfile(user.id, {
        default_latitude: loc.latitude,
        default_longitude: loc.longitude,
        default_location_name: loc.name,
        location_permission: true,
      });
    }

    try {
      const resp = await fetch(`${API_BASE}/api/weather?latitude=${loc.latitude}&longitude=${loc.longitude}`);
      if (!resp.ok) throw new Error(`Weather API error: ${resp.status}`);
      const data: WeatherApiResponse = await resp.json();
      setWeatherData(data);
      setWeatherStatus('ready');

      // Fetch forecast
      try {
        setForecastState({ status: 'loading' });
        const forecastData = await fetchForecast({ latitude: loc.latitude, longitude: loc.longitude });
        const enriched = forecastData.daily.map(d => ({
          date: d.date,
          temperatureMaxC: d.max_temperature ?? 0,
          temperatureMinC: d.min_temperature ?? 0,
          precipitationMm: d.precipitation_sum ?? 0,
          precipitationProbability: d.precipitation_probability_max ?? 0,
          windSpeedKmh: d.max_wind_speed ?? 0,
          condition: WMO_DESCRIPTIONS[d.weather_code] ?? 'Unknown',
        }));
        setForecastState({ status: 'ready', data: { forecast: enriched } });
      } catch (err) {
        setForecastState({ status: 'error', error: err instanceof Error ? err.message : 'Forecast fetch failed' });
      }

      // Fetch alerts
      await loadAlerts(loc);
    } catch (err) {
      setWeatherStatus('error');
      setWeatherError(err instanceof Error ? err.message : 'Could not fetch weather. Is the backend running?');
    }
  }

  async function loadAlerts(loc: LocationData) {
    setAlertsLoading(true);
    setAlertsError(null);
    try {
      const alertData = await fetchAlerts({ latitude: loc.latitude, longitude: loc.longitude });
      setAlerts(alertData.alerts);
      setAlertsStaleSince(alertData.stale ? alertData.data_retrieved_at ?? null : null);
    } catch (err) {
      setAlerts([]);
      setAlertsStaleSince(null);
      setAlertsError(err instanceof Error ? err.message : ALERTS_UNAVAILABLE_MESSAGE);
    } finally {
      setAlertsLoading(false);
    }
  }

  const conditionLabel =
    weatherData?.current.weather_code != null ? (WMO_DESCRIPTIONS[weatherData.current.weather_code] ?? 'Unknown') : undefined;

  return (
    <AuthGuard>
      <div className="min-h-screen bg-canvas flex flex-col">
        <TopNav />
        <main className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6 lg:py-8 flex-grow">
          <div className="mb-6 flex flex-col justify-between gap-4 border-b border-line pb-6 sm:flex-row sm:items-end">
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-teal">Live meteorological context</p>
              <h1 className="mt-2 font-display text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
                Interactive Weather Map
              </h1>
            </div>
            <LocationPicker onLocationSelected={handleLocationSelected} defaultLocation={location} />
          </div>

          <div className="mb-5">
            <AlertBanner
              alerts={alerts}
              locationName={location?.name}
              loading={alertsLoading}
              error={alertsError}
              staleSince={alertsStaleSince}
              onRetry={location ? () => void loadAlerts(location) : undefined}
            />
          </div>

          {weatherError && (
            <div className="mb-4 rounded-[12px] border border-coral/30 bg-coral-soft p-4 text-sm text-coral">
              Weather data is temporarily unavailable. {weatherError}
            </div>
          )}

          {/* Map and side panels */}
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
            <div className="h-96 xl:h-auto min-h-[400px]">
              {location ? (
                <InteractiveMap
                  latitude={location.latitude}
                  longitude={location.longitude}
                  locationName={location.name}
                  alertsCount={alerts.length}
                />
              ) : (
                <div className="flex h-full min-h-[350px] items-center justify-center rounded-[16px] border border-line bg-panel text-ink-soft">
                  Select a location to view the interactive map.
                </div>
              )}
            </div>
            <div className="space-y-5">
              <CurrentWeatherHero
                status={weatherStatus}
                current={weatherData?.current}
                locationName={location?.name}
                timezone={weatherData?.timezone}
                source={weatherData?.source}
                conditionLabel={conditionLabel}
              />
              <WeatherIntelligence advisory={advisory} />
            </div>
          </div>

          <section className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
            <ChatPanel
              latitude={location?.latitude}
              longitude={location?.longitude}
              accessToken={isDemo ? undefined : session?.access_token}
              onAdvisoryChange={setAdvisory}
            />
            <aside className="space-y-5">
              <ForecastPanel state={forecastState} />
              <TrustStrip />
            </aside>
          </section>
        </main>
      </div>
    </AuthGuard>
  );
}
