import json
import time
from datetime import date, datetime
from typing import List, Optional

import httpx
from pydantic import ValidationError

from models.climate import ClimateResponse, HistoricalDaily
from http_tls import SSL_CONTEXT

BASE_URL = "https://archive-api.open-meteo.com/v1/archive"

async def fetch_historical_weather(
    latitude: float,
    longitude: float,
    start_date: str,
    end_date: str,
    timezone: str = "auto",
) -> ClimateResponse:
    """Fetch daily historical weather from Open-Meteo Archive API.

    Parameters
    ----------
    latitude, longitude: float – location coordinates.
    start_date, end_date: ISO ``YYYY-MM-DD`` strings.
    timezone: optional timezone for response (default ``auto``).

    Returns
    -------
    ClimateResponse – typed response containing daily aggregates.
    """
    params = {
        "latitude": latitude,
        "longitude": longitude,
        "start_date": start_date,
        "end_date": end_date,
        "daily": [
            "temperature_2m_max",
            "temperature_2m_min",
            "precipitation_sum",
        ],
        "timezone": timezone,
    }
    start = time.time()
    async with httpx.AsyncClient(verify=SSL_CONTEXT) as client:
        resp = await client.get(BASE_URL, params=params, timeout=20.0)
        resp.raise_for_status()
        data = resp.json()
    # Build list of HistoricalDaily entries
    daily_raw = data.get("daily", {})
    dates: List[str] = daily_raw.get("time", [])
    temps_max: List[Optional[float]] = daily_raw.get("temperature_2m_max", [])
    temps_min: List[Optional[float]] = daily_raw.get("temperature_2m_min", [])
    precip: List[Optional[float]] = daily_raw.get("precipitation_sum", [])

    daily_records: List[HistoricalDaily] = []
    for i, d in enumerate(dates):
        daily_records.append(
            HistoricalDaily(
                date=datetime.strptime(d, "%Y-%m-%d").date(),
                temperature_max=temps_max[i] if i < len(temps_max) else None,
                temperature_min=temps_min[i] if i < len(temps_min) else None,
                precipitation_sum=precip[i] if i < len(precip) else None,
            )
        )
    generation_time = time.time() - start
    response = ClimateResponse(
        latitude=data.get("latitude", latitude),
        longitude=data.get("longitude", longitude),
        timezone=data.get("timezone", "UTC"),
        generation_time=generation_time,
        daily=daily_records,
    )
    return response
