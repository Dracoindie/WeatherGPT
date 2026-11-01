"""
WeatherGPT weather alerts endpoint.

GET /api/alerts?latitude=&longitude=

Retrieves real Open-Meteo weather data and evaluates deterministic alert rules.
Does not generate fake alerts or unscientific claims.

If Open-Meteo fails, the fetch is retried once. If it still fails, alerts are
evaluated from the last successful fetch for the same spot (at most
``STALE_MAX_AGE_S`` old) and flagged ``stale``; with no such data the endpoint
answers 503 "alerts temporarily unavailable" rather than a bare 502.
"""

from __future__ import annotations

from datetime import datetime, timezone
import logging
import time

from fastapi import APIRouter, HTTPException, Query

from alerts.engine import evaluate_alerts
from models.alerts import AlertsResponse
from models.weather import WeatherResponse
from query_service import fetch_validated_weather

logger = logging.getLogger(__name__)

router = APIRouter(tags=["alerts"])

UNAVAILABLE_DETAIL = (
    "Alerts are temporarily unavailable: the weather service did not respond. "
    "Please try again in a minute."
)
STALE_MAX_AGE_S = 3 * 3600
_MAX_CACHED = 256

# (lat, lon) rounded to ~1 km -> (monotonic time, last good weather)
_last_good: dict[tuple[float, float], tuple[float, WeatherResponse]] = {}


def _key(latitude: float, longitude: float) -> tuple[float, float]:
    return (round(latitude, 2), round(longitude, 2))


def _remember(key: tuple[float, float], weather: WeatherResponse) -> None:
    _last_good.pop(key, None)
    _last_good[key] = (time.monotonic(), weather)
    while len(_last_good) > _MAX_CACHED:
        _last_good.pop(next(iter(_last_good)))


def _recall(key: tuple[float, float]) -> WeatherResponse | None:
    hit = _last_good.get(key)
    if hit is None or time.monotonic() - hit[0] > STALE_MAX_AGE_S:
        return None
    return hit[1]


def clear_cache() -> None:
    _last_good.clear()


@router.get(
    "/api/alerts",
    response_model=AlertsResponse,
    responses={503: {"description": "Weather service unreachable and no recent data"}},
)
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
    key = _key(latitude, longitude)
    weather: WeatherResponse | None = None
    for attempt in (1, 2):
        try:
            weather = await fetch_validated_weather(latitude, longitude)
            break
        except RuntimeError as exc:
            logger.warning("Alerts weather fetch failed (attempt %d): %s", attempt, exc)

    stale = weather is None
    if weather is None:
        weather = _recall(key)
        if weather is None:
            logger.error("Alerts unavailable for %s: no recent data to fall back on", key)
            raise HTTPException(status_code=503, detail=UNAVAILABLE_DETAIL)
        logger.warning("Serving alerts for %s from data fetched at %s", key, weather.retrieved_at)
    else:
        _remember(key, weather)

    alerts_list = evaluate_alerts(weather)

    return AlertsResponse(
        latitude=weather.latitude,
        longitude=weather.longitude,
        timezone=weather.timezone,
        retrieved_at=datetime.now(timezone.utc),
        active_alerts_count=len(alerts_list),
        alerts=alerts_list,
        stale=stale,
        data_retrieved_at=weather.retrieved_at,
    )
