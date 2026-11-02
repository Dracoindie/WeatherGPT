"use client";
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { useEffect, useRef } from 'react';

// Fix default icon URLs for Leaflet in Next.js/Webpack environment
// eslint-disable-next-line @typescript-eslint/no-explicit-any
delete (L.Icon.Default.prototype as any)._getIconUrl;
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
});

interface Props {
  latitude: number;
  longitude: number;
  locationName?: string;
  alertsCount?: number;
  /** Current conditions, already in the selected UI language. */
  conditionLabel?: string;
  /** Localised status lines for the popup. */
  alertsText?: string;
  normalText?: string;
}

const escapeHtml = (v: string) =>
  v.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** The same dark CARTO basemap as the risk board and the Living Sky geo-lock map. */
const TILES = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';

export function InteractiveMap({ latitude, longitude, locationName, alertsCount, conditionLabel, alertsText, normalText }: Props) {
  const mapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!mapRef.current) return;
    const map = L.map(mapRef.current).setView([latitude, longitude], 11);
    L.tileLayer(TILES, {
      attribution: '© OpenStreetMap contributors © CARTO',
      maxZoom: 18,
    }).addTo(map);

    const marker = L.marker([latitude, longitude]).addTo(map);

    const title = locationName ? escapeHtml(locationName) : `${latitude.toFixed(3)}, ${longitude.toFixed(3)}`;
    const alertHtml = (alertsCount && alertsCount > 0)
      ? `<div style="color: var(--sev-warning-text); font-weight: 600; margin-top: 6px;">⚠ ${escapeHtml(alertsText ?? `${alertsCount} active alert(s)`)}</div>`
      : `<div style="color: var(--sev-none-text); margin-top: 6px;">✓ ${escapeHtml(normalText ?? 'No active alerts')}</div>`;

    marker.bindPopup(`
      <div style="font-size: 13px; line-height: 1.45;">
        <strong style="font-size: 14px;">${title}</strong>
        <div style="color: var(--sky-text-dim); font-size: 11px;">${latitude.toFixed(4)}° N, ${longitude.toFixed(4)}° E</div>
        ${conditionLabel ? `<div data-testid="weather-description" style="margin-top: 6px;">${escapeHtml(conditionLabel)}</div>` : ''}
        ${alertHtml}
      </div>
    `).openPopup();

    return () => {
      map.remove();
    };
  }, [latitude, longitude, locationName, alertsCount, conditionLabel, alertsText, normalText]);

  return <div ref={mapRef} className="z-0 h-full min-h-[360px] w-full overflow-hidden rounded-xl" />;
}
