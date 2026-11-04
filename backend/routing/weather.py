"""
Estimated weather hazard along a driving route, at the time the traveller
reaches each point (GET /api/route; docs/ROUTES.md).

1. Route: OSRM through routing/osrm.py, with its per-segment travel times.
2. Samples: a point every SAMPLE_KM along the route, plus the end. Each sample's
   arrival time is the departure time plus OSRM's travel time to that point.
3. Weather: the shared map tiles (maps/tiles.py), the same Open-Meteo values as
   the hazard map, at the finest grid step whose tiles along the route stay
   within MAX_ROUTE_TILES. Each sample takes its nearest grid point and the
   forecast HOUR nearest to its arrival time. Nothing is interpolated.
4. Scoring: alerts/scoring.py, the one scorer, on that single hour, with
   thresholds.ROUTE_RULES: the instant rules (temperature, heat index, wind,
   thunderstorm) plus rain from the model's WMO weather code for that hour
   (the 24 h rain totals cannot be compared with one hour of rain).
5. Report: coloured segments, plain findings ("Heavy rain near Kasara around
   17:40, watch"), and the departure in the next 12 h with the lowest worst
   level. The wording is "lower estimated weather hazard", never "safe".
"""

from __future__ import annotations

import logging
import math
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Optional

from pydantic import BaseModel, Field

import geocoding
from alerts.scoring import Hit, overall, score, window_facts
from maps import tiles as T
from maps.grid import MODEL_GRID_KM
from routing import osrm
from thresholds import HAZARDS, LEVEL_RANK, ROUTE_RULES, rules_table
import window_rule

logger = logging.getLogger(__name__)

SAMPLE_KM = 5.0
MAX_ROUTE_TILES = 8
TILES_PER_REQUEST = 4  # 100 points, like the map grid
MAX_ROUTE_KM = 2000.0
SUGGEST_HOURS = 12
SUGGEST_STEP_MIN = 15
MAX_NAMED_FINDINGS = 3
MAX_FINDINGS = 6
FORECAST_HOURS = 72

NOTE = (
    "Estimated from Open-Meteo model data (model grid ≈ 8 km) for the hour you are expected to pass each point, "
    "using OSRM travel times. Lower estimated weather hazard does not mean safe. Not official IMD warnings."
)


class RouteTooLong(ValueError):
    pass


# ---------------------------------------------------------------------------
# Geometry
# ---------------------------------------------------------------------------


@dataclass
class Sample:
    km: float
    lat: float
    lon: float
    t_s: float  # OSRM travel time from the start (seconds)


def _interp(route: osrm.Route, metres: float) -> tuple[float, float, float]:
    """(lon, lat, seconds) at a distance along the route."""
    cm = route.cum_m
    metres = max(0.0, min(metres, cm[-1]))
    lo, hi = 0, len(cm) - 1
    while hi - lo > 1:
        mid = (lo + hi) // 2
        if cm[mid] <= metres:
            lo = mid
        else:
            hi = mid
    span = cm[hi] - cm[lo]
    f = 0.0 if span <= 0 else (metres - cm[lo]) / span
    (x0, y0), (x1, y1) = route.coords[lo], route.coords[hi]
    t = route.cum_s[lo] + f * (route.cum_s[hi] - route.cum_s[lo])
    return x0 + f * (x1 - x0), y0 + f * (y1 - y0), t


def sample_route(route: osrm.Route, every_km: float = SAMPLE_KM) -> list[Sample]:
    """A sample every ``every_km`` from the start, plus the end."""
    total = route.cum_m[-1]
    marks = [i * every_km * 1000 for i in range(int(total // (every_km * 1000)) + 1)]
    if total - marks[-1] > 1.0:
        marks.append(total)
    out = []
    for m in marks:
        lon, lat, t = _interp(route, m)
        out.append(Sample(km=round(m / 1000, 2), lat=lat, lon=lon, t_s=t))
    return out


def path_between(route: osrm.Route, m0: float, m1: float) -> list[list[float]]:
    """The route's coordinates from m0 to m1 metres, with interpolated ends."""
    a, b = _interp(route, m0), _interp(route, m1)
    inner = [list(c) for c, m in zip(route.coords, route.cum_m) if m0 < m < m1]
    return [[round(a[0], 5), round(a[1], 5)], *[[round(x, 5), round(y, 5)] for x, y in inner], [round(b[0], 5), round(b[1], 5)]]


# ---------------------------------------------------------------------------
# Weather lookup
# ---------------------------------------------------------------------------


def _grid_index(v: float, step: float) -> int:
    """The nearest grid index; an exact tie goes up (round() would go to even)."""
    return math.floor(round(v / step, 6) + 0.5)


def _tile_of(lat: float, lon: float, step: float) -> tuple[T.TileKey, int]:
    r, c = _grid_index(lat, step), _grid_index(lon, step)
    key = (step, r // T.TILE_POINTS, c // T.TILE_POINTS)
    return key, (r % T.TILE_POINTS) * T.TILE_POINTS + (c % T.TILE_POINTS)


def choose_step(samples: list[Sample]) -> float:
    """The finest grid step whose tiles along the route fit MAX_ROUTE_TILES."""
    for step in T.STEP_LADDER:
        keys = {_tile_of(s.lat, s.lon, step)[0] for s in samples}
        if len(keys) <= MAX_ROUTE_TILES:
            return step
    return T.STEP_LADDER[-1]


async def _tiles_for(samples: list[Sample], step: float) -> tuple[dict, list[T.TilePoint]]:
    where = [_tile_of(s.lat, s.lon, step) for s in samples]
    keys = sorted({k for k, _ in where})
    tiles: dict = {}
    for i in range(0, len(keys), TILES_PER_REQUEST):
        tiles.update(await T.get_tiles(keys[i : i + TILES_PER_REQUEST]))
    return tiles, [tiles[k].points[j] for k, j in where]


def hour_index(tp: T.TilePoint, when: datetime) -> Optional[int]:
    """The forecast hour nearest to ``when`` at this grid point (None outside the data)."""
    n = len(tp.hourly.get("temperature_2m") or [])
    i = math.floor((when.timestamp() - tp.t0) / 3600 + 0.5)  # half-up, not round()'s half-to-even
    return i if 0 <= i < n else None


# ---------------------------------------------------------------------------
# Scoring
# ---------------------------------------------------------------------------


class _Scorer:
    """Scores (grid point, hour) once, however many departures ask for it."""

    def __init__(self, points: list[T.TilePoint]):
        self.points = points
        self.memo: dict[tuple[int, int], tuple[dict[str, Optional[Hit]], object]] = {}

    def at(self, i: int, when: datetime):
        tp = self.points[i]
        idx = hour_index(tp, when)
        if idx is None:
            return None
        key = (id(tp), idx)
        if key not in self.memo:
            h = tp.hourly
            facts = window_facts(
                temperature=h["temperature_2m"],
                humidity=h["relative_humidity_2m"],
                precipitation=h["precipitation"],
                wind_speed=h["wind_speed_10m"],
                weather_code=h["weather_code"],
                start=idx,
                hours=1,
            )
            self.memo[key] = (score(facts, ROUTE_RULES), facts)
        return self.memo[key]


@dataclass
class _Eval:
    depart: datetime
    levels: list[str]  # per sample; "unknown" beyond the forecast
    hits: list[Optional[dict[str, Optional[Hit]]]]
    facts: list[object]

    @property
    def worst(self) -> str:
        known = [lv for lv in self.levels if lv != "unknown"]
        return max(known, key=lambda lv: LEVEL_RANK[lv], default="unknown")

    def km_at(self, level: str, weights: list[float]) -> float:
        """Route km at this level (each sample stands for the stretch it colours)."""
        return round(sum(w for lv, w in zip(self.levels, weights) if lv == level), 1)

    def weighted(self, weights: list[float]) -> float:
        return round(sum(LEVEL_RANK.get(lv, 0) * w for lv, w in zip(self.levels, weights)), 3)

    def complete(self) -> bool:
        return "unknown" not in self.levels

    def hazard_max(self) -> dict[str, int]:
        out = {h: 0 for h in HAZARDS}
        for hits in self.hits:
            if hits:
                for h, hit in hits.items():
                    if hit:
                        out[h] = max(out[h], LEVEL_RANK[hit.level])
        return out


def evaluate(samples: list[Sample], scorer: _Scorer, depart: datetime) -> _Eval:
    levels, hits_list, facts_list = [], [], []
    for i, s in enumerate(samples):
        r = scorer.at(i, depart + timedelta(seconds=s.t_s))
        if r is None:
            levels.append("unknown")
            hits_list.append(None)
            facts_list.append(None)
        else:
            hits, facts = r
            levels.append(overall(hits))
            hits_list.append(hits)
            facts_list.append(facts)
    return _Eval(depart, levels, hits_list, facts_list)


def _rank_key(e: _Eval, weights: list[float]) -> tuple:
    return (LEVEL_RANK.get(e.worst, 0), e.km_at(e.worst, weights), e.weighted(weights))


# ---------------------------------------------------------------------------
# Response models
# ---------------------------------------------------------------------------


def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


class RouteEnd(BaseModel):
    latitude: float
    longitude: float


class RouteSample(BaseModel):
    km: float
    latitude: float
    longitude: float
    eta: str = Field(..., description="Estimated time the traveller passes this point (UTC)")
    level: str = Field(..., description="none..severe, or 'unknown' beyond the forecast")
    levels: dict[str, str]
    facts: Optional[dict] = Field(None, description="That hour's values the rules looked at")
    triggers: list[dict]
    grid_latitude: float = Field(..., description="The model grid point used")
    grid_longitude: float


class RouteSegment(BaseModel):
    from_km: float
    to_km: float
    level: str
    path: list[list[float]] = Field(..., description="[lon, lat] pairs")


class Finding(BaseModel):
    hazard: str
    level: str
    rule_id: str
    label: str
    value: float
    threshold: float
    comparator: str
    unit: str
    from_km: float
    to_km: float
    km: float = Field(..., description="Where the stretch peaks")
    eta: str
    latitude: float
    longitude: float
    place: Optional[str] = Field(None, description="Nearby town (OpenStreetMap), if known")
    road: Optional[str] = Field(None, description="Road name or number from the route, if known")


class DepartureOption(BaseModel):
    depart: str
    worst: str
    worst_km: float
    complete: bool = Field(..., description="False when part of the trip is beyond the forecast")


class Suggestion(BaseModel):
    depart: str
    worst: str
    worst_km: float
    minutes_later: int
    avoids: list[str] = Field(..., description="Hazards that drop to none (rain, heat, wind, storm, cold)")
    lowers: list[str] = Field(..., description="Hazards that get a lower level but do not disappear")


class RouteReport(BaseModel):
    origin: RouteEnd
    destination: RouteEnd
    distance_km: float
    duration_min: float
    depart: str
    arrive: str
    timezone: Optional[str] = Field(None, description="IANA zone at the start, for showing clock times")
    worst: str
    worst_km: float
    samples: list[RouteSample]
    segments: list[RouteSegment]
    findings: list[Finding]
    departures: list[DepartureOption]
    current_rank_key: list[float] = Field(..., description="(worst rank, km at worst, weighted) for the chosen departure")
    suggestion: Optional[Suggestion] = None
    best_already: bool = Field(..., description="No departure in the next 12 h has a lower estimated hazard")
    beyond_forecast_km: float
    sample_km: float = SAMPLE_KM
    step_deg: float
    spacing_km: float
    model_grid_km: int = MODEL_GRID_KM
    routing: str = "OSRM"
    routing_host: str
    routing_public_demo: bool
    rules: list[dict]
    retrieved_at: datetime
    recorded_at: Optional[str] = None
    note: str = NOTE


# ---------------------------------------------------------------------------
# Building the report
# ---------------------------------------------------------------------------


def _bounds(route: osrm.Route, samples: list[Sample]) -> list[float]:
    """Metres where each sample's stretch starts and ends: halfway to its neighbours."""
    return [0.0] + [(a.km + b.km) * 500 for a, b in zip(samples, samples[1:])] + [route.cum_m[-1]]


def stretch_km(route: osrm.Route, samples: list[Sample]) -> list[float]:
    b = _bounds(route, samples)
    return [(b[i + 1] - b[i]) / 1000 for i in range(len(samples))]


def _segments(route: osrm.Route, samples: list[Sample], levels: list[str]) -> list[RouteSegment]:
    """Each sample colours the stretch halfway to its neighbours; equal levels merge."""
    bounds = _bounds(route, samples)
    out: list[RouteSegment] = []
    start = 0
    for i in range(1, len(samples) + 1):
        if i == len(samples) or levels[i] != levels[start]:
            m0, m1 = bounds[start], bounds[i]
            out.append(RouteSegment(from_km=round(m0 / 1000, 2), to_km=round(m1 / 1000, 2), level=levels[start], path=path_between(route, m0, m1)))
            start = i
    return out


def _findings(route: osrm.Route, samples: list[Sample], e: _Eval) -> list[Finding]:
    found: list[Finding] = []
    for hz in HAZARDS:
        run: list[int] = []
        for i in range(len(samples) + 1):
            hits = e.hits[i] if i < len(samples) else None
            hit = hits.get(hz) if hits else None
            if hit is not None:
                run.append(i)
                continue
            if run:
                peak = max(run, key=lambda j: (LEVEL_RANK[e.hits[j][hz].level], e.hits[j][hz].value))
                h = e.hits[peak][hz]
                s = samples[peak]
                found.append(
                    Finding(
                        hazard=hz,
                        level=h.level,
                        rule_id=h.rule.id,
                        label=h.rule.label,
                        value=round(h.value, 1),
                        threshold=h.rule.value,
                        comparator=h.rule.comparator,
                        unit=h.rule.unit,
                        from_km=samples[run[0]].km,
                        to_km=samples[run[-1]].km,
                        km=s.km,
                        eta=_iso(e.depart + timedelta(seconds=s.t_s)),
                        latitude=round(s.lat, 4),
                        longitude=round(s.lon, 4),
                        road=route.road_at(s.km * 1000) or None,
                    )
                )
                run = []
    found.sort(key=lambda f: (-LEVEL_RANK[f.level], f.km))
    found = found[:MAX_FINDINGS]
    found.sort(key=lambda f: f.km)
    return found


async def _name_places(findings: list[Finding]) -> None:
    """Nearby town names from Nominatim (cached, 1 request/s) for the worst few."""
    for f in sorted(findings, key=lambda f: -LEVEL_RANK[f.level])[:MAX_NAMED_FINDINGS]:
        try:
            label = await geocoding.reverse_geocode(f.latitude, f.longitude)
        except Exception as exc:  # never fail a route on a place name
            logger.info("Route place name unavailable: %s", type(exc).__name__)
            label = None
        if label:
            f.place = label.split(",")[0].strip() or None


def _sample_model(s: Sample, tp: T.TilePoint, e: _Eval, i: int) -> RouteSample:
    hits = e.hits[i]
    facts = e.facts[i]
    return RouteSample(
        km=s.km,
        latitude=round(s.lat, 5),
        longitude=round(s.lon, 5),
        eta=_iso(e.depart + timedelta(seconds=s.t_s)),
        level=e.levels[i],
        levels={h: (hits[h].level if hits and hits[h] else ("unknown" if hits is None else "none")) for h in HAZARDS},
        facts=facts.as_dict() if facts is not None else None,
        triggers=[hits[h].as_dict() for h in HAZARDS if hits and hits[h]],
        grid_latitude=tp.latitude,
        grid_longitude=tp.longitude,
    )


def _suggest(current: _Eval, options: list[_Eval], weights: list[float]) -> tuple[Optional[Suggestion], bool]:
    """The best departure: lowest worst level, then fewest km at it, then lowest
    weighted total, then earliest. Suggested only when strictly better than the
    chosen departure on (worst level, km at it)."""
    complete = [o for o in options if o.complete()] or options
    best = min(complete, key=lambda o: (*_rank_key(o, weights), o.depart))
    cur_key = _rank_key(current, weights)[:2]
    if _rank_key(best, weights)[:2] >= cur_key or best.depart == current.depart:
        return None, True
    cur_h, best_h = current.hazard_max(), best.hazard_max()
    avoids = [h for h in HAZARDS if cur_h[h] > 0 and best_h[h] == 0]
    lowers = [h for h in HAZARDS if best_h[h] > 0 and best_h[h] < cur_h[h]]
    return (
        Suggestion(
            depart=_iso(best.depart),
            worst=best.worst,
            worst_km=best.km_at(best.worst, weights),
            minutes_later=int((best.depart - current.depart).total_seconds() // 60),
            avoids=avoids,
            lowers=lowers,
        ),
        False,
    )


async def route_report(
    a_lat: float, a_lon: float, b_lat: float, b_lon: float, depart: Optional[datetime] = None
) -> RouteReport:
    """Raises osrm.RoutingUnavailable, osrm.NoRoute, RouteTooLong or RuntimeError (weather)."""
    route = await osrm.get_route(a_lat, a_lon, b_lat, b_lon)
    if route.cum_m[-1] / 1000 > MAX_ROUTE_KM:
        raise RouteTooLong(f"Routes longer than {MAX_ROUTE_KM:.0f} km are not supported.")
    now = window_rule.now_utc().replace(second=0, microsecond=0)
    depart = (depart or now).astimezone(timezone.utc).replace(second=0, microsecond=0)

    samples = sample_route(route)
    step = choose_step(samples)
    tiles, points = await _tiles_for(samples, step)
    scorer = _Scorer(points)
    weights = stretch_km(route, samples)

    current = evaluate(samples, scorer, depart)
    options = [
        evaluate(samples, scorer, depart + timedelta(minutes=k * SUGGEST_STEP_MIN))
        for k in range(SUGGEST_HOURS * 60 // SUGGEST_STEP_MIN + 1)
    ]
    suggestion, best_already = _suggest(current, options, weights)

    findings = _findings(route, samples, current)
    await _name_places(findings)

    first = points[0]
    return RouteReport(
        origin=RouteEnd(latitude=a_lat, longitude=a_lon),
        destination=RouteEnd(latitude=b_lat, longitude=b_lon),
        distance_km=round(route.distance_m / 1000, 1),
        duration_min=round(route.duration_s / 60, 1),
        depart=_iso(depart),
        arrive=_iso(depart + timedelta(seconds=route.cum_s[-1])),
        timezone=first.timezone,
        worst=current.worst,
        worst_km=current.km_at(current.worst, weights),
        samples=[_sample_model(s, points[i], current, i) for i, s in enumerate(samples)],
        segments=_segments(route, samples, current.levels),
        findings=findings,
        departures=[
            DepartureOption(depart=_iso(o.depart), worst=o.worst, worst_km=o.km_at(o.worst, weights), complete=o.complete())
            for o in options
        ],
        current_rank_key=list(_rank_key(current, weights)),
        suggestion=suggestion,
        best_already=best_already,
        beyond_forecast_km=current.km_at("unknown", weights),
        step_deg=step,
        spacing_km=round(step * 111.32, 1),
        routing_host=osrm.routing_host(),
        routing_public_demo=osrm.is_public_demo(),
        rules=rules_table(ROUTE_RULES),
        retrieved_at=min((t.fetched_at for t in tiles.values()), default=datetime.now(timezone.utc)),
        recorded_at=route.recorded_at or T.recorded_at(tiles),
    )


def max_depart(now: datetime) -> datetime:
    return now + timedelta(hours=FORECAST_HOURS)


