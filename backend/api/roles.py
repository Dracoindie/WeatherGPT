"""
Role endpoints:

GET  /api/farm      – spraying / irrigation / harvest / sowing guidance
GET  /api/aviation  – aviation weather briefing (current + next 6 h)
POST /api/risk      – severity across a list of districts, most severe first
GET  /api/compare   – GFS vs Open-Meteo for the same valid hours

All values come from Open-Meteo / NOAA NOMADS; the rules are deterministic
thresholds (docs/ROLE_ADVISORIES.md) and every response is labelled guidance.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import JSONResponse

from models.roles import AviationBriefing, FarmAdvice, ModelComparison, RiskBoard, RiskRequest
from models.weather import WeatherResponse
from query_service import fetch_validated_weather
from roles.aviation import aviation_briefing
from roles.farm import farm_advice
from roles.risk import risk_board

logger = logging.getLogger(__name__)

router = APIRouter(tags=["roles"])

Lat = Query(..., ge=-90.0, le=90.0)
Lon = Query(..., ge=-180.0, le=180.0)


async def _weather(latitude: float, longitude: float) -> WeatherResponse:
    try:
        return await fetch_validated_weather(latitude, longitude)
    except RuntimeError as exc:
        logger.error("Role endpoint weather fetch failed: %s", exc)
        raise HTTPException(status_code=503, detail="Weather service is temporarily unavailable.") from exc


@router.get("/api/farm", response_model=FarmAdvice)
async def farm(latitude: float = Lat, longitude: float = Lon) -> FarmAdvice:
    return farm_advice(await _weather(latitude, longitude))


@router.get("/api/aviation", response_model=AviationBriefing)
async def aviation(latitude: float = Lat, longitude: float = Lon) -> AviationBriefing:
    return aviation_briefing(await _weather(latitude, longitude))


@router.post("/api/risk", response_model=RiskBoard)
async def risk(body: RiskRequest) -> RiskBoard:
    return await risk_board(body.districts)


@router.get(
    "/api/compare",
    response_model=ModelComparison,
    responses={503: {"description": "GFS (NWP) unavailable on this server"}},
)
async def compare(
    latitude: float = Lat,
    longitude: float = Lon,
    hours: int = Query(24, ge=2, le=48),
):
    try:
        from nwp.service import get_nwp_forecast
        from roles.compare import compare_models
    except (ImportError, RuntimeError, OSError) as exc:
        logger.warning("Model comparison unavailable: %s", exc)
        return JSONResponse(status_code=503, content={"detail": "NWP unavailable", "available": False})
    weather = await _weather(latitude, longitude)
    try:
        gfs = await get_nwp_forecast(latitude, longitude, hours)
    except Exception as exc:
        logger.error("GFS fetch for comparison failed: %s", exc)
        return JSONResponse(status_code=503, content={"detail": "GFS data temporarily unavailable", "available": False})
    return compare_models(weather, gfs)
