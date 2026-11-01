"""
Open-Meteo weather data fetcher.

Architecture:
  Open-Meteo → httpx → validated dict → Pydantic (WeatherResponse)

The LLM layer NEVER sources weather facts. This module is the
single source of meteorological truth for the WeatherGPT backend.
"""

import logging
from typing import Any

import httpx

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast"

# Fields requested from the Open-Meteo API
CURRENT_VARIABLES = [
    "temperature_2m",
    "relative_humidity_2m",
    "precipitation",
    "wind_speed_10m",
    "wind_direction_10m",
    "weather_code",
]

HOURLY_VARIABLES = [
    "temperature_2m",
    "precipitation_probability",
    "precipitation",
    "wind_speed_10m",
    "weather_code",
    "relative_humidity_2m",
    "wind_direction_10m",
]

# 7-day hourly forecast (today + 6 days), enough for every weekday name.
FORECAST_DAYS = 7

# Timeout in seconds (connect + read)
TIMEOUT = httpx.Timeout(connect=5.0, read=15.0, write=5.0, pool=5.0)


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _require(data: dict, *keys: str) -> None:
    """Raise ValueError if any top-level key is missing from *data*."""
    missing = [k for k in keys if k not in data]
    if missing:
        raise ValueError(f"Open-Meteo response missing expected fields: {missing}")


def _require_nested(parent: dict, parent_key: str, *keys: str) -> None:
    """Raise ValueError if any key is missing inside data[parent_key]."""
    block = parent.get(parent_key, {})
    missing = [k for k in keys if k not in block]
    if missing:
        raise ValueError(
            f"Open-Meteo response missing '{parent_key}' fields: {missing}"
        )


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


async def fetch_weather(latitude: float, longitude: float) -> dict[str, Any]:
    """
    Fetch current + 7-day hourly weather from Open-Meteo for the given
    coordinates.

    Returns a plain dict ready to be parsed into ``WeatherResponse``.

    Raises:
        RuntimeError: on any network, HTTP, or data-structure error.
                      The original cause is logged but not forwarded to
                      avoid leaking implementation details to the frontend.
    """
    params: dict[str, Any] = {
        "latitude": latitude,
        "longitude": longitude,
        "current": ",".join(CURRENT_VARIABLES),
        "hourly": ",".join(HOURLY_VARIABLES),
        "forecast_days": FORECAST_DAYS,
        "timezone": "auto",
    }

    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            response = await client.get(OPEN_METEO_URL, params=params)
    except httpx.TimeoutException as exc:
        logger.error("Open-Meteo request timed out: %s", exc)
        raise RuntimeError(
            "Weather service did not respond in time. Please try again."
        ) from exc
    except httpx.ConnectError as exc:
        logger.error("Open-Meteo connection error: %s", exc)
        raise RuntimeError(
            "Could not connect to the weather service. Check network connectivity."
        ) from exc
    except httpx.RequestError as exc:
        logger.error("Open-Meteo request error: %s", exc)
        raise RuntimeError("Weather service request failed.") from exc

    # --- HTTP-level errors --------------------------------------------------
    if response.status_code != 200:
        logger.error(
            "Open-Meteo returned HTTP %d: %s", response.status_code, response.text[:300]
        )
        raise RuntimeError(
            f"Weather service returned an unexpected status ({response.status_code})."
        )

    # --- JSON parse ---------------------------------------------------------
    try:
        data: dict = response.json()
    except Exception as exc:
        logger.error("Open-Meteo returned non-JSON body: %s", exc)
        raise RuntimeError("Weather service returned an unreadable response.") from exc

    # --- Schema sanity checks -----------------------------------------------
    try:
        _require(data, "latitude", "longitude", "timezone", "current", "hourly")
        _require_nested(data, "current", *CURRENT_VARIABLES)
        _require_nested(data, "hourly", "time", *HOURLY_VARIABLES)
    except ValueError as exc:
        logger.error("Open-Meteo schema mismatch: %s", exc)
        raise RuntimeError(
            "Weather service returned data in an unexpected format."
        ) from exc

    logger.info(
        "Fetched weather for (%.4f, %.4f) — timezone=%s",
        latitude,
        longitude,
        data.get("timezone"),
    )
    return data
