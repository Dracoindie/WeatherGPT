"""
Map data for /map (docs/VISION.md, step 1):

- GET /api/map/point: weather at a tapped point (temperature, feels-like,
  humidity, wind, rain chance, AQI, UV, heat index, local time)
- GET /api/map/grid: hourly weather for the next 72 h at a grid of points over
  the visible box, in one batched Open-Meteo request (at most 100 points)
- GET /api/map/hazard: hazard level per H3 cell for a 24 h window
- GET /api/map/hazard/summary: hazard within a radius of a place
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query, Response

from maps.grid import DEFAULT_POINTS, MAX_POINTS, MIN_POINTS, GridResponse, GridSpecError, fetch_grid
from maps.hazard import DEFAULT_RADIUS_KM, HazardResponse, HazardSummary, fetch_hazard, hazard_summary
from maps.point import PointWeather, point_weather

# Same header as demo_replay.REPLAY_HEADER (not imported: demo_replay pulls in the chat stack).
REPLAY_HEADER = "X-WeatherGPT-Replay"

router = APIRouter(tags=["map"])


@router.get("/api/map/point", response_model=PointWeather, responses={503: {"description": "Weather unavailable"}})
async def map_point(
    latitude: float = Query(..., ge=-90.0, le=90.0),
    longitude: float = Query(..., ge=-180.0, le=180.0),
) -> PointWeather:
    try:
        return await point_weather(latitude, longitude)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail="Weather for this point is temporarily unavailable.") from exc


@router.get(
    "/api/map/grid",
    response_model=GridResponse,
    responses={422: {"description": "Bad or too large box"}, 503: {"description": "Weather unavailable"}},
)
async def map_grid(
    response: Response,
    south: float = Query(..., ge=-85.0, le=85.0),
    west: float = Query(..., ge=-180.0, le=180.0),
    north: float = Query(..., ge=-85.0, le=85.0),
    east: float = Query(..., ge=-180.0, le=180.0),
    max_points: int = Query(DEFAULT_POINTS, ge=MIN_POINTS, le=MAX_POINTS),
) -> GridResponse:
    if north <= south or east <= west:
        raise HTTPException(status_code=422, detail="The box must have north > south and east > west.")
    try:
        grid = await fetch_grid(south, west, north, east, max_points)
    except GridSpecError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail="Map weather is temporarily unavailable.") from exc
    if grid.recorded_at:
        response.headers[REPLAY_HEADER] = grid.recorded_at
    return grid


@router.get(
    "/api/map/hazard",
    response_model=HazardResponse,
    responses={422: {"description": "Bad or too large box"}, 503: {"description": "Weather unavailable"}},
)
async def map_hazard(
    response: Response,
    south: float = Query(..., ge=-85.0, le=85.0),
    west: float = Query(..., ge=-180.0, le=180.0),
    north: float = Query(..., ge=-85.0, le=85.0),
    east: float = Query(..., ge=-180.0, le=180.0),
    hour: int = Query(0, ge=0, le=71, description="Window start, hours from now (24 h window)"),
) -> HazardResponse:
    """Hazard level per H3 cell for the 24 h from `hour`, scored with thresholds.py."""
    if north <= south or east <= west:
        raise HTTPException(status_code=422, detail="The box must have north > south and east > west.")
    try:
        result = await fetch_hazard(south, west, north, east, hour)
    except GridSpecError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail="Map hazards are temporarily unavailable.") from exc
    if result.recorded_at:
        response.headers[REPLAY_HEADER] = result.recorded_at
    return result


@router.get("/api/map/hazard/summary", response_model=HazardSummary, responses={503: {"description": "Weather unavailable"}})
async def map_hazard_summary(
    response: Response,
    latitude: float = Query(..., ge=-85.0, le=85.0),
    longitude: float = Query(..., ge=-180.0, le=180.0),
    radius_km: float = Query(DEFAULT_RADIUS_KM, ge=5.0, le=100.0),
    hour: int = Query(0, ge=0, le=71),
) -> HazardSummary:
    """Cells per level within radius_km, the most rain, and the worst level now and ahead."""
    try:
        result = await hazard_summary(latitude, longitude, radius_km, hour)
    except GridSpecError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail="Map hazards are temporarily unavailable.") from exc
    if result.recorded_at:
        response.headers[REPLAY_HEADER] = result.recorded_at
    return result


@router.get("/api/map/demo-region")
async def map_demo_region() -> dict:
    """The offline demo region (docs/DEMO.md) and the zoom levels the web app precaches."""
    from maps.demo import DEMO_REGION, MAX_ZOOM, MIN_ZOOM

    return {**DEMO_REGION, "min_zoom": MIN_ZOOM, "max_zoom": MAX_ZOOM}
