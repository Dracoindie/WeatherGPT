from fastapi import APIRouter, HTTPException, Query
from datetime import datetime, timezone
import httpx

import open_meteo_access
import logging
from models.forecast import ForecastResponse, DailyForecast

router = APIRouter()
logger = logging.getLogger(__name__)

OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast"
TIMEOUT = httpx.Timeout(connect=5.0, read=15.0, write=5.0, pool=5.0)

async def _fetch_daily(latitude: float, longitude: float, days: int) -> dict:
    params = {
        "latitude": latitude,
        "longitude": longitude,
        "daily": ",".join([
            "weather_code",
            "temperature_2m_max",
            "temperature_2m_min",
            "precipitation_sum",
            "precipitation_probability_max",
            "windspeed_10m_max",
        ]),
        "forecast_days": days,
        "timezone": "auto",
    }
    try:
        response = await open_meteo_access.fetch("forecast", params, timeout=TIMEOUT)
    except httpx.RequestError as exc:
        logger.error("Open-Meteo request error: %s", exc)
        raise HTTPException(status_code=502, detail="Weather service request failed.")
    if response.status_code != 200:
        logger.error("Open-Meteo returned HTTP %d: %s", response.status_code, response.text[:200])
        raise HTTPException(status_code=502, detail="Weather service returned an error.")
    try:
        data = response.json()
    except Exception as exc:
        logger.error("Open-Meteo non‑JSON response: %s", exc)
        raise HTTPException(status_code=502, detail="Weather service returned invalid data.")
    return data

@router.get("/api/forecast", response_model=ForecastResponse)
async def get_forecast(
    latitude: float = Query(..., ge=-90.0, le=90.0, description="Latitude in decimal degrees (-90 to 90)"),
    longitude: float = Query(..., ge=-180.0, le=180.0, description="Longitude in decimal degrees (-180 to 180)"),
    days: int = Query(7, ge=1, le=7, description="Number of forecast days (1-7); the UI shows all 7"),
) -> ForecastResponse:
    """Return a daily forecast for the requested location.

    The response conforms to ``ForecastResponse`` defined in ``backend/models/forecast.py``.
    """
    raw = await _fetch_daily(latitude, longitude, days)
    # Build DailyForecast objects
    daily_list = []
    times = raw.get("daily", {}).get("time", [])
    for i in range(min(days, len(times))):
        # Parse ISO date string to ``date``
        try:
            date_obj = datetime.fromisoformat(times[i]).date()
        except Exception:
            date_obj = None
        daily = DailyForecast(
            date=date_obj,
            weather_code=raw["daily"]["weather_code"][i],
            max_temperature=raw["daily"]["temperature_2m_max"][i],
            min_temperature=raw["daily"]["temperature_2m_min"][i],
            precipitation_sum=raw["daily"]["precipitation_sum"][i],
            precipitation_probability_max=raw["daily"]["precipitation_probability_max"][i],
            max_wind_speed=raw["daily"]["windspeed_10m_max"][i],
        )
        daily_list.append(daily)
    return ForecastResponse(
        latitude=raw["latitude"],
        longitude=raw["longitude"],
        timezone=raw["timezone"],
        retrieved_at=datetime.now(tz=timezone.utc),
        daily=daily_list,
    )

