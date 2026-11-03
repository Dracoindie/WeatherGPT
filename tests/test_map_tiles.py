"""
Shared map tiles (backend/maps/tiles.py) and the optional OPEN_METEO_API_KEY
(backend/open_meteo_access.py). Open-Meteo is mocked; no network.
"""

from __future__ import annotations

from datetime import datetime, timedelta

import httpx
import pytest
from fastapi.testclient import TestClient

import maps.tiles as T
import open_meteo_access
from main import app

client = TestClient(app)
BASE = datetime(2026, 11, 3, 0, 0)


@pytest.fixture(autouse=True)
def fresh(monkeypatch):
    monkeypatch.delenv("OPEN_METEO_API_KEY", raising=False)
    T.clear_cache()
    yield
    T.clear_cache()


def _point(lat: float, lon: float, start_hour: int = 0) -> dict:
    n = 73
    return {
        "latitude": lat,
        "longitude": lon,
        "elevation": 500.0,
        "current": {"temperature_2m": 30.0, "relative_humidity_2m": 50, "precipitation": 0.0, "wind_speed_10m": 10.0, "weather_code": 2},
        "hourly": {
            "time": [(BASE + timedelta(hours=start_hour + h)).strftime("%Y-%m-%dT%H:%M") for h in range(n)],
            **{k: [float(start_hour + h) for h in range(n)] for k in T.HOURLY},
        },
    }


@pytest.fixture
def upstream(monkeypatch):
    """Mocked Open-Meteo; state['hour'] sets the first hour of each answer."""
    calls: list[httpx.Request] = []
    state = {"hour": 0}
    real = httpx.AsyncClient

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        lats = [float(v) for v in request.url.params["latitude"].split(",")]
        lons = [float(v) for v in request.url.params["longitude"].split(",")]
        body = [_point(a, b, state["hour"]) for a, b in zip(lats, lons)]
        return httpx.Response(200, json=body if len(body) > 1 else body[0])

    def factory(*args, **kwargs):
        kwargs.pop("verify", None)
        return real(*args, transport=httpx.MockTransport(handler), **kwargs)

    monkeypatch.setattr(T.httpx, "AsyncClient", factory)
    return calls, state


def test_tile_points_sit_on_multiples_of_the_step():
    lats, lons = T.tile_coords((0.2, 3, 14))
    assert len(lats) == T.TILE_POINTS**2
    for v in lats + lons:
        assert abs(round(v / 0.2) * 0.2 - v) < 1e-6
    assert min(lats) == pytest.approx(3 * 5 * 0.2)
    assert min(lons) == pytest.approx(14 * 5 * 0.2)


def test_plan_covers_the_box_and_caps_points():
    for box in [(18.0, 73.0, 19.0, 74.5), (8.0, 68.0, 37.0, 97.0), (18.4, 73.7, 18.6, 73.9)]:
        p = T.plan(*box)
        assert len(p.keys) * T.TILE_POINTS**2 <= T.MAX_POINTS
        assert p.row0 * p.span <= box[0] + 1e-6 and p.col0 * p.span <= box[1] + 1e-6
        assert p.row1 * p.span + (T.TILE_POINTS - 1) * p.step >= box[2] - 1e-6
        assert p.col1 * p.span + (T.TILE_POINTS - 1) * p.step >= box[3] - 1e-6


def test_two_users_with_different_views_share_tiles(upstream):
    """Same zoom band, different position and size: the same tiles."""
    calls, _ = upstream
    a = client.get("/api/map/grid?south=18.31&west=73.52&north=18.79&east=74.05")
    b = client.get("/api/map/grid?south=18.33&west=73.55&north=18.77&east=74.01")
    assert a.status_code == b.status_code == 200
    assert len(calls) == 1, "the second view is inside the same tiles: no new upstream call"


def test_only_missing_tiles_are_fetched_in_one_request(upstream):
    calls, _ = upstream
    client.get("/api/map/grid?south=18.31&west=73.52&north=18.79&east=74.05")
    first_points = len(calls[0].url.params["latitude"].split(","))
    # pan east by one tile width at the same zoom
    p = T.plan(18.31, 73.52, 18.79, 74.05)
    client.get(f"/api/map/grid?south=18.31&west={73.52 + p.span}&north=18.79&east={74.05 + p.span}")
    assert len(calls) == 2
    second_points = len(calls[1].url.params["latitude"].split(","))
    assert second_points < first_points
    assert second_points % T.TILE_POINTS**2 == 0


def test_tiles_from_either_side_of_an_hour_are_aligned(upstream):
    calls, state = upstream
    p = T.plan(18.31, 73.52, 18.79, 74.05)
    client.get("/api/map/grid?south=18.31&west=73.52&north=18.79&east=74.05")
    state["hour"] = 1  # next hour: Open-Meteo now starts one hour later
    body = client.get(f"/api/map/grid?south=18.31&west=73.52&north=18.79&east={74.05 + p.span}").json()
    assert body["times"][0] == "2026-11-03T01:00Z"
    # value at the first common hour is the same hour (1) in old and new tiles
    firsts = {pt["temperature_2m"][0] for pt in body["points"]}
    assert firsts == {1.0}
    assert len(body["times"]) == 72


def test_free_endpoint_without_key(upstream):
    calls, _ = upstream
    client.get("/api/map/grid?south=18.31&west=73.52&north=18.79&east=74.05")
    assert calls[0].url.host == "api.open-meteo.com"
    assert "apikey" not in calls[0].url.params


def test_customer_endpoint_with_key(upstream, monkeypatch):
    monkeypatch.setenv("OPEN_METEO_API_KEY", "test-key-123")
    calls, _ = upstream
    client.get("/api/map/grid?south=18.31&west=73.52&north=18.79&east=74.05")
    assert calls[0].url.host == "customer-api.open-meteo.com"
    assert calls[0].url.params["apikey"] == "test-key-123"


@pytest.mark.parametrize(
    "service, free, customer",
    [
        ("forecast", "api.open-meteo.com", "customer-api.open-meteo.com"),
        ("air-quality", "air-quality-api.open-meteo.com", "customer-air-quality-api.open-meteo.com"),
        ("archive", "archive-api.open-meteo.com", "customer-archive-api.open-meteo.com"),
    ],
)
def test_every_service_switches_with_the_key(monkeypatch, service, free, customer):
    assert free in open_meteo_access.url(service)
    assert "apikey" not in open_meteo_access.params({"a": 1})
    assert open_meteo_access.plan().startswith("free")
    monkeypatch.setenv("OPEN_METEO_API_KEY", "k")
    assert customer in open_meteo_access.url(service)
    assert open_meteo_access.params({"a": 1}) == {"a": 1, "apikey": "k"}
    assert open_meteo_access.plan() == "commercial"


def test_blank_key_means_free(monkeypatch):
    monkeypatch.setenv("OPEN_METEO_API_KEY", "   ")
    assert open_meteo_access.api_key() is None


def test_health_reports_plan_not_key(monkeypatch):
    monkeypatch.setenv("OPEN_METEO_API_KEY", "secret-should-not-leak")
    body = client.get("/health").json()
    assert body["open_meteo"] == "commercial"
    assert "secret-should-not-leak" not in str(body)
