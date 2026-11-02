"""Persistent geocode cache (backend/data/geocode_cache.json) and GET /api/geocode."""

import asyncio
import json
import os
import time
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest
from fastapi.testclient import TestClient

import geocoding

SEARCH_OK = [{"lat": "16.99", "lon": "73.31", "display_name": "Ratnagiri, Ratnagiri District, Maharashtra, India"}]


def _response(payload, status=200):
    resp = MagicMock(spec=httpx.Response)
    resp.status_code = status
    resp.json.return_value = payload
    return resp


@pytest.fixture
def http():
    with patch("geocoding.httpx.AsyncClient") as cls:
        client = AsyncMock()
        cls.return_value.__aenter__ = AsyncMock(return_value=client)
        cls.return_value.__aexit__ = AsyncMock(return_value=False)
        yield client.get


@pytest.fixture
def sleeps():
    waits: list[float] = []

    async def fake_sleep(seconds):
        waits.append(seconds)

    with patch("geocoding.asyncio.sleep", side_effect=fake_sleep):
        yield waits


def _run(coro):
    return asyncio.run(coro)


def test_tests_never_touch_the_real_cache_file():
    path = geocoding.persistent_cache_path()
    assert path and os.path.abspath(path) != os.path.abspath(geocoding.DEFAULT_PERSISTENT_PATH)


def test_hit_is_written_to_file_and_survives_a_restart(http, sleeps):
    http.return_value = _response(SEARCH_OK)
    first = _run(geocoding.geocode_place("Ratnagiri, Maharashtra, India"))
    with open(geocoding.persistent_cache_path(), encoding="utf-8") as fh:
        stored = json.load(fh)
    assert stored["ratnagiri, maharashtra, india"]["lat"] == 16.99

    geocoding.clear_cache()  # simulates a process restart: memory gone, file kept
    again = _run(geocoding.geocode_place("  RATNAGIRI,  Maharashtra, India "))
    assert http.await_count == 1
    assert (again.latitude, again.longitude, again.name) == (first.latitude, first.longitude, first.name)


def test_misses_are_not_persisted(http, sleeps):
    http.return_value = _response([])
    assert _run(geocoding.geocode_place("Nowhereville")) is None
    assert not os.path.exists(geocoding.persistent_cache_path())


def test_expired_entries_are_refetched(http, sleeps):
    path = geocoding.persistent_cache_path()
    with open(path, "w", encoding="utf-8") as fh:
        json.dump({"ratnagiri": {"lat": 1, "lon": 2, "name": "old", "saved_at": time.time() - geocoding.PERSISTENT_TTL_S - 10}}, fh)
    http.return_value = _response(SEARCH_OK)
    geo = _run(geocoding.geocode_place("Ratnagiri"))
    assert http.await_count == 1 and geo.latitude == 16.99


def test_corrupt_file_is_ignored(http, sleeps):
    with open(geocoding.persistent_cache_path(), "w", encoding="utf-8") as fh:
        fh.write("{not json")
    http.return_value = _response(SEARCH_OK)
    assert _run(geocoding.geocode_place("Ratnagiri")).latitude == 16.99


def test_empty_env_var_turns_the_file_off(monkeypatch, tmp_path, http, sleeps):
    monkeypatch.setenv("GEOCODE_CACHE_PATH", "")
    geocoding.clear_cache()
    http.return_value = _response(SEARCH_OK)
    assert _run(geocoding.geocode_place("Ratnagiri")).latitude == 16.99
    assert geocoding.persistent_cache_path() is None


def test_rate_limit_still_spaces_uncached_lookups(http, sleeps):
    """Fifteen districts in a row: one Nominatim request per second, never faster."""
    http.return_value = _response(SEARCH_OK)

    async def many():
        for i in range(3):
            await geocoding.geocode_place(f"District {i}")

    _run(many())
    assert http.await_count == 3
    assert len(sleeps) == 2 and all(0 < w <= geocoding.MIN_REQUEST_INTERVAL_S for w in sleeps)


class TestEndpoint:
    @pytest.fixture
    def client(self):
        from main import app

        return TestClient(app)

    def test_found(self, client):
        geo = geocoding.GeoResult(16.99, 73.31, "Ratnagiri, Ratnagiri District, Maharashtra")
        with patch("api.geocode.geocode_place", AsyncMock(return_value=geo)) as fn:
            r = client.get("/api/geocode", params={"q": " Ratnagiri, Maharashtra, India "})
        assert r.status_code == 200
        assert r.json() == {"query": "Ratnagiri, Maharashtra, India", "name": geo.name, "latitude": 16.99, "longitude": 73.31}
        fn.assert_awaited_once_with("Ratnagiri, Maharashtra, India")

    def test_unknown_place_is_404(self, client):
        with patch("api.geocode.geocode_place", AsyncMock(return_value=None)):
            r = client.get("/api/geocode", params={"q": "Nowhereville"})
        assert r.status_code == 404

    def test_service_down_is_503(self, client):
        with patch("api.geocode.geocode_place", AsyncMock(side_effect=RuntimeError("down"))):
            r = client.get("/api/geocode", params={"q": "Pune"})
        assert r.status_code == 503

    def test_blank_query_is_rejected(self, client):
        assert client.get("/api/geocode", params={"q": "   "}).status_code == 422
        assert client.get("/api/geocode").status_code == 422
