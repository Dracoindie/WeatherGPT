"""
Weather for a grid of points over the visible map (GET /api/map/grid).

The grid is made of the shared fixed tiles in maps/tiles.py: every user whose
view touches a tile shares its cache entry, and missing tiles are fetched in
ONE batched Open-Meteo request. At most 100 points (4 tiles).

Every value returned is Open-Meteo's, except ``heat_index``, which is computed
from Open-Meteo's temperature and humidity (maps/heat_index.py).
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Optional

from pydantic import BaseModel, Field

from maps import tiles as T
from maps.heat_index import heat_index_c
from maps.tiles import GridSpecError  # noqa: F401  (re-exported for api/map.py)
from thresholds import heat_bands_table

logger = logging.getLogger(__name__)

MAX_POINTS = T.MAX_POINTS
DEFAULT_POINTS = T.MAX_POINTS
MIN_POINTS = 4
HOURS = T.HOURS
STEP_LADDER = T.STEP_LADDER

# Open-Meteo's best_match over India snaps to cells about 0.070° apart
# (≈ 7.8 km; measured for Pune on 2026-11-03 from the returned coordinates).
MODEL_GRID_KM = 8

NOTE = (
    "Open-Meteo model values at grid points; the map interpolates between them. "
    "Estimated, not official IMD data."
)


class GridPoint(BaseModel):
    latitude: float = Field(..., description="Grid latitude (a multiple of step_deg)")
    longitude: float = Field(..., description="Grid longitude (a multiple of step_deg)")
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
    recorded_at: Optional[str] = Field(None, description="Set when served from demo-replay fixtures")
    note: str = NOTE


def clear_cache() -> None:
    T.clear_cache()


def plan_grid(south: float, west: float, north: float, east: float, max_points: int) -> tuple[float, float, float, int, int]:
    """(step, south0, west0, rows, cols) of the tile-aligned grid covering the box."""
    p = T.plan(south, west, north, east, max_points)
    rows = (p.row1 - p.row0 + 1) * T.TILE_POINTS
    cols = (p.col1 - p.col0 + 1) * T.TILE_POINTS
    return p.step, round(p.row0 * p.span, 4), round(p.col0 * p.span, 4), rows, cols


def window(values: list[Optional[float]], offset: int, n: int) -> list[Optional[float]]:
    """n values from a tile series, starting at the tile's first common hour."""
    return [values[offset + i] if offset + i < len(values) else None for i in range(n)]


async def fetch_grid(south: float, west: float, north: float, east: float, max_points: int = DEFAULT_POINTS) -> GridResponse:
    """Weather for every grid point covering the box. Raises GridSpecError or RuntimeError."""
    p = T.plan(south, west, north, east, max_points)
    tiles = await T.get_tiles(p.keys)
    times, pts = T.assemble(p, tiles)
    n = len(times)
    points = []
    for tp, off in pts:
        temp = window(tp.hourly["temperature_2m"], off, n)
        rh = window(tp.hourly["relative_humidity_2m"], off, n)
        points.append(
            GridPoint(
                latitude=tp.latitude,
                longitude=tp.longitude,
                elevation=tp.elevation,
                temperature_2m=temp,
                relative_humidity_2m=rh,
                apparent_temperature=window(tp.hourly["apparent_temperature"], off, n),
                precipitation=window(tp.hourly["precipitation"], off, n),
                precipitation_probability=window(tp.hourly["precipitation_probability"], off, n),
                wind_speed_10m=window(tp.hourly["wind_speed_10m"], off, n),
                wind_direction_10m=window(tp.hourly["wind_direction_10m"], off, n),
                heat_index=[heat_index_c(t, h) for t, h in zip(temp, rh)],
            )
        )
    step = p.step
    s0, w0 = round(p.row0 * p.span, 4), round(p.col0 * p.span, 4)
    rows = (p.row1 - p.row0 + 1) * T.TILE_POINTS
    cols = (p.col1 - p.col0 + 1) * T.TILE_POINTS
    return GridResponse(
        retrieved_at=min(t.fetched_at for t in tiles.values()) if tiles else datetime.now(tz=timezone.utc),
        south=s0,
        west=w0,
        north=round(s0 + (rows - 1) * step, 4),
        east=round(w0 + (cols - 1) * step, 4),
        step_deg=step,
        spacing_km=round(step * 111.32, 1),
        rows=rows,
        cols=cols,
        times=[f"{t}Z" for t in times],
        points=points,
        heat_index_bands=heat_bands_table(),
        recorded_at=T.recorded_at(tiles),
    )
