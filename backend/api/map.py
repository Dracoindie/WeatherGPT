"""
Map data for /map (docs/VISION.md, step 1):

- GET /api/map/point: weather at a tapped point (temperature, feels-like,
  humidity, wind, rain chance, AQI, UV, heat index, local time)
- GET /api/map/grid: hourly weather for the next 72 h at a grid of points over
  the visible box, in one batched Open-Meteo request (at most 100 points)
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query, Response

from maps.grid import DEFAULT_POINTS, MAX_POINTS, MIN_POINTS, GridResponse, GridSpecError, fetch_grid
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
