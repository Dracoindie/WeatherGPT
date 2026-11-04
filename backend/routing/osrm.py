"""
Driving routes from OSRM, called only by the backend (never from the browser).

- ROUTING_URL: the OSRM base URL. Default: the public OSRM demo server, which
  has NO uptime guarantee and a fair-use policy (at most 1 request per second,
  no heavy use). Point it at a self-hosted OSRM for anything beyond a demo
  (docs/ROUTES.md).
- Fair use: one request at a time, at least MIN_INTERVAL_S apart, with an
  identifying User-Agent; routes are cached for CACHE_TTL_S (roads don't move).
- Timeout: TIMEOUT. Any network error, timeout, HTTP error or unreadable answer
  raises RoutingUnavailable; "no route between these points" raises NoRoute.

The geometry is OSRM's full overview (GeoJSON) with per-segment distance and
duration annotations, so the traveller's timing along the route is OSRM's own.
"""

from __future__ import annotations

import asyncio
import logging
import os
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Optional
from urllib.parse import urlparse

import httpx

from http_tls import SSL_CONTEXT

logger = logging.getLogger(__name__)

DEFAULT_ROUTING_URL = "https://router.project-osrm.org"
TIMEOUT = httpx.Timeout(connect=5.0, read=12.0, write=5.0, pool=5.0)
MIN_INTERVAL_S = 1.0
CACHE_TTL_S = 6 * 3600
CACHE_MAX = 200
USER_AGENT = "WeatherGPT/1.0 (weather-along-route demo; SIH26068)"


class RoutingUnavailable(RuntimeError):
    """The routing service did not answer usefully."""


class NoRoute(ValueError):
    """The routing service found no road route between the points."""


@dataclass
class Step:
    start_m: float  # distance from the route start where the step begins
    name: str  # road name, may be empty
    ref: str  # road number (e.g. "NH48"), may be empty


@dataclass
class Route:
    coords: list[tuple[float, float]]  # (lon, lat), OSRM's full geometry
    cum_m: list[float]  # distance from the start at each coordinate
    cum_s: list[float]  # OSRM travel time from the start at each coordinate
    distance_m: float
    duration_s: float
    steps: list[Step] = field(default_factory=list)
    recorded_at: Optional[str] = None  # set when served from a demo-replay fixture

    def road_at(self, metres: float) -> str:
        """Road name or number at a distance along the route ('' if unknown)."""
        label = ""
        for s in self.steps:
            if s.start_m > metres:
                break
            label = s.ref or s.name or label
        return label


def routing_url() -> str:
    return (os.getenv("ROUTING_URL") or DEFAULT_ROUTING_URL).strip().rstrip("/")


def routing_host() -> str:
    return urlparse(routing_url()).hostname or routing_url()


def is_public_demo() -> bool:
    return routing_host() == urlparse(DEFAULT_ROUTING_URL).hostname


# Demo replay hooks (demo_replay installs them); None in normal operation.
fixture_loader: Optional[Callable[[float, float, float, float], Optional[tuple[dict, str]]]] = None
fixture_saver: Optional[Callable[[float, float, float, float, dict], None]] = None

_cache: dict[tuple, tuple[float, Route]] = {}
_gates: dict[int, asyncio.Lock] = {}
_last_request = 0.0


def _gate() -> asyncio.Lock:
    """One lock per event loop (the app runs one; tests start several)."""
    loop = id(asyncio.get_running_loop())
    if loop not in _gates:
        _gates.clear()
        _gates[loop] = asyncio.Lock()
    return _gates[loop]


def clear_cache() -> None:
    global _last_request
    _cache.clear()
    _gates.clear()
    _last_request = 0.0


def _key(a_lat: float, a_lon: float, b_lat: float, b_lon: float) -> tuple:
    return (round(a_lat, 4), round(a_lon, 4), round(b_lat, 4), round(b_lon, 4))


def parse(data: dict[str, Any]) -> Route:
    """OSRM /route JSON -> Route. Raises NoRoute or RoutingUnavailable."""
    code = data.get("code")
    if code in {"NoRoute", "NoSegment"}:
        raise NoRoute("No road route was found between these points.")
    if code != "Ok" or not data.get("routes"):
        raise RoutingUnavailable(f"Routing answered {code!r}.")
    try:
        r = data["routes"][0]
        coords = [(float(x), float(y)) for x, y in r["geometry"]["coordinates"]]
        dist: list[float] = []
        dur: list[float] = []
        steps: list[Step] = []
        done = 0.0
        for leg in r["legs"]:
            ann = leg["annotation"]
            dist += [float(v) for v in ann["distance"]]
            dur += [float(v) for v in ann["duration"]]
            for st in leg.get("steps") or []:
                steps.append(Step(done, str(st.get("name") or ""), str(st.get("ref") or "")))
                done += float(st.get("distance") or 0.0)
    except (KeyError, TypeError, ValueError, IndexError) as exc:
        raise RoutingUnavailable("Routing answered in an unexpected format.") from exc
    if len(dist) != len(coords) - 1 or len(dur) != len(dist) or len(coords) < 2:
        raise RoutingUnavailable("Routing geometry and timing do not line up.")
    cum_m, cum_s = [0.0], [0.0]
    for d, t in zip(dist, dur):
        cum_m.append(cum_m[-1] + d)
        cum_s.append(cum_s[-1] + t)
    return Route(
        coords=coords,
        cum_m=cum_m,
        cum_s=cum_s,
        distance_m=float(r.get("distance") or cum_m[-1]),
        duration_s=float(r.get("duration") or cum_s[-1]),
        steps=steps,
    )


async def _request(a_lat: float, a_lon: float, b_lat: float, b_lon: float) -> dict[str, Any]:
    global _last_request
    url = f"{routing_url()}/route/v1/driving/{a_lon:.6f},{a_lat:.6f};{b_lon:.6f},{b_lat:.6f}"
    params = {"overview": "full", "geometries": "geojson", "annotations": "distance,duration", "steps": "true"}
    async with _gate():  # one request at a time, at most one per MIN_INTERVAL_S
        wait = _last_request + MIN_INTERVAL_S - time.monotonic()
        if wait > 0:
            await asyncio.sleep(wait)
        try:
            async with httpx.AsyncClient(timeout=TIMEOUT, verify=SSL_CONTEXT, headers={"User-Agent": USER_AGENT}) as client:
                resp = await client.get(url, params=params)
        except httpx.TimeoutException as exc:
            logger.error("Routing timed out (%s)", routing_host())
            raise RoutingUnavailable("The routing service did not answer in time.") from exc
        except httpx.RequestError as exc:
            logger.error("Routing request failed (%s): %s", routing_host(), type(exc).__name__)
            raise RoutingUnavailable("The routing service could not be reached.") from exc
        finally:
            _last_request = time.monotonic()
    if resp.status_code == 400:
        try:
            body = resp.json()
        except ValueError:
            body = {}
        if body.get("code") in {"NoRoute", "NoSegment"}:
            raise NoRoute("No road route was found between these points.")
    if resp.status_code != 200:
        logger.error("Routing returned HTTP %d (%s)", resp.status_code, routing_host())
        raise RoutingUnavailable(f"The routing service returned HTTP {resp.status_code}.")
    try:
        return resp.json()
    except ValueError as exc:
        raise RoutingUnavailable("The routing service returned an unreadable answer.") from exc


async def get_route(a_lat: float, a_lon: float, b_lat: float, b_lon: float) -> Route:
    """The driving route from A to B: cache, replay fixture, or one OSRM request."""
    key = _key(a_lat, a_lon, b_lat, b_lon)
    now = time.monotonic()
    hit = _cache.get(key)
    if hit and hit[0] > now:
        return hit[1]
    if fixture_loader is not None:
        recorded = fixture_loader(a_lat, a_lon, b_lat, b_lon)
        if recorded is not None:
            data, recorded_at = recorded
            route = parse(data)
            route.recorded_at = recorded_at
            return route
    data = await _request(a_lat, a_lon, b_lat, b_lon)
    route = parse(data)
    if len(_cache) >= CACHE_MAX:
        _cache.pop(next(iter(_cache)))
    _cache[key] = (now + CACHE_TTL_S, route)
    if fixture_saver is not None:
        fixture_saver(a_lat, a_lon, b_lat, b_lon, data)
    return route
