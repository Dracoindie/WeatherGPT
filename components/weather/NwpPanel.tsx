import { useEffect, useState } from 'react';
import { fetchNwp, NwpUnavailableError } from '@/lib/api/nwp';
import type { NwpResponse } from '@/types/nwp';

interface NwpPanelProps {
  latitude: number | undefined;
  longitude: number | undefined;
}

export function NwpPanel({ latitude, longitude }: NwpPanelProps) {
  const [data, setData] = useState<NwpResponse | null>(null);
  const [error, setError] = useState<string>('');
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    if (latitude === undefined || longitude === undefined) return;
    fetchNwp(latitude, longitude)
      .then((resp) => setData(resp))
      .catch((e) => {
        if (e instanceof NwpUnavailableError) setUnavailable(true);
        else setError(e.message);
      });
  }, [latitude, longitude]);

  const loading = !data && !error && !unavailable;


  if (loading) {
    return <div className="rounded border border-line p-4">Loading NWP data...</div>;
  }
  if (unavailable) {
    return (
      <div className="rounded border border-line p-4 text-sm text-muted-foreground">
        NWP (GFS) model data is unavailable on this server.
      </div>
    );
  }
  if (error) {
    return (
      <div className="rounded border border-line p-4 text-sm text-muted-foreground">
        NWP (GFS) data temporarily unavailable. Please try again later.
      </div>
    );
  }
  if (!data) {
    return null;
  }

  return (
    <div className="rounded border border-line p-4">
      <h2 className="font-display text-sm font-semibold mb-2">NWP Model: {data.metadata.model}</h2>
      <p className="text-xs mb-2">Generated at: {data.metadata.generationTime}</p>
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="border-b border-line">
            <th className="text-left py-1">Hour</th>
            <th className="text-right py-1">Temp (°C)</th>
            <th className="text-right py-1">Precip (mm)</th>
            <th className="text-right py-1">Wind (m/s)</th>
          </tr>
        </thead>
        <tbody>
          {data.forecasts.map((f) => (
            <tr key={f.hour} className="border-b border-line/30">
              <td className="py-1">+{f.hour}h</td>
              <td className="text-right py-1">{f.temperatureC.toFixed(1)}</td>
              <td className="text-right py-1">{f.precipitationMm.toFixed(1)}</td>
              <td className="text-right py-1">{f.windMs.toFixed(1)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
