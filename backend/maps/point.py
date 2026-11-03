"""
Weather at a tapped map point: the shared Open-Meteo client and validation
(query_service.fetch_validated_weather) plus the CAMS-based Indian AQI.

Every value is Open-Meteo's or derived from it with a documented method (AQI:
CPCB breakpoints in air/aqi.py; heat index: maps/heat_index.py). The values
are the model cell's, not a measurement at the exact point.
"""

from __future__ import annotations

import asyncio
import logging
import time
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field

from air.aqi import uv_category
from air.service import fetch_air_quality, trailing_24h
from maps.grid import MODEL_GRID_KM
from maps.heat_index import heat_index_c
from query_service import _zone, fetch_validated_weather
from thresholds import heat_band

logger = logging.getLogger(__name__)

CACHE_TTL_S = 10 * 60
CACHE_MAX_ENTRIES = 256
_cache: dict[tuple[float, float], tuple[float, "PointWeather"]] = {}


class PointWeather(BaseModel):
    source: str = "open-meteo"
    latitude: float = Field(..., description="The tapped point")
    longitude: float
    model_latitude: float = Field(..., description="Centre of the model cell Open-Meteo answered for")
    model_longitude: float
    model_grid_km: int = MODEL_GRID_KM
    timezone: str
    local_time: str = Field(..., description="Local wall-clock time at the point, YYYY-MM-DDTHH:MM")
    observed_at: str = Field(..., description="Local time of the model's current values")
    temperature_c: float
    feels_like_c: Optional[float] = None
    humidity_pct: float
    wind_speed_kmh: float
    wind_direction_deg: float
    precipitation_probability_pct: Optional[float] = Field(None, description="This hour")
    precipitation_mm: float
    weather_code: int
    uv_index: Optional[float] = None
    uv_category: Optional[str] = None
    aqi: Optional[int] = None
    aqi_category: Optional[str] = None
    heat_index_c: Optional[float] = None
    heat_band: Optional[str] = None
    note: str = "Model values for the grid cell, estimated; not official IMD data. AQI is modelled (CAMS), not a CPCB station reading."


def clear_cache() -> None:
    _cache.clear()


async def _aqi(latitude: float, longitude: float):
    data = await fetch_air_quality(latitude, longitude)
    now = datetime.now(_zone(data.timezone))
    return trailing_24h(data, now)


async def point_weather(latitude: float, longitude: float) -> PointWeather:
    """Raises RuntimeError when the forecast itself is unavailable (AQI may be missing)."""
    # ~1 km: far finer than the model grid, so nearby taps share one answer.
    key = (round(latitude, 2), round(longitude, 2))
    hit = _cache.get(key)
    if hit and hit[0] > time.monotonic():
        return hit[1].model_copy(update={"local_time": _local_now(hit[1].timezone)})

    weather, air = await asyncio.gather(
        fetch_validated_weather(latitude, longitude),
        _aqi(latitude, longitude),
        return_exceptions=True,
    )
    if isinstance(weather, BaseException):
        if isinstance(weather, RuntimeError):
            raise weather
        raise RuntimeError("Weather data could not be processed.") from weather
    if isinstance(air, BaseException):
        logger.warning("AQI unavailable for map point: %s", air)
        air = None

    cur = weather.current
    hour = cur.time[:13]
    prob = next(
        (p for t, p in zip(weather.hourly.time, weather.hourly.precipitation_probability) if t[:13] == hour),
        None,
    )
    hi = heat_index_c(cur.temperature_2m, cur.relative_humidity_2m)
    result = PointWeather(
        latitude=latitude,
        longitude=longitude,
        model_latitude=weather.latitude,
        model_longitude=weather.longitude,
        timezone=weather.timezone,
        local_time=_local_now(weather.timezone),
        observed_at=cur.time,
        temperature_c=cur.temperature_2m,
        feels_like_c=cur.apparent_temperature,
        humidity_pct=cur.relative_humidity_2m,
        wind_speed_kmh=cur.wind_speed_10m,
        wind_direction_deg=cur.wind_direction_10m,
        precipitation_probability_pct=prob,
        precipitation_mm=cur.precipitation,
        weather_code=cur.weather_code,
        uv_index=cur.uv_index,
        uv_category=uv_category(cur.uv_index),
        aqi=air.aqi if air else None,
        aqi_category=air.aqi_category if air else None,
        heat_index_c=hi,
        heat_band=heat_band(hi),
    )
    if len(_cache) >= CACHE_MAX_ENTRIES:
        _cache.pop(next(iter(_cache)))
    _cache[key] = (time.monotonic() + CACHE_TTL_S, result)
    return result


def _local_now(tz: str) -> str:
    return datetime.now(_zone(tz)).strftime("%Y-%m-%dT%H:%M")
