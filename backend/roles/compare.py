"""
GFS vs Open-Meteo for the same valid hours (researcher view).

Open-Meteo hourly times are local wall times (timezone=auto); GFS forecast
hour h is run + h (UTC). Both are mapped to UTC and joined on the hour.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from statistics import mean
from typing import Optional

from models.roles import CompareRow, CompareStats, ModelComparison
from models.weather import WeatherResponse
from nwp.facts import hourly_precipitation
from nwp.models import NwpResponse
from query_service import _parse_local, _zone


def _r(v: Optional[float], d: int = 1) -> Optional[float]:
    return None if v is None else round(v, d)


def compare_models(weather: WeatherResponse, gfs: NwpResponse) -> ModelComparison:
    tz = _zone(weather.timezone)
    h = weather.hourly
    om_by_utc = {}
    for i, ts in enumerate(h.time):
        key = _parse_local(ts, tz).astimezone(timezone.utc).strftime("%Y-%m-%dT%H:00Z")
        om_by_utc[key] = i

    run = datetime.fromisoformat(gfs.metadata.generationTime)
    if run.tzinfo is None:
        run = run.replace(tzinfo=timezone.utc)
    rain = hourly_precipitation([f.precipitationMm for f in gfs.forecasts])

    rows: list[CompareRow] = []
    for k, f in enumerate(gfs.forecasts):
        if f.hour == 0:
            continue  # analysis hour: no precipitation accumulation yet
        key = (run + timedelta(hours=f.hour)).strftime("%Y-%m-%dT%H:00Z")
        i = om_by_utc.get(key)
        if i is None:
            continue
        rows.append(
            CompareRow(
                valid_time_utc=key,
                open_meteo_temperature_c=_r(h.temperature_2m[i]),
                gfs_temperature_c=_r(f.temperatureC),
                open_meteo_precipitation_mm=_r(h.precipitation[i]),
                gfs_precipitation_mm=_r(rain[k]),
                open_meteo_wind_kmh=_r(h.wind_speed_10m[i]),
                gfs_wind_kmh=_r(f.windMs * 3.6),
            )
        )

    def pairs(a: str, b: str) -> list[tuple[float, float]]:
        return [(getattr(r, a), getattr(r, b)) for r in rows if getattr(r, a) is not None and getattr(r, b) is not None]

    t = pairs("gfs_temperature_c", "open_meteo_temperature_c")
    w = pairs("gfs_wind_kmh", "open_meteo_wind_kmh")
    stats = CompareStats(
        pairs=len(rows),
        temperature_bias_c=_r(mean(g - o for g, o in t), 2) if t else None,
        temperature_mae_c=_r(mean(abs(g - o) for g, o in t), 2) if t else None,
        wind_bias_kmh=_r(mean(g - o for g, o in w), 2) if w else None,
        wind_mae_kmh=_r(mean(abs(g - o) for g, o in w), 2) if w else None,
        open_meteo_precipitation_total_mm=_r(sum(r.open_meteo_precipitation_mm or 0 for r in rows)),
        gfs_precipitation_total_mm=_r(sum(r.gfs_precipitation_mm or 0 for r in rows)),
    )
    return ModelComparison(
        latitude=weather.latitude,
        longitude=weather.longitude,
        timezone=weather.timezone,
        gfs_run=run.isoformat(),
        generated_at=datetime.now(timezone.utc),
        rows=rows,
        stats=stats,
    )
