"""
WeatherGPT FastAPI application entry-point.

Endpoints
---------
GET /            – service info
GET /health      – liveness probe
GET /api/weather – real-time weather from Open-Meteo
"""

import logging
import os
from pathlib import Path

from dotenv import load_dotenv

# backend/.env, if present. Real environment variables take precedence.
load_dotenv(Path(__file__).with_name(".env"))

from fastapi import FastAPI, HTTPException, Query  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402
from fastapi.responses import JSONResponse  # noqa: E402

from models.weather import WeatherResponse  # noqa: E402
from query_service import fetch_validated_weather  # noqa: E402
from api.chat import router as chat_router  # noqa: E402
from api.forecast import router as forecast_router  # noqa: E402
from api.alerts import router as alerts_router  # noqa: E402
from api.climate import router as climate_router  # noqa: E402
from api.roles import router as roles_router  # noqa: E402
from api.dissemination import router as dissemination_router  # noqa: E402
from api.air import router as air_router  # noqa: E402
from api.geocode import router as geocode_router  # noqa: E402

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

from env_check import warn_misnamed_env_vars  # noqa: E402

warn_misnamed_env_vars()

# /api/nwp needs xarray + cfgrib (and the eccodes library); the API starts without them.
try:
    import cfgrib  # noqa: F401  (raises RuntimeError if the eccodes library is missing)

    from api.nwp import router as nwp_router
except (ImportError, RuntimeError, OSError) as exc:
    nwp_router = None
    logger.warning("NWP endpoint disabled: %s", exc)

DEFAULT_ALLOWED_ORIGINS = ["http://localhost:3000", "http://127.0.0.1:3000"]


def allowed_origins() -> list[str]:
    """CORS origins from ALLOWED_ORIGINS (comma-separated), else the local dev defaults."""
    raw = os.getenv("ALLOWED_ORIGINS", "")
    origins = [o.strip().rstrip("/") for o in raw.split(",") if o.strip()]
    return origins or DEFAULT_ALLOWED_ORIGINS

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
    allow_origins=allowed_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register routers
app.include_router(chat_router)
app.include_router(forecast_router)
if nwp_router is not None:
    app.include_router(nwp_router)
else:

    @app.get("/api/nwp", tags=["NWP"], status_code=503)
    async def nwp_unavailable() -> JSONResponse:
        """Stand-in when xarray/cfgrib/eccodes are missing: a clear 503 instead of a 404."""
        return JSONResponse(
            status_code=503,
            content={"detail": "NWP unavailable", "available": False},
        )
app.include_router(alerts_router)
app.include_router(climate_router)
app.include_router(roles_router)
app.include_router(dissemination_router)
app.include_router(air_router)
app.include_router(geocode_router)


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
    """Liveness probe for the host (Render/Railway health check).

    ``nwp`` says whether GFS decoding is available in this build; it is false
    in an image built with WITH_NWP=0, where /api/nwp returns a clean 503.
    """
    return {
        "status": "ok",
        "service": "WeatherGPT API",
        "nwp": nwp_router is not None,
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
    Return current + 7-day hourly weather for the requested coordinates.

    Data source: Open-Meteo public forecast API (no API key required).

    The LLM layer MUST use this response as the authoritative source of
    weather facts and MUST NOT generate or override any field values.
    """
    try:
        return await fetch_validated_weather(latitude, longitude)
    except RuntimeError as exc:
        # fetch_weather already logged the internal cause
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except Exception as exc:
        logger.error("Failed to build WeatherResponse: %s", exc)
        raise HTTPException(
            status_code=500,
            detail="Failed to process weather data. Please try again.",
        ) from exc
