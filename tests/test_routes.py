"""
Weather along a route (backend/routing/, GET /api/route, docs/ROUTES.md).

OSRM, Open-Meteo and Nominatim are mocked; no network. The test route runs
straight north from 18.50 N to 19.40 N along 73.80 E: 100 segments of 1 km and
60 s each in OSRM's annotations (100 km, 100 min). The clock is frozen at
08:50Z (14:20 IST), so the current local hour's sample is 08:30Z.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from typing import Callable

import httpx
import pytest
from fastapi.testclient import TestClient

import window_rule as W
from alerts.scoring import score, window_facts
from main import app
from maps import tiles as T
from routing import osrm
from routing import weather as RW
from thresholds import HEAVY_RAIN_HOUR, LEVEL_RANK, ROUTE_RULES, RULES

client = TestClient(app)
UTC = timezone.utc
NOW = datetime(2026, 11, 4, 8, 50, tzinfo=UTC)
HOUR0 = datetime(2026, 11, 4, 8, 30, tzinfo=UTC)  # 14:00 IST
IST = 19800
A = (18.50, 73.80)
B = (19.40, 73.80)
N_SEG = 100

# field(grid_lat, grid_lon, k) -> overrides; k = local hours after HOUR0
Field = Callable[[float, float, int], dict]
CALM = {"temperature_2m": 28.0, "relative_humidity_2m": 50.0, "precipitation": 0.0, "wind_speed_10m": 10.0, "weather_code": 1}


def osrm_body(n: int = N_SEG) -> dict:
    coords = [[A[1], round(A[0] + i * (B[0] - A[0]) / n, 6)] for i in range(n + 1)]
    return {
        "code": "Ok",
        "routes": [
            {
                "distance": 1000.0 * n,
                "duration": 60.0 * n,
                "geometry": {"type": "LineString", "coordinates": coords},
                "legs": [
                    {
                        "annotation": {"distance": [1000.0] * n, "duration": [60.0] * n},
                        "steps": [
                            {"name": "Pune Nashik Highway", "ref": "NH60", "distance": 40_000.0},
                            {"name": "Kasara Ghat Road", "ref": "", "distance": 60_000.0},
                        ],
                    }
                ],
            }
        ],
    }


def tile_point(field: Field, lat: float, lon: float) -> dict:
    stamps = [int((HOUR0 + timedelta(hours=i)).timestamp()) for i in range(73)]
    rows = [{**CALM, **field(lat, lon, i)} for i in range(73)]
    for r in rows:
        r.setdefault("apparent_temperature", r["temperature_2m"])
        r.setdefault("precipitation_probability", 50)
        r.setdefault("wind_direction_10m", 250.0)
    return {
        "latitude": lat, "longitude": lon, "elevation": 500.0, "utc_offset_seconds": IST, "timezone": "Asia/Kolkata",
        "current": {"time": int((HOUR0 + timedelta(minutes=15)).timestamp()), **{k: CALM[k] for k in T.CURRENT}},
        "hourly": {"time": stamps, **{k: [r[k] for r in rows] for k in T.HOURLY}},
    }


@pytest.fixture
def services(monkeypatch):
    """Mocked OSRM (state['osrm']: a body, an HTTP status, or an exception) and Open-Meteo tiles."""
    state: dict = {"osrm": osrm_body(), "field": lambda la, lo, k: {}, "osrm_calls": [], "tile_calls": 0}
    real = httpx.AsyncClient

    def handler(request: httpx.Request) -> httpx.Response:
        if "/route/v1/driving/" in request.url.path:
            state["osrm_calls"].append(request)
            o = state["osrm"]
            if isinstance(o, Exception):
                raise o
            if isinstance(o, int):
                return httpx.Response(o, json={"code": "Error"})
            if isinstance(o, tuple):
                return httpx.Response(o[0], json=o[1])
            return httpx.Response(200, json=o)
        q = request.url.params
        state["tile_calls"] += 1
        lats = [float(v) for v in q["latitude"].split(",")]
        lons = [float(v) for v in q["longitude"].split(",")]
        body = [tile_point(state["field"], a, b) for a, b in zip(lats, lons)]
        return httpx.Response(200, json=body if len(body) > 1 else body[0])

    def factory(*args, **kwargs):
        kwargs.pop("verify", None)
        return real(*args, transport=httpx.MockTransport(handler), **kwargs)

    async def no_place(lat, lon):
        return None

    monkeypatch.setattr(httpx, "AsyncClient", factory)
    monkeypatch.setattr(W, "now_utc", lambda: NOW)
    monkeypatch.setattr(RW.geocoding, "reverse_geocode", no_place)
    monkeypatch.setattr(osrm, "MIN_INTERVAL_S", 0.0)
    monkeypatch.delenv("ROUTING_URL", raising=False)
    return state


def get_route(**extra) -> httpx.Response:
    params = {"from_lat": A[0], "from_lon": A[1], "to_lat": B[0], "to_lon": B[1], **extra}
    return client.get("/api/route", params=params)


def rain_band(lat_lo: float, lat_hi: float, hours: set[int], code: int = 65) -> Field:
    return lambda la, lo, k: {"weather_code": code, "precipitation": 8.0} if lat_lo <= la < lat_hi and k in hours else {}


# ---------------------------------------------------------------------------
# 1. Geometry and timing
# ---------------------------------------------------------------------------


def test_parse_keeps_osrm_timing_and_roads():
    r = osrm.parse(osrm_body())
    assert r.cum_m[-1] == 100_000.0 and r.cum_s[-1] == 6000.0
    assert len(r.coords) == len(r.cum_m) == N_SEG + 1
    assert r.road_at(10_000) == "NH60"
    assert r.road_at(70_000) == "Kasara Ghat Road"


def test_parse_errors():
    with pytest.raises(osrm.NoRoute):
        osrm.parse({"code": "NoRoute"})
    with pytest.raises(osrm.RoutingUnavailable):
        osrm.parse({"code": "Ok", "routes": [{"geometry": {"coordinates": [[0, 0], [1, 1]]}, "legs": [{"annotation": {"distance": [1, 2], "duration": [1]}}]}]})


def test_samples_every_5_km_plus_the_end():
    r = osrm.parse(osrm_body())
    s = RW.sample_route(r)
    assert [x.km for x in s] == [i * 5.0 for i in range(21)]
    r2 = osrm.parse({**osrm_body(), "routes": [{**osrm_body()["routes"][0]}]})
    r2.cum_m = [m * 1.023 for m in r2.cum_m]  # 102.3 km: the end is its own sample
    s2 = RW.sample_route(r2)
    assert s2[-1].km == 102.3 and s2[-2].km == 100.0


def test_arrival_time_comes_from_osrm_durations():
    r = osrm.parse(osrm_body())
    s = RW.sample_route(r)
    # 60 s per km in the annotations: km 35 is reached after 35 min
    assert s[7].km == 35.0 and s[7].t_s == pytest.approx(35 * 60)
    # positions are interpolated along the geometry
    assert s[7].lat == pytest.approx(A[0] + 0.35 * (B[0] - A[0]))


def test_nearest_forecast_hour_rounds_half_up():
    tp = T.TilePoint(0, 0, None, {"temperature_2m": [20.0] * 5}, {}, t0=int(HOUR0.timestamp()))
    assert RW.hour_index(tp, HOUR0 + timedelta(minutes=29)) == 0
    assert RW.hour_index(tp, HOUR0 + timedelta(minutes=30)) == 1  # round() would give 0 at 0.5
    assert RW.hour_index(tp, HOUR0 + timedelta(minutes=150)) == 3  # 2.5 -> 3, not 2
    assert RW.hour_index(tp, HOUR0 - timedelta(minutes=31)) is None
    assert RW.hour_index(tp, HOUR0 + timedelta(hours=5)) is None


def test_route_rules_are_the_shared_rules_for_one_hour():
    ids = {r.id for r in ROUTE_RULES}
    # every non-rain rule as everywhere else; the 24 h rain totals replaced by that hour's WMO code
    assert {r.id for r in RULES if r.parameter != "precipitation"} <= ids
    assert not {"heavy_rain", "extreme_rain", "very_heavy_rain"} & ids
    assert HEAVY_RAIN_HOUR.codes == (65, 82) and HEAVY_RAIN_HOUR.level == "watch"


# ---------------------------------------------------------------------------
# 2. The report
# ---------------------------------------------------------------------------


def test_calm_route(services):
    resp = get_route()
    assert resp.status_code == 200
    d = resp.json()
    assert d["distance_km"] == 100.0 and d["duration_min"] == 100.0
    assert d["depart"] == "2026-11-04T08:50:00Z" and d["arrive"] == "2026-11-04T10:30:00Z"
    assert d["worst"] == "none" and d["findings"] == []
    assert d["best_already"] is True and d["suggestion"] is None
    assert len(d["samples"]) == 21 and len(d["departures"]) == 49
    assert d["timezone"] == "Asia/Kolkata"
    assert d["step_deg"] == 0.08 and d["model_grid_km"] == 8
    assert d["routing_public_demo"] is True and d["routing_host"] == "router.project-osrm.org"
    assert "Not official IMD" in d["note"] and "does not mean safe" in d["note"]
    assert d["worst_km"] == 100.0  # sample stretches add up to the route, not 21 x 5 km
    assert services["tile_calls"] == 1  # three tiles at 0.08°, one batched request


def test_scored_at_the_hour_the_traveller_passes(services):
    # heavy rain (WMO 65) only around 19.04 N, only in local hour k=1 (09:30Z)
    services["field"] = rain_band(19.0, 19.1, {1})
    d = get_route().json()
    by_km = {s["km"]: s for s in d["samples"]}
    s60 = by_km[60.0]
    # km 60 is reached at 08:50 + 60 min = 09:50Z, nearest forecast hour 09:30Z (k=1)
    assert s60["eta"] == "2026-11-04T09:50:00Z"
    assert s60["level"] == "watch" and s60["levels"]["rain"] == "watch"
    assert s60["triggers"][0]["rule_id"] == "heavy_rain_hour"
    assert s60["facts"]["weather_code"] == 65
    assert (s60["grid_latitude"], s60["grid_longitude"]) == (19.04, 73.84)
    assert by_km[30.0]["level"] == "none"

    # the same hour through the shared scorer gives the same level
    tp = T.TilePoint(19.04, 73.84, None, {k: [None] for k in T.HOURLY}, {})
    tp.hourly = {k: [{**CALM, "weather_code": 65, "precipitation": 8.0, "apparent_temperature": 28.0, "precipitation_probability": 50, "wind_direction_10m": 250.0}[k]] for k in T.HOURLY}
    hits = score(window_facts(temperature=tp.hourly["temperature_2m"], humidity=tp.hourly["relative_humidity_2m"], precipitation=tp.hourly["precipitation"], wind_speed=tp.hourly["wind_speed_10m"], weather_code=tp.hourly["weather_code"], hours=1), ROUTE_RULES)
    assert hits["rain"].level == s60["levels"]["rain"]

    # the line is coloured by the same levels, end to end without gaps
    segs = d["segments"]
    assert segs[0]["from_km"] == 0 and segs[-1]["to_km"] == 100.0
    assert all(a["to_km"] == b["from_km"] for a, b in zip(segs, segs[1:]))
    assert all(a["level"] != b["level"] for a, b in zip(segs, segs[1:]))
    assert any(s["level"] == "watch" for s in segs)
    assert d["worst"] == "watch" and d["worst_km"] == 5.0


def test_findings_name_the_stretch_time_value_and_road(services, monkeypatch):
    services["field"] = rain_band(19.0, 19.1, {1})

    async def kasara(lat, lon):
        return "Kasara, Maharashtra, India"

    monkeypatch.setattr(RW.geocoding, "reverse_geocode", kasara)
    f = get_route().json()["findings"]
    assert len(f) == 1
    f = f[0]
    assert (f["hazard"], f["level"], f["rule_id"]) == ("rain", "watch", "heavy_rain_hour")
    assert (f["km"], f["from_km"], f["to_km"]) == (60.0, 60.0, 60.0)
    assert f["eta"] == "2026-11-04T09:50:00Z"
    assert f["place"] == "Kasara" and f["road"] == "Kasara Ghat Road"
    assert (f["value"], f["threshold"], f["comparator"], f["unit"]) == (65.0, 65.0, "in", "WMO code")


def test_findings_fall_back_to_the_road_when_no_place(services):
    services["field"] = rain_band(19.0, 19.1, {1})
    f = get_route().json()["findings"][0]
    assert f["place"] is None and f["road"] == "Kasara Ghat Road"


def test_every_number_in_findings_comes_from_the_data(services):
    """Grounding: a finding's value is the sample's fact, its threshold is the rule's."""
    services["field"] = lambda la, lo, k: {"temperature_2m": 36.5, "relative_humidity_2m": 20.0} if la >= 19.2 else {}
    d = get_route().json()
    rules = {r["id"]: r for r in d["rules"]}
    by_km = {s["km"]: s for s in d["samples"]}
    for f in d["findings"]:
        assert f["threshold"] == rules[f["rule_id"]]["value"]
        facts = by_km[f["km"]]["facts"]
        assert f["value"] in {round(v, 1) for v in facts.values() if v is not None}
    assert {f["hazard"] for f in d["findings"]} == {"heat"}


def test_departure_suggestion_avoids_the_rain(services):
    services["field"] = rain_band(19.0, 19.1, {1})
    d = get_route().json()
    s = d["suggestion"]
    assert d["best_already"] is False
    # leaving 15 min later reaches km 60 at 10:05Z: nearest hour 10:30Z (k=2), dry
    assert s["depart"] == "2026-11-04T09:05:00Z" and s["minutes_later"] == 15
    assert s["worst"] == "none" and s["avoids"] == ["rain"] and s["lowers"] == []
    opts = {o["depart"]: o["worst"] for o in d["departures"]}
    assert opts["2026-11-04T08:50:00Z"] == "watch" and opts["2026-11-04T09:05:00Z"] == "none"


def test_suggestion_only_when_strictly_better(services):
    # rain at km 60 in every hour: no departure avoids it
    services["field"] = rain_band(19.0, 19.1, set(range(73)))
    d = get_route().json()
    assert d["suggestion"] is None and d["best_already"] is True


def test_suggestion_can_lower_without_avoiding(services):
    # moderate rain (63, advisory) all day; heavy rain (65, watch) only in hour 1
    def field(la, lo, k):
        if 19.0 <= la < 19.1:
            return {"weather_code": 65 if k == 1 else 63}
        return {}

    services["field"] = field
    s = get_route().json()["suggestion"]
    assert s["worst"] == "advisory" and s["avoids"] == [] and s["lowers"] == ["rain"]


def test_later_departure_and_validation(services):
    # 12:00 IST = 06:30Z, more than 5 min before now
    assert get_route(depart="2026-11-04T12:00:00+05:30").status_code == 422
    # a few seconds in the past (clock skew) is taken as now
    assert get_route(depart="2026-11-04T08:48:00Z").json()["depart"] == "2026-11-04T08:50:00Z"
    later = get_route(depart="2026-11-04T20:00:00Z")
    assert later.status_code == 200 and later.json()["depart"] == "2026-11-04T20:00:00Z"
    assert get_route(depart="2026-11-08T09:00:00Z").status_code == 422  # beyond 72 h
    assert get_route(depart="2026-11-04T20:00:00").status_code == 422  # no zone
    assert client.get("/api/route", params={"from_lat": 18.5, "from_lon": 73.8, "to_lat": 18.5, "to_lon": 73.8}).status_code == 422


def test_beyond_the_forecast_is_unknown_not_none(services):
    # leave 71 h from now: most of the trip falls after the 72 h of data
    d = get_route(depart="2026-11-07T07:50:00Z").json()
    assert d["beyond_forecast_km"] > 0
    assert any(s["level"] == "unknown" for s in d["samples"])
    assert any(seg["level"] == "unknown" for seg in d["segments"])


# ---------------------------------------------------------------------------
# 3. Routing service: timeout, errors, fair use, cache, ROUTING_URL
# ---------------------------------------------------------------------------


def test_routing_timeout_is_a_clear_503(services):
    services["osrm"] = httpx.ReadTimeout("slow")
    resp = get_route()
    assert resp.status_code == 503
    assert "Route planning is unavailable" in resp.json()["detail"]
    assert "no uptime guarantee" in resp.json()["detail"]


@pytest.mark.parametrize("status", [429, 500, 502])
def test_routing_http_errors_are_503(services, status):
    services["osrm"] = status
    assert get_route().status_code == 503


def test_routing_unreachable_is_503(services):
    services["osrm"] = httpx.ConnectError("down")
    assert get_route().status_code == 503


def test_no_road_route_is_422(services):
    services["osrm"] = (400, {"code": "NoRoute", "message": "Impossible route"})
    resp = get_route()
    assert resp.status_code == 422 and "No road route" in resp.json()["detail"]


def test_routes_are_cached(services):
    assert get_route().status_code == 200
    assert get_route(depart="2026-11-04T10:00:00Z").status_code == 200
    assert len(services["osrm_calls"]) == 1


def test_request_shape_and_routing_url(services, monkeypatch):
    monkeypatch.setenv("ROUTING_URL", "http://osrm.internal:5000/")
    assert get_route().status_code == 200
    req = services["osrm_calls"][0]
    assert req.url.host == "osrm.internal" and req.url.port == 5000
    assert req.url.path == "/route/v1/driving/73.800000,18.500000;73.800000,19.400000"
    assert req.url.params["overview"] == "full" and req.url.params["annotations"] == "distance,duration"
    assert req.headers["user-agent"].startswith("WeatherGPT/")
    body = get_route().json()
    assert body["routing_public_demo"] is False and body["routing_host"] == "osrm.internal"


def test_fair_use_spacing(services, monkeypatch):
    """At most one OSRM request per MIN_INTERVAL_S, one at a time."""
    monkeypatch.setattr(osrm, "MIN_INTERVAL_S", 1.0)
    waits: list[float] = []
    real_sleep = asyncio.sleep

    async def fake_sleep(s):
        waits.append(s)
        await real_sleep(0)

    monkeypatch.setattr(osrm.asyncio, "sleep", fake_sleep)

    async def two():
        await osrm.get_route(*A, *B)
        await osrm.get_route(*A, 19.3, 73.8)  # a different route: not cached

    asyncio.run(two())
    assert len(services["osrm_calls"]) == 2
    assert len(waits) == 1 and 0.5 < waits[0] <= 1.0


# ---------------------------------------------------------------------------
# 4. Demo replay
# ---------------------------------------------------------------------------


def test_record_then_replay_offline(services, tmp_path):
    from fastapi import FastAPI

    import demo_replay
    from api.route import router as route_router

    store = demo_replay.FixtureStore(tmp_path)

    rec = FastAPI()
    demo_replay.install(rec, replay=False, record=True, store=store)
    rec.include_router(route_router)
    assert TestClient(rec).get("/api/route", params={"from_lat": A[0], "from_lon": A[1], "to_lat": B[0], "to_lon": B[1]}).status_code == 200
    assert len(list((tmp_path / "routes").glob("route_*.json"))) == 1
    assert len(list((tmp_path / "map_tiles").glob("tile_*.json"))) == 3

    # offline: OSRM and Open-Meteo both unreachable
    osrm.clear_cache()
    T.clear_cache()
    services["osrm"] = httpx.ConnectError("offline")
    play = FastAPI()
    demo_replay.install(play, replay=True, record=False, store=demo_replay.FixtureStore(tmp_path))
    play.include_router(route_router)
    c = TestClient(play)
    # ends within 10 km of the recorded ones: replayed, labelled
    near = c.get("/api/route", params={"from_lat": A[0] + 0.05, "from_lon": A[1], "to_lat": B[0] - 0.05, "to_lon": B[1]})
    assert near.status_code == 200
    assert near.headers.get(demo_replay.REPLAY_HEADER)
    assert near.json()["recorded_at"]
    assert services["osrm_calls"][-1].url.params  # only the recording call reached OSRM
    calls_before = len(services["osrm_calls"])
    # far from any recorded route: the routing message, not a crash
    far = c.get("/api/route", params={"from_lat": 21.0, "from_lon": 79.0, "to_lat": 22.0, "to_lon": 79.0})
    assert far.status_code == 503
    assert len(services["osrm_calls"]) == calls_before + 1


def test_demo_routes_are_in_the_demo_region():
    from maps.demo import DEMO_REGION, DEMO_ROUTES

    assert ("Pune", "Mumbai") in DEMO_ROUTES and ("Mumbai", "Nashik") in DEMO_ROUTES
    # Nashik (about 20.0 N) is inside the offline basemap region
    assert DEMO_REGION["north"] >= 20.1


def test_levels_rank():
    assert LEVEL_RANK["watch"] > LEVEL_RANK["advisory"]
