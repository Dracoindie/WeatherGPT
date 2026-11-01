"""
Aviation weather briefing from Open-Meteo current + next hours.

Not a METAR/TAF: Open-Meteo is model output for a grid point, and has no
cloud base, so no flight category is derived. Bands and flags below are
plain thresholds; see docs/ROLE_ADVISORIES.md.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Optional

from models.roles import AviationBriefing
from models.weather import WeatherResponse
from llm.response_generator import _fmt as _n
from query_service import _parse_local, _zone, weather_code_description

KMH_PER_KT = 1.852
NEXT_HOURS = 6
# Visibility bands (km)
VIS_GOOD_KM = 8.0
VIS_MODERATE_KM = 5.0
VIS_POOR_KM = 1.5
# Flags
GUST_SPREAD_KMH = 18.5  # ~10 kt between mean wind and gusts
STRONG_WIND_KMH = 46.0  # ~25 kt
THUNDERSTORM_CODE = 95

THRESHOLDS: dict[str, float] = {
    "visibility_good_km": VIS_GOOD_KM,
    "visibility_moderate_km": VIS_MODERATE_KM,
    "visibility_poor_km": VIS_POOR_KM,
    "gust_spread_kmh": GUST_SPREAD_KMH,
    "strong_wind_kmh": STRONG_WIND_KMH,
    "thunderstorm_wmo_code": THUNDERSTORM_CODE,
}


def visibility_band(km: Optional[float]) -> Optional[str]:
    if km is None:
        return None
    if km >= VIS_GOOD_KM:
        return "good"
    if km >= VIS_MODERATE_KM:
        return "moderate"
    if km >= VIS_POOR_KM:
        return "poor"
    return "very_poor"


def _kt(kmh: Optional[float]) -> Optional[float]:
    return None if kmh is None else round(kmh / KMH_PER_KT)


def _vals(series: Optional[list], idx: list[int]) -> list[float]:
    if not series:
        return []
    return [series[i] for i in idx if i < len(series) and series[i] is not None]


def aviation_briefing(weather: WeatherResponse, now: Optional[datetime] = None) -> AviationBriefing:
    tz = _zone(weather.timezone)
    now = (now or datetime.now(timezone.utc)).astimezone(tz)
    start = now.replace(minute=0, second=0, microsecond=0)
    h = weather.hourly
    idx = [
        i for i, ts in enumerate(h.time) if start < _parse_local(ts, tz) <= start + timedelta(hours=NEXT_HOURS)
    ]
    c = weather.current
    vis_km = None if c.visibility is None else round(c.visibility / 1000, 1)
    next_vis = _vals(h.visibility, idx)
    next_gust = _vals(h.wind_gusts_10m, idx)
    next_wind = _vals(h.wind_speed_10m, idx)
    next_rain = _vals(h.precipitation, idx)
    next_codes = _vals(h.weather_code, idx)

    min_vis = round(min(next_vis) / 1000, 1) if next_vis else None
    max_gust = round(max(next_gust), 1) if next_gust else None
    max_wind = round(max(next_wind + [c.wind_speed_10m]), 1)
    max_code = int(max(next_codes)) if next_codes else None

    flags: list[str] = []
    if max(c.weather_code, max_code or 0) >= THUNDERSTORM_CODE:
        flags.append(f"Thunderstorm in the model within {NEXT_HOURS} h (WMO {max(c.weather_code, max_code or 0)}).")
    worst_vis = min(v for v in (vis_km, min_vis) if v is not None) if (vis_km is not None or min_vis is not None) else None
    if worst_vis is not None and worst_vis < VIS_MODERATE_KM:
        flags.append(f"Visibility down to {_n(worst_vis)} km.")
    gusts = [g for g in (c.wind_gusts_10m, max_gust) if g is not None]
    if gusts and max(gusts) - max_wind >= GUST_SPREAD_KMH:
        flags.append(f"Gusty: gusts {_n(round(max(gusts), 1))} km/h vs wind {_n(max_wind)} km/h.")
    if max(gusts + [max_wind]) >= STRONG_WIND_KMH:
        flags.append(f"Strong wind: up to {_n(round(max(gusts + [max_wind]), 1))} km/h.")

    return AviationBriefing(
        latitude=weather.latitude,
        longitude=weather.longitude,
        timezone=weather.timezone,
        generated_at=datetime.now(timezone.utc),
        observation_time=c.time,
        visibility_km=vis_km,
        visibility_band=visibility_band(vis_km),
        cloud_cover_percent=c.cloud_cover,
        wind_kmh=c.wind_speed_10m,
        wind_kt=_kt(c.wind_speed_10m),
        wind_direction_deg=c.wind_direction_10m,
        gust_kmh=c.wind_gusts_10m,
        gust_kt=_kt(c.wind_gusts_10m),
        precipitation_mm=c.precipitation,
        weather_code=c.weather_code,
        weather_description=weather_code_description(c.weather_code),
        next_hours=NEXT_HOURS,
        next_min_visibility_km=min_vis,
        next_max_gust_kmh=max_gust,
        next_max_wind_kmh=max_wind,
        next_precipitation_mm=round(sum(next_rain), 1),
        next_max_weather_code=max_code,
        flags=flags,
        thresholds=THRESHOLDS,
    )
