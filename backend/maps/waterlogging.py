"""
Waterlogging risk (EXPERIMENTAL) per H3 cell: docs/WATERLOGGING.md.

For each res-8 hexagon (about 1 km across) in a city-sized view:

    rain  R = min(1, max(total_9h / WATERLOG_RAIN_TOTAL_MM, peak_hour / WATERLOG_RAIN_PEAK_MM_H))
          rain over the past 3 h and the next 6 h at the nearest model point
          (Open-Meteo, model grid ≈ 8 km; one batched request, cached 15 min)
    low   L = clamp((mean of the surrounding cells' ground - this cell's ground) / WATERLOG_LOW_METRES, 0, 1)
          ground from the terrain tiles (maps/dem.py), the average of the
          cell's centre and its 6 corners; surrounding = the two rings around it
    reports C = min(1, sum of trust weights / 1.5) of live waterlogging
          community reports within REPORT_KM (low 0.25, medium 0.5, high 1)

    score = min(1, R * (0.4 + 0.6 * L) + 0.3 * C)
    level = none / low / moderate / high by thresholds.WATERLOG_LEVELS

Rain is needed for any risk: with no rain and no reports the score is 0.
Limits (stated on the map and in the doc): the model cell is ~8 km, so every
hexagon in one model cell gets the same rain; drains, pumps and pavement are
unknown; ~76 m terrain pixels miss underpasses and small dips. It is an
estimate, not a measurement, and never an alert level.
"""

from __future__ import annotations

import logging
import math
import time
from datetime import datetime, timezone
from typing import Any, Optional

import h3
import httpx
from pydantic import BaseModel

import open_meteo_access
import thresholds as th
from maps import dem
from maps.grid import MODEL_GRID_KM
from reports.trust import km
from weather.open_meteo import TIMEOUT

logger = logging.getLogger(__name__)

RES = 8
RING = 2
MAX_BOX_DEG = 0.3  # a city: about 33 km at 18° N
MAX_CELLS = 2000
RAIN_STEP = 0.08  # the model grid (~8 km), same as the map tiles' finest step
PAST_HOURS = 3
NEXT_HOURS = 6
RAIN_TTL_S = 15 * 60
REPORT_KM = 1.5
REPORT_WEIGHT = {"low": 0.25, "medium": 0.5, "high": 1.0}
REPORT_FULL = 1.5

NOTE = (
    "Experimental estimate from Open-Meteo rain (past 3 h + next 6 h, model grid ≈ 8 km), "
    "terrain tiles and community reports. Not a measurement, not an alert, not official IMD."
)

_rain_cache: dict[tuple[float, float], tuple[float, list[int], list[Optional[float]]]] = {}


class BoxTooLarge(ValueError):
    pass


def clear_cache() -> None:
    _rain_cache.clear()


class CellParts(BaseModel):
    rain_mm: float
    peak_mm_h: float
    low_m: Optional[float]
    reports: int


class WaterlogCell(BaseModel):
    cell: str
    score: float
    level: str
    parts: CellParts


class WaterlogResponse(BaseModel):
    experimental: bool = True
    note: str = NOTE
    h3_resolution: int = RES
    model_grid_km: float = MODEL_GRID_KM
    window_start: Optional[str]
    window_end: Optional[str]
    terrain: str = dem.SOURCE
    reports_used: bool
    cells: list[WaterlogCell]  # only cells with a level above "none"
    cells_checked: int
    levels: list[dict]


# ------------------------------------------------------------------ formula ---

def rain_factor(total_mm: float, peak_mm_h: float) -> float:
    return min(1.0, max(total_mm / th.WATERLOG_RAIN_TOTAL_MM, peak_mm_h / th.WATERLOG_RAIN_PEAK_MM_H, 0.0))


def low_factor(low_m: Optional[float]) -> float:
    if low_m is None:
        return 0.0
    return min(1.0, max(0.0, low_m / th.WATERLOG_LOW_METRES))


def report_factor(weights: list[float]) -> float:
    return min(1.0, sum(weights) / REPORT_FULL)


def score(total_mm: float, peak_mm_h: float, low_m: Optional[float], report_weights: list[float]) -> float:
    s = rain_factor(total_mm, peak_mm_h) * (0.4 + 0.6 * low_factor(low_m)) + 0.3 * report_factor(report_weights)
    return round(min(1.0, s), 3)


def levels_table() -> list[dict]:
    return [{"level": name, "from_score": start} for name, start in th.WATERLOG_LEVELS]


# ---------------------------------------------------------------------- rain ---

def _rain_points(south: float, west: float, north: float, east: float) -> list[tuple[float, float]]:
    s = RAIN_STEP
    r0, r1 = math.floor(south / s), math.ceil(north / s)
    c0, c1 = math.floor(west / s), math.ceil(east / s)
    return [(round(r * s, 4), round(c * s, 4)) for r in range(r0, r1 + 1) for c in range(c0, c1 + 1)]


async def _rain(points: list[tuple[float, float]]) -> dict[tuple[float, float], tuple[list[int], list[Optional[float]]]]:
    now = time.monotonic()
    missing = [p for p in points if p not in _rain_cache or now - _rain_cache[p][0] > RAIN_TTL_S]
    if missing:
        base: dict[str, Any] = {
            "latitude": ",".join(f"{p[0]:.4f}" for p in missing),
            "longitude": ",".join(f"{p[1]:.4f}" for p in missing),
            "hourly": "precipitation",
            "past_hours": PAST_HOURS,
            "forecast_hours": NEXT_HOURS,
            "timezone": "UTC",
            "timeformat": "unixtime",
        }
        try:
            resp = await open_meteo_access.fetch("forecast", base, timeout=TIMEOUT)
        except httpx.RequestError as exc:
            raise RuntimeError("Weather service did not respond.") from exc
        if resp.status_code != 200:
            raise RuntimeError(f"Weather service returned HTTP {resp.status_code}.")
        data = resp.json()
        items = data if isinstance(data, list) else [data]
        if len(items) != len(missing):
            raise RuntimeError("Weather service returned data in an unexpected format.")
        for p, item in zip(missing, items):
            hourly = item.get("hourly") or {}
            _rain_cache[p] = (now, [int(t) for t in hourly.get("time") or []], list(hourly.get("precipitation") or []))
    return {p: (_rain_cache[p][1], _rain_cache[p][2]) for p in points}


def _nearest(points: list[tuple[float, float]], lat: float, lon: float) -> tuple[float, float]:
    return min(points, key=lambda p: (p[0] - lat) ** 2 + ((p[1] - lon) * math.cos(math.radians(lat))) ** 2)


# --------------------------------------------------------------------- cells ---

def cells_in_box(south: float, west: float, north: float, east: float) -> list[str]:
    poly = h3.LatLngPoly([(south, west), (north, west), (north, east), (south, east)])
    return sorted(h3.polygon_to_cells(poly, RES))


def _cell_samples(cell: str) -> list[tuple[float, float]]:
    return [h3.cell_to_latlng(cell), *h3.cell_to_boundary(cell)]


async def cell_ground(cells: set[str]) -> dict[str, Optional[float]]:
    """Mean ground height (m) of each cell from its centre and corners."""
    order = sorted(cells)
    samples: list[tuple[float, float]] = []
    spans: list[tuple[int, int]] = []
    for c in order:
        pts = _cell_samples(c)
        spans.append((len(samples), len(samples) + len(pts)))
        samples.extend(pts)
    heights = await dem.elevations(samples)
    out: dict[str, Optional[float]] = {}
    for c, (a, b) in zip(order, spans):
        vals = [h for h in heights[a:b] if h is not None]
        out[c] = sum(vals) / len(vals) if vals else None
    return out


def lowness(cell: str, ground: dict[str, Optional[float]]) -> Optional[float]:
    """Metres this cell lies below the mean of the cells in the RING rings around it."""
    own = ground.get(cell)
    if own is None:
        return None
    around = [ground.get(n) for n in h3.grid_disk(cell, RING) if n != cell]
    vals = [v for v in around if v is not None]
    if len(vals) < 3:
        return None
    return round(sum(vals) / len(vals) - own, 1)


# -------------------------------------------------------------------- answer ---

async def _waterlog_reports(south: float, west: float, north: float, east: float, now: datetime) -> Optional[list[tuple[float, float, str]]]:
    """(lat, lon, trust level) of live waterlogging reports around the box; None if reports are unavailable."""
    from api import reports as reports_api
    from reports import trust as trust_mod
    from reports.store import StoreError

    store = reports_api._store()
    if store is None:
        return None
    pad = REPORT_KM / 111.0 * 1.5
    try:
        rows = await store.list_box(south - pad, west - pad, north + pad, east + pad, now)
    except StoreError:
        return None
    live = [r for r in rows if r.live(now)]
    return [
        (r.latitude, r.longitude, trust_mod.trust(r, live, now).level) for r in live if r.kind == "waterlogging"
    ]


def _iso(ts: int) -> str:
    return datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


async def fetch_waterlogging(south: float, west: float, north: float, east: float, now: Optional[datetime] = None) -> WaterlogResponse:
    if north - south > MAX_BOX_DEG or east - west > MAX_BOX_DEG:
        raise BoxTooLarge("Zoom in to a city to see the waterlogging estimate.")
    now = now or datetime.now(timezone.utc)
    cells = cells_in_box(south, west, north, east)
    if len(cells) > MAX_CELLS:
        raise BoxTooLarge("Zoom in to a city to see the waterlogging estimate.")

    points = _rain_points(south, west, north, east)
    rain = await _rain(points)
    reports = await _waterlog_reports(south, west, north, east, now)

    # rain first: with no rain anywhere and no reports, nothing can score (no terrain needed)
    per_cell_rain: dict[str, tuple[float, float]] = {}
    for c in cells:
        lat, lon = h3.cell_to_latlng(c)
        _, series = rain[_nearest(points, lat, lon)]
        vals = [v for v in series if v is not None]
        per_cell_rain[c] = (round(sum(vals), 1), round(max(vals, default=0.0), 1))
    any_rain = any(total > 0 for total, _ in per_cell_rain.values())

    ground: dict[str, Optional[float]] = {}
    if any_rain:
        ring_cells = set(cells)
        for c in cells:
            ring_cells.update(h3.grid_disk(c, RING))
        try:
            ground = await cell_ground(ring_cells)
        except dem.DemError as exc:
            logger.warning("Waterlogging: terrain unavailable (%s); rain and reports only", exc)

    out: list[WaterlogCell] = []
    for c in cells:
        total, peak = per_cell_rain[c]
        lat, lon = h3.cell_to_latlng(c)
        weights = [
            REPORT_WEIGHT[level] for (rlat, rlon, level) in (reports or []) if km(lat, lon, rlat, rlon) <= REPORT_KM
        ]
        low_m = lowness(c, ground) if ground else None
        s = score(total, peak, low_m, weights)
        level = th.waterlog_level(s)
        if level != "none":
            out.append(
                WaterlogCell(
                    cell=c,
                    score=s,
                    level=level,
                    parts=CellParts(rain_mm=total, peak_mm_h=peak, low_m=low_m, reports=len(weights)),
                )
            )

    times = sorted({t for ts, _ in rain.values() for t in ts})
    return WaterlogResponse(
        window_start=_iso(times[0]) if times else None,
        window_end=_iso(times[-1] + 3600) if times else None,
        reports_used=reports is not None,
        cells=out,
        cells_checked=len(cells),
        levels=levels_table(),
    )
