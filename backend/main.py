"""
WeatherGPT FastAPI application entry-point.

Endpoints
---------
GET /            – service info
GET /health      – liveness probe
GET /api/weather – real-time weather from Open-Meteo
"""

import logging
from datetime import datetime, timezone

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from models.weather import CurrentWeather, HourlyWeather, WeatherResponse
from weather.open_meteo import fetch_weather
from api.chat import router as chat_router
from api.forecast import router as forecast_router
from api.nwp import router as nwp_router
from api.alerts import router as alerts_router
from api.climate import router as climate_router

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------

app = FastAPI(
    title="WeatherGPT API",
    version="0.1.0",
    description="SIH 2026 WeatherGPT prototype backend",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register routers
app.include_router(chat_router)
app.include_router(forecast_router)
app.include_router(nwp_router)
app.include_router(alerts_router)
app.include_router(climate_router)


# ---------------------------------------------------------------------------
# Existing endpoints (unchanged)
# ---------------------------------------------------------------------------


@app.get("/")
def root():
    return {
        "service": "WeatherGPT API",
        "status": "running",
        "version": "0.1.0",
    }


@app.get("/health")
def health():
    return {
        "status": "ok",
        "service": "WeatherGPT API",
    }


# ---------------------------------------------------------------------------
# Weather endpoint
# ---------------------------------------------------------------------------


@app.get("/api/weather", response_model=WeatherResponse)
async def get_weather(
    latitude: float = Query(
        ...,
        ge=-90.0,
        le=90.0,
        description="Latitude in decimal degrees (−90 to 90)",
    ),
    longitude: float = Query(
        ...,
        ge=-180.0,
        le=180.0,
        description="Longitude in decimal degrees (−180 to 180)",
    ),
) -> WeatherResponse:
    """
    Return current + 3-day hourly weather for the requested coordinates.

    Data source: Open-Meteo public forecast API (no API key required).

    The LLM layer MUST use this response as the authoritative source of
    weather facts and MUST NOT generate or override any field values.
    """
    try:
        raw = await fetch_weather(latitude, longitude)
    except RuntimeError as exc:
        # fetch_weather already logged the internal cause
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    # Build typed sub-models from the raw Open-Meteo payload
    try:
        current = CurrentWeather(**raw["current"])
        hourly = HourlyWeather(**raw["hourly"])

        response = WeatherResponse(
            latitude=raw["latitude"],
            longitude=raw["longitude"],
            timezone=raw["timezone"],
            retrieved_at=datetime.now(tz=timezone.utc),
            current=current,
            hourly=hourly,
        )
    except Exception as exc:
        logger.error("Failed to build WeatherResponse: %s", exc)
        raise HTTPException(
            status_code=500,
            detail="Failed to process weather data. Please try again.",
        ) from exc

    return response
