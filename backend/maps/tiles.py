"""
Fixed weather tiles shared by every map user.

The world is cut into tiles of TILE_POINTS x TILE_POINTS grid points for each
step on STEP_LADDER. A tile's points sit at exact multiples of the step, and a
tile's key is (step, row, col), so two people looking at overlapping areas ask
for the same tiles and share the cache. Only missing tiles go to Open-Meteo, in
ONE batched request (comma-separated coordinates).

Each tile keeps 72 hourly values (UTC) plus the model's current values, for:
temperature, humidity, feels-like, rain, rain probability, wind speed and
direction, and the WMO weather code. Every number is Open-Meteo's.
"""

from __future__ import annotations

import logging
import math
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable, Optional

import httpx

import open_meteo_access
from http_tls import SSL_CONTEXT
from weather.open_meteo import TIMEOUT

logger = logging.getLogger(__name__)

TILE_POINTS = 5
MAX_POINTS = 100  # at most 4 tiles per request
HOURS = 72
CACHE_TTL_S = 15 * 60
CACHE_MAX_TILES = 400

# Grid steps in degrees. The smallest is about the model grid (~8 km): a finer
# sample would only repeat the same model cell.
STEP_LADDER = (0.08, 0.1, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5, 0.75, 1.0, 1.5, 2.0, 3.0, 4.0, 5.0, 6.0, 8.0)

HOURLY = [
    "temperature_2m",
    "relative_humidity_2m",
    "apparent_temperature",
    "precipitation",
    "precipitation_probability",
    "wind_speed_10m",
    "wind_direction_10m",
    "weather_code",
]
CURRENT = ["temperature_2m", "relative_humidity_2m", "precipitation", "wind_speed_10m", "weather_code"]

TileKey = tuple[float, int, int]  # (step, row, col)


class GridSpecError(ValueError):
    """The requested box cannot be covered within the point limit."""


@dataclass
class TilePoint:
    latitude: float
    longitude: float
    elevation: Optional[float]
    hourly: dict[str, list[Optional[float]]]
    current: dict[str, Optional[float]]


@dataclass
class Tile:
    key: TileKey
    times: list[str]  # UTC hours, "YYYY-MM-DDTHH:MM" (no zone suffix)
    points: list[TilePoint]  # row-major, south to north, west to east
    fetched_at: datetime
    recorded_at: Optional[str] = None  # set when served from a demo-replay fixture


@dataclass
class TilePlan:
    step: float
    row0: int
    row1: int
    col0: int
    col1: int
    keys: list[TileKey] = field(default_factory=list)

    @property
    def span(self) -> float:
        return TILE_POINTS * self.step


_cache: dict[TileKey, tuple[float, Tile]] = {}

# Demo replay hook (demo_replay installs a loader); None in normal operation.
fixture_loader: Optional[Callable[[TileKey], Optional[Tile]]] = None
fixture_saver: Optional[Callable[[Tile], None]] = None


def clear_cache() -> None:
    _cache.clear()


def _r(v: float) -> float:
    return round(v, 4)


def plan(south: float, west: float, north: float, east: float, max_points: int = MAX_POINTS) -> TilePlan:
    """The finest step whose covering tiles stay within max_points."""
    max_points = max(TILE_POINTS * TILE_POINTS, min(MAX_POINTS, max_points))
    for step in STEP_LADDER:
        span = TILE_POINTS * step
        last = (TILE_POINTS - 1) * step
        row0 = math.floor(round(south / span, 6))
        col0 = math.floor(round(west / span, 6))
        # the last tile's last point must reach the box edge
        row1 = max(row0, math.ceil(round((north - last) / span, 6)))
        col1 = max(col0, math.ceil(round((east - last) / span, 6)))
        n = (row1 - row0 + 1) * (col1 - col0 + 1) * TILE_POINTS * TILE_POINTS
        if n <= max_points:
            keys = [(step, r, c) for r in range(row0, row1 + 1) for c in range(col0, col1 + 1)]
            return TilePlan(step, row0, row1, col0, col1, keys)
    raise GridSpecError("The area is too large for the map grid; zoom in.")


def tile_coords(key: TileKey) -> tuple[list[float], list[float]]:
    step, row, col = key
    lats = [_r((row * TILE_POINTS + i) * step) for i in range(TILE_POINTS) for _ in range(TILE_POINTS)]
    lons = [_r((col * TILE_POINTS + j) * step) for _ in range(TILE_POINTS) for j in range(TILE_POINTS)]
    return lats, lons


async def _fetch(lats: list[float], lons: list[float]) -> list[dict[str, Any]]:
    base = {
        "latitude": ",".join(f"{v:.4f}" for v in lats),
        "longitude": ",".join(f"{v:.4f}" for v in lons),
        "hourly": ",".join(HOURLY),
        "current": ",".join(CURRENT),
        # one spare hour so tiles fetched either side of an hour boundary still share 72 h
        "forecast_hours": HOURS + 1,
        "timezone": "GMT",
    }
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT, verify=SSL_CONTEXT) as client:
            resp = await client.get(open_meteo_access.url("forecast"), params=open_meteo_access.params(base))
    except httpx.RequestError as exc:
        logger.error("Open-Meteo tile request failed: %s", type(exc).__name__)
        raise RuntimeError("Weather service did not respond.") from exc
    if resp.status_code != 200:
        logger.error("Open-Meteo tiles returned HTTP %d: %s", resp.status_code, resp.text[:300])
        raise RuntimeError(f"Weather service returned an unexpected status ({resp.status_code}).")
    try:
        data = resp.json()
    except ValueError as exc:
        raise RuntimeError("Weather service returned an unreadable response.") from exc
    items = data if isinstance(data, list) else [data]
    if len(items) != len(lats):
        raise RuntimeError("Weather service returned data in an unexpected format.")
    return items


def _series(block: dict, key: str, n: int) -> list[Optional[float]]:
    values = block.get(key) or []
    return [values[i] if i < len(values) else None for i in range(n)]


def _build(key: TileKey, items: list[dict[str, Any]]) -> Tile:
    lats, lons = tile_coords(key)
    try:
        times = list(items[0]["hourly"]["time"])
        n = len(times)
        points = []
        for lat, lon, item in zip(lats, lons, items):
            block = item["hourly"]
            cur = item.get("current") or {}
            points.append(
                TilePoint(
                    latitude=lat,
                    longitude=lon,
                    elevation=item.get("elevation"),
                    hourly={k: _series(block, k, n) for k in HOURLY},
                    current={k: cur.get(k) for k in CURRENT},
                )
            )
    except (KeyError, TypeError, IndexError) as exc:
        logger.error("Open-Meteo tile schema mismatch: %s", exc)
        raise RuntimeError("Weather service returned data in an unexpected format.") from exc
    return Tile(key=key, times=times, points=points, fetched_at=datetime.now(tz=timezone.utc))


async def get_tiles(keys: list[TileKey]) -> dict[TileKey, Tile]:
    """Every requested tile, from the cache, a replay fixture or one Open-Meteo request."""
    now = time.monotonic()
    out: dict[TileKey, Tile] = {}
    missing: list[TileKey] = []
    for key in keys:
        hit = _cache.get(key)
        if hit and hit[0] > now:
            out[key] = hit[1]
            continue
        recorded = fixture_loader(key) if fixture_loader else None
        if recorded is not None:
            out[key] = recorded
        else:
            missing.append(key)

    if missing:
        lats: list[float] = []
        lons: list[float] = []
        for key in missing:
            a, b = tile_coords(key)
            lats += a
            lons += b
        items = await _fetch(lats, lons)
        per = TILE_POINTS * TILE_POINTS
        for i, key in enumerate(missing):
            tile = _build(key, items[i * per : (i + 1) * per])
            if len(_cache) >= CACHE_MAX_TILES:
                _cache.pop(next(iter(_cache)))
            _cache[key] = (now + CACHE_TTL_S, tile)
            if fixture_saver:
                fixture_saver(tile)
            out[key] = tile
    return out


def common_hours(tiles: list[Tile]) -> tuple[list[str], dict[TileKey, int]]:
    """The hours every tile has (tiles may be cached from either side of an
    hour boundary), and each tile's index of the first one."""
    start = max(t.times[0] for t in tiles)
    offsets = {t.key: t.times.index(start) if start in t.times else 0 for t in tiles}
    n = min(len(t.times) - offsets[t.key] for t in tiles)
    first = tiles[0]
    times = first.times[offsets[first.key] : offsets[first.key] + min(n, HOURS)]
    return times, offsets


def assemble(p: TilePlan, tiles: dict[TileKey, Tile]) -> tuple[list[str], list[tuple[TilePoint, int]]]:
    """(times, points) for the whole plan, row-major south to north, each
    point with the offset of its tile's first common hour."""
    times, offsets = common_hours(list(tiles.values()))
    out: list[tuple[TilePoint, int]] = []
    for r in range(p.row0, p.row1 + 1):
        for i in range(TILE_POINTS):
            for c in range(p.col0, p.col1 + 1):
                tile = tiles[(p.step, r, c)]
                for j in range(TILE_POINTS):
                    out.append((tile.points[i * TILE_POINTS + j], offsets[tile.key]))
    return times, out


def recorded_at(tiles: dict[TileKey, Tile]) -> Optional[str]:
    """The oldest recording time when any tile came from a replay fixture."""
    stamps = [t.recorded_at for t in tiles.values() if t.recorded_at]
    return min(stamps) if stamps else None
