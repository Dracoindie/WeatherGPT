"""
Hazard per H3 cell for the visible map (GET /api/map/hazard) and a summary
around a place (GET /api/map/hazard/summary).

Data: the shared weather tiles (maps/tiles.py), the same Open-Meteo values as
the grid layers. Scoring: alerts/scoring.py, the scorer the alert engine, risk
board, push and CAP use, with the rules in thresholds.py. A window is the 24 h
from the slider hour; hour 0 also includes the model's current values, exactly
like /api/alerts.

H3 resolution. Open-Meteo's model cell over India is about 8 km (64 km²). H3
res 6 hexagons are 6.5 km across (36 km²): the closest size that is not
coarser than the model, so a hex never claims more detail than about one model
cell. When zoomed out, the sample points are further apart than 8 km, so the
resolution drops with the sample spacing (the finest hex at least 0.7 x the
spacing); there are never many hexes per sample. Each hex takes the values of
its nearest sample point; nothing is interpolated for hazards.
"""

from __future__ import annotations

import math
from datetime import datetime, timezone
from typing import Optional

import h3
from pydantic import BaseModel, Field

from alerts.scoring import WINDOW_HOURS, Current, Hit, overall, score, window_facts
from maps import tiles as T
from maps.grid import MODEL_GRID_KM
from thresholds import HAZARDS, LEVEL_RANK, LEVELS, as_table

FINEST_RES = 6
COARSEST_RES = 2
MAX_CELLS = 2500
DEFAULT_RADIUS_KM = 25.0

NOTE = (
    "Estimated from Open-Meteo model data (model grid ≈ 8 km) with WeatherGPT's thresholds; "
    "not official IMD warnings."
)


def hex_across_km(res: int) -> float:
    return h3.average_hexagon_edge_length(res, "km") * math.sqrt(3)


def res_for_spacing(spacing_km: float) -> int:
    """The finest resolution (at most res 6) whose hexes are at least 0.7 x the sample spacing."""
    for res in range(FINEST_RES, COARSEST_RES - 1, -1):
        if hex_across_km(res) >= 0.7 * spacing_km:
            return res
    return COARSEST_RES


class PointHazard(BaseModel):
    latitude: float
    longitude: float
    overall: str
    levels: dict[str, str] = Field(..., description="Level per hazard: rain, heat, wind, storm, cold")
    facts: dict = Field(..., description="The window's values the rules looked at")
    triggers: list[dict] = Field(..., description="The rule that fired per hazard: value vs threshold")


class Worst(BaseModel):
    cell: str
    latitude: float
    longitude: float
    level: str
    point: int


class HazardResponse(BaseModel):
    source: str = "open-meteo"
    retrieved_at: datetime
    hour: int = Field(..., description="Window start, hours from now")
    max_hour: int = Field(..., description="Last start hour with a full 24 h window")
    window_start: str = Field(..., description="UTC, ISO 8601 with Z")
    window_end: str
    window_hours: int
    times: list[str] = Field(..., description="UTC hours of the forecast, ISO 8601 with Z")
    h3_resolution: int
    hex_km: float = Field(..., description="Average hexagon width (km)")
    step_deg: float
    spacing_km: float
    model_grid_km: int = MODEL_GRID_KM
    levels: list[str] = list(LEVELS)
    points: list[PointHazard]
    cells: list[tuple[str, int]] = Field(..., description="[H3 cell id, index into points]")
    counts: dict[str, int] = Field(..., description="Cells per overall level")
    worst: Optional[Worst] = None
    rules: list[dict] = Field(default_factory=as_table)
    recorded_at: Optional[str] = None
    note: str = NOTE


class HazardSummary(BaseModel):
    latitude: float
    longitude: float
    radius_km: float
    hour: int
    window_start: str
    window_end: str
    h3_resolution: int
    cells: int
    counts: dict[str, int]
    max_rain_mm: Optional[float] = None
    max_rain_at: Optional[Worst] = None
    worst_now: Optional[Worst] = None
    worst_ahead: Optional[Worst] = None
    worst_ahead_hour: Optional[int] = Field(None, description="First window start (hours from now) at the worst level")
    worst_ahead_time: Optional[str] = None
    nearest_sample_km: float
    model_grid_km: int = MODEL_GRID_KM
    recorded_at: Optional[str] = None
    note: str = NOTE


# ---------------------------------------------------------------------------


class _Grid:
    """Tiles for a box, assembled, with per-hour scoring and point lookup."""

    def __init__(self, p: T.TilePlan, tiles: dict, times: list[str], pts: list[tuple[T.TilePoint, int]]):
        self.p = p
        self.tiles = tiles
        self.times = times
        self.pts = pts
        self.s0 = p.row0 * p.span
        self.w0 = p.col0 * p.span
        self.rows = (p.row1 - p.row0 + 1) * T.TILE_POINTS
        self.cols = (p.col1 - p.col0 + 1) * T.TILE_POINTS
        self.max_hour = max(0, len(times) - WINDOW_HOURS)

    def hits(self, i: int, hour: int) -> dict[str, Optional[Hit]]:
        tp, off = self.pts[i]
        h = tp.hourly
        cur = tp.current
        current = (
            Current(cur.get("temperature_2m"), cur.get("relative_humidity_2m"), cur.get("precipitation"), cur.get("wind_speed_10m"), cur.get("weather_code"))
            if hour == 0
            else None
        )
        facts = window_facts(
            temperature=h["temperature_2m"],
            humidity=h["relative_humidity_2m"],
            precipitation=h["precipitation"],
            wind_speed=h["wind_speed_10m"],
            weather_code=h["weather_code"],
            start=off + hour,
            hours=WINDOW_HOURS,
            current=current,
        )
        return score(facts), facts  # type: ignore[return-value]

    def nearest(self, lat: float, lon: float) -> int:
        r = min(self.rows - 1, max(0, round((lat - self.s0) / self.p.step)))
        c = min(self.cols - 1, max(0, round((lon - self.w0) / self.p.step)))
        return r * self.cols + c


async def _grid(south: float, west: float, north: float, east: float) -> _Grid:
    p = T.plan(south, west, north, east)
    tiles = await T.get_tiles(p.keys)
    times, pts = T.assemble(p, tiles)
    return _Grid(p, tiles, times, pts)


def _cells(south: float, west: float, north: float, east: float, spacing_km: float) -> tuple[int, list[str]]:
    res = res_for_spacing(spacing_km)
    poly = h3.LatLngPoly([(south, west), (north, west), (north, east), (south, east)])
    while True:
        cells = h3.polygon_to_cells(poly, res)
        if len(cells) <= MAX_CELLS or res <= COARSEST_RES:
            return res, sorted(cells)
        res -= 1


def _iso(t: str) -> str:
    return f"{t}Z"


def _window(times: list[str], hour: int) -> tuple[str, str]:
    end_idx = min(len(times) - 1, hour + WINDOW_HOURS - 1)
    return _iso(times[hour]), _iso(times[end_idx])


def _point_model(g: _Grid, i: int, hits: dict[str, Optional[Hit]], facts) -> PointHazard:
    tp, _ = g.pts[i]
    return PointHazard(
        latitude=tp.latitude,
        longitude=tp.longitude,
        overall=overall(hits),
        levels={h: (hits[h].level if hits[h] else "none") for h in HAZARDS},
        facts=facts.as_dict(),
        triggers=[hits[h].as_dict() for h in HAZARDS if hits[h]],
    )


def _worse(a: tuple, b: tuple) -> bool:
    return a > b


async def fetch_hazard(south: float, west: float, north: float, east: float, hour: int = 0) -> HazardResponse:
    g = await _grid(south, west, north, east)
    hour = max(0, min(hour, g.max_hour))
    spacing = round(g.p.step * 111.32, 1)
    res, cells = _cells(south, west, north, east, spacing)

    used: dict[int, int] = {}  # grid point -> index in `points`
    points: list[PointHazard] = []
    out_cells: list[tuple[str, int]] = []
    counts = {lvl: 0 for lvl in LEVELS}
    worst: Optional[Worst] = None
    worst_key: tuple = (-1, -1.0)
    for cell in cells:
        lat, lon = h3.cell_to_latlng(cell)
        gi = g.nearest(lat, lon)
        if gi not in used:
            hits, facts = g.hits(gi, hour)
            used[gi] = len(points)
            points.append(_point_model(g, gi, hits, facts))
        pi = used[gi]
        out_cells.append((cell, pi))
        ph = points[pi]
        counts[ph.overall] += 1
        key = (LEVEL_RANK[ph.overall], ph.facts.get("rain_mm") or 0.0)
        if ph.overall != "none" and key > worst_key:
            worst_key = key
            worst = Worst(cell=cell, latitude=lat, longitude=lon, level=ph.overall, point=pi)

    ws, we = _window(g.times, hour)
    return HazardResponse(
        retrieved_at=min(t.fetched_at for t in g.tiles.values()) if g.tiles else datetime.now(tz=timezone.utc),
        hour=hour,
        max_hour=g.max_hour,
        window_start=ws,
        window_end=we,
        window_hours=min(WINDOW_HOURS, len(g.times) - hour),
        times=[_iso(t) for t in g.times],
        h3_resolution=res,
        hex_km=round(hex_across_km(res), 1),
        step_deg=g.p.step,
        spacing_km=spacing,
        points=points,
        cells=out_cells,
        counts=counts,
        worst=worst,
        recorded_at=T.recorded_at(g.tiles),
    )


def _km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 6371.0 * 2 * math.asin(math.sqrt(a))


async def hazard_summary(latitude: float, longitude: float, radius_km: float = DEFAULT_RADIUS_KM, hour: int = 0) -> HazardSummary:
    dlat = radius_km / 111.32
    dlon = radius_km / (111.32 * max(0.2, math.cos(math.radians(latitude))))
    south, north, west, east = latitude - dlat, latitude + dlat, longitude - dlon, longitude + dlon
    g = await _grid(south, west, north, east)
    hour = max(0, min(hour, g.max_hour))
    spacing = round(g.p.step * 111.32, 1)
    res, cells = _cells(south, west, north, east, spacing)
    near = [(c, *h3.cell_to_latlng(c)) for c in cells]
    near = [(c, la, lo) for c, la, lo in near if _km(latitude, longitude, la, lo) <= radius_km]
    idx = {c: g.nearest(la, lo) for c, la, lo in near}

    # every window start, once per sample point
    memo: dict[tuple[int, int], tuple[dict, object]] = {}

    def at(gi: int, h: int):
        if (gi, h) not in memo:
            memo[(gi, h)] = g.hits(gi, h)
        return memo[(gi, h)]

    counts = {lvl: 0 for lvl in LEVELS}
    worst_now: Optional[Worst] = None
    worst_now_key: tuple = (-1, -1.0)
    max_rain: Optional[float] = None
    max_rain_at: Optional[Worst] = None
    for c, la, lo in near:
        hits, facts = at(idx[c], hour)
        lvl = overall(hits)
        counts[lvl] += 1
        rain = facts.rain_mm or 0.0
        if lvl != "none" and (LEVEL_RANK[lvl], rain) > worst_now_key:
            worst_now_key = (LEVEL_RANK[lvl], rain)
            worst_now = Worst(cell=c, latitude=la, longitude=lo, level=lvl, point=idx[c])
        if facts.rain_mm is not None and (max_rain is None or facts.rain_mm > max_rain):
            max_rain = round(facts.rain_mm, 1)
            max_rain_at = Worst(cell=c, latitude=la, longitude=lo, level=lvl, point=idx[c])

    worst_ahead: Optional[Worst] = None
    worst_ahead_hour: Optional[int] = None
    best_rank = 0
    for h in range(0, g.max_hour + 1):
        for c, la, lo in near:
            hits, _ = at(idx[c], h)
            rank = LEVEL_RANK[overall(hits)]
            if rank > best_rank:
                best_rank = rank
                worst_ahead_hour = h
                worst_ahead = Worst(cell=c, latitude=la, longitude=lo, level=LEVELS[rank], point=idx[c])

    tp_near = min((g.pts[i][0] for i in set(idx.values())), key=lambda tp: _km(latitude, longitude, tp.latitude, tp.longitude), default=None)
    ws, we = _window(g.times, hour)
    return HazardSummary(
        latitude=latitude,
        longitude=longitude,
        radius_km=radius_km,
        hour=hour,
        window_start=ws,
        window_end=we,
        h3_resolution=res,
        cells=len(near),
        counts=counts,
        max_rain_mm=max_rain,
        max_rain_at=max_rain_at,
        worst_now=worst_now,
        worst_ahead=worst_ahead,
        worst_ahead_hour=worst_ahead_hour,
        worst_ahead_time=_iso(g.times[worst_ahead_hour]) if worst_ahead_hour is not None else None,
        nearest_sample_km=round(_km(latitude, longitude, tp_near.latitude, tp_near.longitude), 1) if tp_near else 0.0,
        recorded_at=T.recorded_at(g.tiles),
    )
