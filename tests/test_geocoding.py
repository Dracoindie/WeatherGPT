"""Nominatim client: in-memory TTL cache and the 1 request/second limit (mocked HTTP)."""

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

import geocoding

SEARCH_OK = [{"lat": "18.52", "lon": "73.85", "display_name": "Pune, Pune District, Maharashtra, India"}]
REVERSE_OK = {"address": {"city": "Pune", "state": "Maharashtra", "country": "India"}}


def _response(payload, status=200):
    resp = MagicMock(spec=httpx.Response)
    resp.status_code = status
    resp.json.return_value = payload
    return resp


@pytest.fixture
def http():
    """Patch httpx.AsyncClient in geocoding; yields the mocked .get."""
    with patch("geocoding.httpx.AsyncClient") as cls:
        client = AsyncMock()
        cls.return_value.__aenter__ = AsyncMock(return_value=client)
        cls.return_value.__aexit__ = AsyncMock(return_value=False)
        yield client.get


@pytest.fixture
def sleeps():
    """Record rate-limit waits instead of sleeping."""
    waits: list[float] = []

    async def fake_sleep(seconds):
        waits.append(seconds)

    with patch("geocoding.asyncio.sleep", side_effect=fake_sleep):
        yield waits


def _run(coro):
    return asyncio.run(coro)


class TestCache:
    def test_repeat_search_uses_cache(self, http, sleeps):
        http.return_value = _response(SEARCH_OK)
        first = _run(geocoding.geocode_place("Pune"))
        second = _run(geocoding.geocode_place("  pune "))
        assert http.await_count == 1
        assert (second.latitude, second.longitude, second.name) == (first.latitude, first.longitude, first.name)

    def test_unknown_place_is_cached(self, http, sleeps):
        http.return_value = _response([])
        assert _run(geocoding.geocode_place("Nowhereville")) is None
        assert _run(geocoding.geocode_place("Nowhereville")) is None
        assert http.await_count == 1

    def test_errors_are_not_cached(self, http, sleeps):
        http.side_effect = [_response([], status=503), _response(SEARCH_OK)]
        with pytest.raises(RuntimeError):
            _run(geocoding.geocode_place("Pune"))
        assert _run(geocoding.geocode_place("Pune")).name.startswith("Pune")
        assert http.await_count == 2

    def test_entries_expire_after_ttl(self, http, sleeps):
        http.return_value = _response(SEARCH_OK)
        with patch("geocoding.time.monotonic", return_value=1000.0):
            _run(geocoding.geocode_place("Pune"))
        with patch("geocoding.time.monotonic", return_value=1000.0 + geocoding.CACHE_TTL_S + 1):
            _run(geocoding.geocode_place("Pune"))
        assert http.await_count == 2

    def test_reverse_cached_on_rounded_coordinates(self, http, sleeps):
        http.return_value = _response(REVERSE_OK)
        assert _run(geocoding.reverse_geocode(18.52041, 73.85671)) == "Pune, Maharashtra, India"
        assert _run(geocoding.reverse_geocode(18.52038, 73.85668)) == "Pune, Maharashtra, India"
        assert http.await_count == 1

    def test_reverse_failure_not_cached(self, http, sleeps):
        http.side_effect = [_response({}, status=500), _response(REVERSE_OK)]
        assert _run(geocoding.reverse_geocode(18.52, 73.85)) is None
        assert _run(geocoding.reverse_geocode(18.52, 73.85)) == "Pune, Maharashtra, India"

    def test_cache_size_is_bounded(self, http, sleeps):
        http.return_value = _response(SEARCH_OK)
        with patch("geocoding.CACHE_MAX_ENTRIES", 3):
            for name in ("a1", "b2", "c3", "d4"):
                _run(geocoding.geocode_place(name))
        assert len(geocoding._cache) == 3
        assert ("search", "a1") not in geocoding._cache


class TestRateLimit:
    def test_first_request_does_not_wait(self, http, sleeps):
        http.return_value = _response(SEARCH_OK)
        _run(geocoding.geocode_place("Pune"))
        assert sleeps == []

    def test_back_to_back_requests_are_spaced(self, http, sleeps):
        http.return_value = _response(SEARCH_OK)
        with patch("geocoding.time.monotonic", return_value=50.0):
            _run(geocoding.geocode_place("Pune"))
            _run(geocoding.geocode_place("Nagpur"))
        assert sleeps == [pytest.approx(1.0)]

    def test_no_wait_after_interval_passed(self, http, sleeps):
        http.return_value = _response(SEARCH_OK)
        with patch("geocoding.time.monotonic", return_value=50.0):
            _run(geocoding.geocode_place("Pune"))
        with patch("geocoding.time.monotonic", return_value=51.5):
            _run(geocoding.geocode_place("Nagpur"))
        assert sleeps == []

    def test_cache_hits_skip_the_limiter(self, http, sleeps):
        http.return_value = _response(SEARCH_OK)
        with patch("geocoding.time.monotonic", return_value=50.0):
            _run(geocoding.geocode_place("Pune"))
            _run(geocoding.geocode_place("Pune"))
        assert sleeps == []

    def test_concurrent_requests_are_serialised(self, http):
        http.return_value = _response(SEARCH_OK)

        async def burst():
            await asyncio.gather(*(geocoding.geocode_place(n) for n in ("x1", "x2", "x3")))

        with patch("geocoding.MIN_REQUEST_INTERVAL_S", 0.05):
            elapsed = asyncio.run(_timed(burst))
        assert http.await_count == 3
        assert elapsed >= 0.1  # two enforced gaps


async def _timed(fn):
    import time

    start = time.perf_counter()
    await fn()
    return time.perf_counter() - start
