"""
Weather for a grid of points over the visible map, in ONE Open-Meteo request.

Open-Meteo accepts comma-separated latitude/longitude lists and answers with a
JSON array, one object per point. The grid is snapped to a ladder of steps so
that panning a little asks for the same grid again and hits the cache, and it
never has more than MAX_POINTS points (each point counts against Open-Meteo's
free-tier limits).

Every value returned is Open-Meteo's, except ``heat_index``, which is computed
from Open-Meteo's temperature and humidity (maps/heat_index.py).
"""

from __future__ import annotations

import logging
import math
import time
from datetime import datetime, timezone
from typing import Any, Optional

import httpx
from pydantic import BaseModel, Field, ValidationError

from http_tls import SSL_CONTEXT
from maps.heat_index import heat_index_c
from thresholds import heat_bands_table
from weather.open_meteo import OPEN_METEO_URL, TIMEOUT

logger = logging.getLogger(__name__)

MAX_POINTS = 100
DEFAULT_POINTS = 64
MIN_POINTS = 4
HOURS = 72
CACHE_TTL_S = 15 * 60
CACHE_MAX_ENTRIES = 64

# Grid steps in degrees. The smallest is about the model grid: a finer sample
# would only repeat the same model cell.
STEP_LADDER = (0.08, 0.1, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5, 0.75, 1.0, 1.5, 2.0, 3.0, 4.0, 5.0)

# Open-Meteo's best_match over India snaps to cells about 0.070° apart
# (≈ 7.8 km; measured for Pune on 2026-11-03 from the returned coordinates).
MODEL_GRID_KM = 8

HOURLY = [
    "temperature_2m",
    "relative_humidity_2m",
    "apparent_temperature",
    "precipitation",
    "precipitation_probability",
    "wind_speed_10m",
    "wind_direction_10m",
]

NOTE = (
    "Open-Meteo model values at grid points; the map interpolates between them. "
    "Estimated, not official IMD data."
)

_cache: dict[tuple, tuple[float, "GridResponse"]] = {}


class GridSpecError(ValueError):
    """The requested box cannot be covered within MAX_POINTS."""


class GridPoint(BaseModel):
    latitude: float = Field(..., description="Requested grid latitude")
    longitude: float = Field(..., description="Requested grid longitude")
    elevation: Optional[float] = Field(None, description="Open-Meteo elevation (m)")
    temperature_2m: list[Optional[float]]
    relative_humidity_2m: list[Optional[float]]
    apparent_temperature: list[Optional[float]]
    precipitation: list[Optional[float]]
    precipitation_probability: list[Optional[float]]
    wind_speed_10m: list[Optional[float]]
    wind_direction_10m: list[Optional[float]]
    heat_index: list[Optional[float]] = Field(..., description="Computed from temperature and humidity (°C)")


class GridResponse(BaseModel):
    source: str = "open-meteo"
    retrieved_at: datetime
    south: float
    west: float
    north: float
    east: float
    step_deg: float
    spacing_km: float = Field(..., description="Distance between sample points (north-south)")
    model_grid_km: int = MODEL_GRID_KM
    rows: int
    cols: int
    times: list[str] = Field(..., description="UTC hours, ISO 8601 with Z")
    points: list[GridPoint] = Field(..., description="Row-major, south to north, west to east")
    heat_index_bands: list[dict]
    note: str = NOTE


def clear_cache() -> None:
    _cache.clear()


def plan_grid(south: float, west: float, north: float, east: float, max_points: int) -> tuple[float, float, float, int, int]:
    """(step, south0, west0, rows, cols): the finest ladder step that covers the box."""
    max_points = max(MIN_POINTS, min(MAX_POINTS, max_points))
    for step in STEP_LADDER:
        # The step depends only on the box size (worst-case alignment), so a
        # pan keeps the step and, inside one cell, the whole grid.
        if (math.floor((north - south) / step) + 2) * (math.floor((east - west) / step) + 2) > max_points:
            continue
        s0 = math.floor(round(south / step, 6)) * step
        w0 = math.floor(round(west / step, 6)) * step
        rows = max(math.ceil(round((north - s0) / step, 6)) + 1, 2)
        cols = max(math.ceil(round((east - w0) / step, 6)) + 1, 2)
        return step, round(s0, 4), round(w0, 4), rows, cols
    raise GridSpecError("The area is too large for the map grid; zoom in.")


def _series(block: dict, key: str, n: int) -> list[Optional[float]]:
    values = block.get(key) or []
    return [values[i] if i < len(values) else None for i in range(n)]


async def _fetch(lats: list[float], lons: list[float]) -> list[dict[str, Any]]:
    params = {
        "latitude": ",".join(f"{v:.4f}" for v in lats),
        "longitude": ",".join(f"{v:.4f}" for v in lons),
        "hourly": ",".join(HOURLY),
        "forecast_hours": HOURS,
        "timezone": "GMT",
    }
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT, verify=SSL_CONTEXT) as client:
            resp = await client.get(OPEN_METEO_URL, params=params)
    except httpx.RequestError as exc:
        logger.error("Open-Meteo grid request failed: %s", exc)
        raise RuntimeError("Weather service did not respond.") from exc
    if resp.status_code != 200:
        logger.error("Open-Meteo grid returned HTTP %d: %s", resp.status_code, resp.text[:300])
        raise RuntimeError(f"Weather service returned an unexpected status ({resp.status_code}).")
    try:
        data = resp.json()
    except ValueError as exc:
        raise RuntimeError("Weather service returned an unreadable response.") from exc
    # One point comes back as an object, several as a list.
    items = data if isinstance(data, list) else [data]
    if len(items) != len(lats):
        raise RuntimeError("Weather service returned data in an unexpected format.")
    return items


async def fetch_grid(south: float, west: float, north: float, east: float, max_points: int = DEFAULT_POINTS) -> GridResponse:
    """Weather for every grid point in the box. Raises GridSpecError or RuntimeError."""
    step, s0, w0, rows, cols = plan_grid(south, west, north, east, max_points)
    key = (step, s0, w0, rows, cols)
    hit = _cache.get(key)
    if hit and hit[0] > time.monotonic():
        return hit[1]

    lats = [round(s0 + r * step, 4) for r in range(rows) for _ in range(cols)]
    lons = [round(w0 + c * step, 4) for _ in range(rows) for c in range(cols)]
    items = await _fetch(lats, lons)

    try:
        hourly0 = items[0]["hourly"]
        times = [f"{t}Z" for t in hourly0["time"][:HOURS]]
        n = len(times)
        points = []
        for lat, lon, item in zip(lats, lons, items):
            block = item["hourly"]
            temp = _series(block, "temperature_2m", n)
            rh = _series(block, "relative_humidity_2m", n)
            points.append(
                GridPoint(
                    latitude=lat,
                    longitude=lon,
                    elevation=item.get("elevation"),
                    temperature_2m=temp,
                    relative_humidity_2m=rh,
                    apparent_temperature=_series(block, "apparent_temperature", n),
                    precipitation=_series(block, "precipitation", n),
                    precipitation_probability=_series(block, "precipitation_probability", n),
                    wind_speed_10m=_series(block, "wind_speed_10m", n),
                    wind_direction_10m=_series(block, "wind_direction_10m", n),
                    heat_index=[heat_index_c(t, h) for t, h in zip(temp, rh)],
                )
            )
    except (KeyError, TypeError, IndexError, ValidationError) as exc:
        logger.error("Open-Meteo grid schema mismatch: %s", exc)
        raise RuntimeError("Weather service returned data in an unexpected format.") from exc

    result = GridResponse(
        retrieved_at=datetime.now(tz=timezone.utc),
        south=s0,
        west=w0,
        north=round(s0 + (rows - 1) * step, 4),
        east=round(w0 + (cols - 1) * step, 4),
        step_deg=step,
        spacing_km=round(step * 111.32, 1),
        rows=rows,
        cols=cols,
        times=times,
        points=points,
        heat_index_bands=heat_bands_table(),
    )
    if len(_cache) >= CACHE_MAX_ENTRIES:
        _cache.pop(next(iter(_cache)))
    _cache[key] = (time.monotonic() + CACHE_TTL_S, result)
    return result
