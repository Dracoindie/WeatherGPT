"""
GET /api/route: estimated weather hazard along a driving route at the time the
traveller reaches each point (routing/weather.py, docs/ROUTES.md).

Routing goes through OSRM on the backend only (ROUTING_URL). Errors:
- 503 with a clear message when routing or the weather service is unavailable
- 422 when there is no road route, the trip is too long, or the departure is
  outside now .. now + 72 h
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Query, Response

from routing import osrm
from routing.weather import RouteReport, RouteTooLong, max_depart, route_report
import window_rule

# Same header as demo_replay.REPLAY_HEADER (not imported: demo_replay pulls in the chat stack).
REPLAY_HEADER = "X-WeatherGPT-Replay"

ROUTING_DOWN = (
    "Route planning is unavailable right now: the routing service did not answer. "
    "The public OSRM server has no uptime guarantee; please try again in a minute."
)

router = APIRouter(tags=["route"])


@router.get(
    "/api/route",
    response_model=RouteReport,
    responses={422: {"description": "No route, too long, or bad departure"}, 503: {"description": "Routing or weather unavailable"}},
)
async def route(
    response: Response,
    from_lat: float = Query(..., ge=-90.0, le=90.0),
    from_lon: float = Query(..., ge=-180.0, le=180.0),
    to_lat: float = Query(..., ge=-90.0, le=90.0),
    to_lon: float = Query(..., ge=-180.0, le=180.0),
    depart: Optional[datetime] = Query(None, description="Departure (ISO 8601 with zone); default now"),
) -> RouteReport:
    now = window_rule.now_utc()
    if depart is not None:
        if depart.tzinfo is None:
            raise HTTPException(status_code=422, detail="The departure time needs a time zone (e.g. ...Z or +05:30).")
        depart = depart.astimezone(timezone.utc)
        if depart < now - timedelta(minutes=5) or depart > max_depart(now):
            raise HTTPException(status_code=422, detail="Pick a departure between now and 72 hours from now.")
        depart = max(depart, now)
    if (round(from_lat, 4), round(from_lon, 4)) == (round(to_lat, 4), round(to_lon, 4)):
        raise HTTPException(status_code=422, detail="Start and destination are the same place.")
    try:
        report = await route_report(from_lat, from_lon, to_lat, to_lon, depart)
    except osrm.NoRoute as exc:
        raise HTTPException(status_code=422, detail="No road route was found between these places.") from exc
    except RouteTooLong as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except osrm.RoutingUnavailable as exc:
        raise HTTPException(status_code=503, detail=ROUTING_DOWN) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail="Weather along the route is temporarily unavailable.") from exc
    if report.recorded_at:
        response.headers[REPLAY_HEADER] = report.recorded_at
    return report
