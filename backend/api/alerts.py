"""
WeatherGPT weather alerts endpoint.

GET /api/alerts?latitude=&longitude=

Retrieves real Open-Meteo weather data and evaluates deterministic alert rules.
Does not generate fake alerts or unscientific claims.
"""

from __future__ import annotations

from datetime import datetime, timezone
import logging
from fastapi import APIRouter, HTTPException, Query

from alerts.engine import evaluate_alerts
from models.alerts import AlertsResponse
from query_service import fetch_validated_weather

logger = logging.getLogger(__name__)

router = APIRouter(tags=["alerts"])


@router.get("/api/alerts", response_model=AlertsResponse)
async def get_alerts(
    latitude: float = Query(
        ...,
        ge=-90.0,
        le=90.0,
        description="Latitude in decimal degrees (-90 to 90)",
    ),
    longitude: float = Query(
        ...,
        ge=-180.0,
        le=180.0,
        description="Longitude in decimal degrees (-180 to 180)",
    ),
) -> AlertsResponse:
    """
    Evaluate and return real, deterministic weather alerts for the requested location.
    """
    try:
        weather = await fetch_validated_weather(latitude, longitude)
    except RuntimeError as exc:
        logger.error("Failed to fetch weather for alerts: %s", exc)
        raise HTTPException(
            status_code=502,
            detail="Weather service is temporarily unavailable.",
        ) from exc

    alerts_list = evaluate_alerts(weather)

    return AlertsResponse(
        latitude=weather.latitude,
        longitude=weather.longitude,
        timezone=weather.timezone,
        retrieved_at=datetime.now(timezone.utc),
        active_alerts_count=len(alerts_list),
        alerts=alerts_list,
    )
