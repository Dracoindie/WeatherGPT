"""
GET /api/air-quality – Indian AQI (CPCB method, from Open-Meteo CAMS PM data)
for the last 24 h and the next 24 h, plus the UV index now and today's peak.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from air.aqi import uv_category
from air.service import AirQualitySummary, fetch_air_quality, summarise, trailing_24h
from query_service import _parse_local, _zone, fetch_validated_weather

logger = logging.getLogger(__name__)

router = APIRouter(tags=["air quality"])


class AirQualityReport(BaseModel):
    latitude: float
    longitude: float
    timezone: str
    last_24h: Optional[AirQualitySummary] = None
    next_24h: Optional[AirQualitySummary] = None
    uv_index: Optional[float] = None
    uv_max_today: Optional[float] = None
    uv_category: Optional[str] = None
    uv_max_category: Optional[str] = None
    note: str = (
        "AQI computed by WeatherGPT with the CPCB method from Open-Meteo (CAMS) modelled PM2.5/PM10; "
        "not a CPCB monitoring-station reading. UV index from Open-Meteo."
    )


@router.get("/api/air-quality", response_model=AirQualityReport)
async def air_quality(
    latitude: float = Query(..., ge=-90.0, le=90.0),
    longitude: float = Query(..., ge=-180.0, le=180.0),
) -> AirQualityReport:
    try:
        data = await fetch_air_quality(latitude, longitude)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail="Air quality data is temporarily unavailable.") from exc

    now = datetime.now(_zone(data.timezone)).replace(minute=0, second=0, microsecond=0, tzinfo=None)
    report = AirQualityReport(
        latitude=latitude,
        longitude=longitude,
        timezone=data.timezone,
        last_24h=trailing_24h(data, now),
        next_24h=summarise(data, now + timedelta(hours=1), now + timedelta(hours=24)),
    )

    # UV is in the forecast payload; its absence is not an error.
    try:
        weather = await fetch_validated_weather(latitude, longitude)
        tz = _zone(weather.timezone)
        today = datetime.now(tz).date()
        uvs = [
            v
            for ts, v in zip(weather.hourly.time, weather.hourly.uv_index or [])
            if v is not None and _parse_local(ts, tz).date() == today
        ]
        report.uv_index = weather.current.uv_index
        report.uv_max_today = round(max(uvs), 1) if uvs else None
        report.uv_category = uv_category(report.uv_index)
        report.uv_max_category = uv_category(report.uv_max_today)
    except RuntimeError as exc:
        logger.warning("UV unavailable for air-quality report: %s", exc)
    return report
