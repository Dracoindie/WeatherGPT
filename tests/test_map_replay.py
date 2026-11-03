"""
Offline map demo (docs/DEMO.md): recorded weather tiles serve /api/map/grid,
/api/map/hazard and the summary; a tap gets the nearest recorded point within
25 km, with that point's own coordinates. Recorded data always carries the
replay header. No network: Open-Meteo is mocked or made unreachable.
"""

from __future__ import annotations

from datetime import datetime, timedelta

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import demo_replay
from api.map import router as map_router
from demo_replay import REPLAY_HEADER, FixtureStore, TileFixtureStore, install
from maps import tiles as T
from maps.demo import DEMO_REGION, DEMO_STEPS, point_lattice, region_tile_keys

BASE = datetime(2026, 11, 3, 0, 0)


def _point(lat: float, lon: float) -> dict:
    n = 73
    return {
        "latitude": lat, "longitude": lon, "elevation": 550.0,
        "current": {"temperature_2m": 29.0, "relative_humidity_2m": 55, "precipitation": 0.0, "wind_speed_10m": 12.0, "weather_code": 2},
        "hourly": {"time": [(BASE + timedelta(hours=h)).strftime("%Y-%m-%dT%H:%M") for h in range(n)],
                   **{k: [3.0 if k == "precipitation" else 20.0 for _ in range(n)] for k in T.HOURLY}},
    }


def _upstream(monkeypatch, online: bool) -> list:
    calls: list = []
    real = httpx.AsyncClient

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        if not online:
            raise httpx.ConnectError("offline")
        lats = [float(v) for v in request.url.params["latitude"].split(",")]
        lons = [float(v) for v in request.url.params["longitude"].split(",")]
        body = [_point(a, b) for a, b in zip(lats, lons)]
        return httpx.Response(200, json=body if len(body) > 1 else body[0])

    def factory(*args, **kwargs):
        kwargs.pop("verify", None)
        return real(*args, transport=httpx.MockTransport(handler), **kwargs)

    monkeypatch.setattr(httpx, "AsyncClient", factory)
    return calls


def _app(store: FixtureStore, *, replay: bool, record: bool) -> FastAPI:
    app = FastAPI()
    install(app, replay=replay, record=record, store=store)
    app.include_router(map_router)
    return app


@pytest.fixture(autouse=True)
def offline_probe(monkeypatch):
    async def reachable() -> bool:
        return False

    monkeypatch.setattr(demo_replay, "internet_reachable", reachable)
    demo_replay._probe_cache.clear()


BOX = "south=18.45&west=73.75&north=18.6&east=73.95"


def test_demo_region_is_defined_once_and_served(tmp_path):
    client = TestClient(_app(FixtureStore(tmp_path), replay=False, record=False))
    body = client.get("/api/map/demo-region").json()
    assert {k: body[k] for k in ("south", "west", "north", "east")} == {k: DEMO_REGION[k] for k in ("south", "west", "north", "east")}
    assert body["min_zoom"] < body["max_zoom"]


def test_region_tiles_cover_the_region_at_every_step():
    for step in DEMO_STEPS:
        keys = region_tile_keys(step)
        span = T.TILE_POINTS * step
        rows = {r for _, r, _ in keys}
        cols = {c for _, _, c in keys}
        assert min(rows) * span <= DEMO_REGION["south"] + 1e-6
        assert max(rows) * span + (T.TILE_POINTS - 1) * step >= DEMO_REGION["north"] - 1e-6
        assert min(cols) * span <= DEMO_REGION["west"] + 1e-6
        assert max(cols) * span + (T.TILE_POINTS - 1) * step >= DEMO_REGION["east"] - 1e-6
    assert len(point_lattice()) == 35


def test_tile_store_round_trip(tmp_path):
    tile = T._build((0.1, 37, 147), [_point(a, b) for a, b in zip(*T.tile_coords((0.1, 37, 147)))])
    store = TileFixtureStore(tmp_path)
    store.save(tile)
    back = store.load((0.1, 37, 147))
    assert back is not None and back.recorded_at
    assert back.times == tile.times
    assert back.points[3].hourly == tile.points[3].hourly
    assert store.load((0.1, 0, 0)) is None


def test_record_then_replay_grid_and_hazard_offline(tmp_path, monkeypatch):
    store = FixtureStore(tmp_path)
    # record with the internet on
    calls = _upstream(monkeypatch, online=True)
    rec = TestClient(_app(store, replay=False, record=True))
    assert rec.get(f"/api/map/grid?{BOX}").status_code == 200
    assert calls and TileFixtureStore(tmp_path / demo_replay.TILE_DIR_NAME).count() > 0

    # replay with the internet off and an empty cache
    T.clear_cache()
    calls = _upstream(monkeypatch, online=False)
    rep = TestClient(_app(store, replay=True, record=False))
    grid = rep.get(f"/api/map/grid?{BOX}")
    assert grid.status_code == 200
    assert grid.json()["recorded_at"]
    assert grid.headers[REPLAY_HEADER] == grid.json()["recorded_at"]
    assert grid.json()["points"][0]["precipitation"][0] == 3.0  # the recorded value
    hazard = rep.get(f"/api/map/hazard?{BOX}")
    assert hazard.status_code == 200 and hazard.headers.get(REPLAY_HEADER)
    assert hazard.json()["points"][0]["facts"]["rain_mm"] == 72.0  # 24 x 3 mm recorded
    assert calls == [], "everything came from the recorded tiles"


def test_unrecorded_area_offline_is_a_clean_503(tmp_path, monkeypatch):
    _upstream(monkeypatch, online=False)
    rep = TestClient(_app(FixtureStore(tmp_path), replay=True, record=False))
    r = rep.get("/api/map/grid?south=27&west=77&north=27.2&east=77.2")
    assert r.status_code == 503


def _point_fixture(store: FixtureStore, lat: float, lon: float) -> None:
    store.save("GET", "/api/map/point", {"latitude": str(lat), "longitude": str(lon)}, None, 200,
               {"latitude": lat, "longitude": lon, "temperature_c": 31.0, "note": "recorded"})


def test_tap_gets_the_nearest_recorded_point_within_25_km(tmp_path):
    store = FixtureStore(tmp_path)
    _point_fixture(store, 18.45, 73.7)
    _point_fixture(store, 18.7, 73.95)
    rep = TestClient(_app(store, replay=True, record=False))
    r = rep.get("/api/map/point?latitude=18.5204&longitude=73.8567")
    assert r.status_code == 200
    body = r.json()
    # the recorded point's own coordinates, never relabelled as the tap
    assert (body["latitude"], body["longitude"]) == (18.45, 73.7)
    assert r.headers[REPLAY_HEADER]


def test_tap_far_from_recorded_points_offline_is_503(tmp_path):
    store = FixtureStore(tmp_path)
    _point_fixture(store, 18.45, 73.7)
    rep = TestClient(_app(store, replay=True, record=False))
    r = rep.get("/api/map/point?latitude=28.6&longitude=77.2")
    assert r.status_code == 503
    assert r.json().get("offline_demo") is True
