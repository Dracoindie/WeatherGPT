"""
Open-Meteo Air Quality API (CAMS model): PM2.5 / PM10, hourly, local time.

The index is computed with the CPCB method on the mean concentration over a
window: the trailing 24 h for "now", the requested period otherwise.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta
from typing import Optional

import httpx
from pydantic import BaseModel, Field

import open_meteo_access
from air.aqi import indian_aqi
from http_tls import SSL_CONTEXT

logger = logging.getLogger(__name__)

AIR_QUALITY_URL = "https://air-quality-api.open-meteo.com/v1/air-quality"
TIMEOUT = httpx.Timeout(connect=5.0, read=15.0, write=5.0, pool=5.0)


class AirQualityHourly(BaseModel):
    time: list[str]
    pm2_5: list[Optional[float]]
    pm10: list[Optional[float]]


class AirQualityData(BaseModel):
    source: str = "open-meteo-air-quality"
    timezone: str
    hourly: AirQualityHourly


class AirQualitySummary(BaseModel):
    source: str = "open-meteo-air-quality (CAMS)"
    window: str = Field(..., description="Local ISO start/end of the averaged hours")
    hours: int
    pm2_5: Optional[float] = None
    pm10: Optional[float] = None
    aqi: Optional[int] = None
    aqi_category: Optional[str] = None
    aqi_dominant: Optional[str] = None
    note: str = "Indian AQI computed by WeatherGPT (CPCB method) from modelled PM data; not a CPCB station reading."


async def fetch_air_quality(latitude: float, longitude: float) -> AirQualityData:
    params = {
        "latitude": latitude,
        "longitude": longitude,
        "hourly": "pm2_5,pm10",
        "past_days": 1,
        "forecast_days": 5,
        "timezone": "auto",
    }
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT, verify=SSL_CONTEXT) as client:
            resp = await client.get(open_meteo_access.url("air-quality"), params=open_meteo_access.params(params))
    except httpx.RequestError as exc:
        raise RuntimeError("Air quality service did not respond.") from exc
    if resp.status_code != 200:
        logger.error("Air quality API returned HTTP %d: %s", resp.status_code, resp.text[:200])
        raise RuntimeError(f"Air quality service returned status {resp.status_code}.")
    data = resp.json()
    try:
        return AirQualityData(timezone=data["timezone"], hourly=AirQualityHourly(**data["hourly"]))
    except (KeyError, TypeError, ValueError) as exc:
        raise RuntimeError("Air quality service returned data in an unexpected format.") from exc


def _mean(values: list[Optional[float]]) -> Optional[float]:
    vals = [v for v in values if v is not None]
    return round(sum(vals) / len(vals), 1) if vals else None


def summarise(data: AirQualityData, start: datetime, end: datetime) -> Optional[AirQualitySummary]:
    """Mean PM over local hours start..end (inclusive) and the AQI of those means."""
    h = data.hourly
    idx = [i for i, ts in enumerate(h.time) if start <= datetime.fromisoformat(ts) <= end]
    if not idx:
        return None
    pm25 = _mean([h.pm2_5[i] for i in idx])
    pm10 = _mean([h.pm10[i] for i in idx])
    result = indian_aqi(pm25, pm10)
    return AirQualitySummary(
        window=f"{h.time[idx[0]]} to {h.time[idx[-1]]}",
        hours=len(idx),
        pm2_5=pm25,
        pm10=pm10,
        aqi=result[0] if result else None,
        aqi_category=result[1] if result else None,
        aqi_dominant=result[2] if result else None,
    )


def trailing_24h(data: AirQualityData, now_local: datetime) -> Optional[AirQualitySummary]:
    end = now_local.replace(minute=0, second=0, microsecond=0, tzinfo=None)
    return summarise(data, end - timedelta(hours=23), end)
