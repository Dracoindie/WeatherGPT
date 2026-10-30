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
}

export function InteractiveMap({ latitude, longitude, locationName, alertsCount }: Props) {
  const mapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!mapRef.current) return;
    const map = L.map(mapRef.current).setView([latitude, longitude], 11);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
      maxZoom: 18,
    }).addTo(map);

    const marker = L.marker([latitude, longitude]).addTo(map);

    const title = locationName || `Coordinates: ${latitude.toFixed(3)}, ${longitude.toFixed(3)}`;
    const alertHtml = (alertsCount && alertsCount > 0)
      ? `<div style="color: #e11d48; font-weight: 600; margin-top: 4px;">⚠️ ${alertsCount} active alert${alertsCount > 1 ? 's' : ''}</div>`
      : `<div style="color: #0d9488; font-weight: 500; margin-top: 4px;">✓ Conditions normal</div>`;

    marker.bindPopup(`
      <div style="font-family: sans-serif; font-size: 13px; line-height: 1.4;">
        <strong style="font-size: 14px;">${title}</strong>
        <div style="color: #64748b; font-size: 11px;">${latitude.toFixed(4)}° N, ${longitude.toFixed(4)}° E</div>
        ${alertHtml}
      </div>
    `).openPopup();

    return () => {
      map.remove();
    };
  }, [latitude, longitude, locationName, alertsCount]);

  return (
    <div
      ref={mapRef}
      className="h-full w-full min-h-[350px] rounded-[16px] overflow-hidden border border-line z-0"
    />
  );
}
