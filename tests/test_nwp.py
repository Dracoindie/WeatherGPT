import pytest
from fastapi.testclient import TestClient
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

from main import app  # noqa: E402

client = TestClient(app)

# Fake per-hour data returned by _fetch_hour_grib mock
FAKE_HOUR_DATA = {
    "TMP": 295.15,    # K → 22.0 °C
    "APCP": 0.5,      # mm
    "UGRD": 3.0,      # m/s east
    "VGRD": 4.0,      # m/s north → wind = 5.0
}

@pytest.fixture(autouse=True)
def patch_nwp(monkeypatch):
    async def fake_fetch(client, run, hour_offset, lat, lon):
        return FAKE_HOUR_DATA

    monkeypatch.setattr("nwp.service._fetch_hour_grib", fake_fetch)
    from nwp import service

    service.clear_cache()  # results are cached per point and hours
    yield
    service.clear_cache()


def test_nwp_endpoint_basic():
    lat, lon = 18.5204, 73.8567
    resp = client.get(f"/api/nwp?latitude={lat}&longitude={lon}&hours=3")
    assert resp.status_code == 200
    data = resp.json()

    # metadata
    assert "metadata" in data
    assert data["metadata"]["model"] == "GFS"
    assert data["metadata"]["latitude"] == lat
    assert data["metadata"]["longitude"] == lon
    assert "generationTime" in data["metadata"]

    # forecasts
    assert isinstance(data["forecasts"], list)
    assert len(data["forecasts"]) == 3

    first = data["forecasts"][0]
    for key in ["hour", "temperatureC", "precipitationMm", "windMs"]:
        assert key in first, f"Missing key: {key}"

    # 295.15 K → 22.0 °C
    assert abs(first["temperatureC"] - (295.15 - 273.15)) < 0.01
    # APCP passthrough
    assert abs(first["precipitationMm"] - 0.5) < 0.001
    # sqrt(3^2 + 4^2) = 5.0
    assert abs(first["windMs"] - 5.0) < 0.01


def test_nwp_endpoint_503_on_upstream_failure_with_nothing_cached(monkeypatch):
    """NOMADS fails and there is no last good result: a clean 503 with a reason, never a 502."""

    async def fail_fetch(client, run, hour_offset, lat, lon):
        raise RuntimeError("NOMADS unavailable")

    monkeypatch.setattr("nwp.service._fetch_hour_grib", fail_fetch)

    resp = client.get("/api/nwp?latitude=18.5204&longitude=73.8567&hours=1")
    assert resp.status_code == 503
    detail = resp.json()["detail"]
    assert detail.startswith("GFS model temporarily unavailable: ")
    assert "nomads.ncep" not in detail and "://" not in detail  # never a URL


class _Clock:
    def __init__(self):
        self.t = 1_000.0

    def __call__(self):
        return self.t


def _counting_fetch(calls, fail=None):
    async def fetch(client, run, hour_offset, lat, lon):
        calls.append(hour_offset)
        if fail is not None:
            raise fail
        return FAKE_HOUR_DATA

    return fetch


def test_nwp_result_is_cached_for_an_hour(monkeypatch):
    from nwp import service

    clock = _Clock()
    monkeypatch.setattr(service.time, "monotonic", clock)
    calls: list[int] = []
    monkeypatch.setattr(service, "_fetch_hour_grib", _counting_fetch(calls))

    url = "/api/nwp?latitude=18.5204&longitude=73.8567&hours=2"
    assert client.get(url).status_code == 200
    first = len(calls)
    assert first >= 2
    clock.t += service.FRESH_S - 1
    body = client.get(url).json()
    assert len(calls) == first  # served from the cache, NOMADS not asked again
    assert body["stale"] is False
    assert body["retrievedAt"]
    clock.t += 2  # past FRESH_S: fetched again
    assert client.get(url).status_code == 200
    assert len(calls) > first


def test_nwp_serves_last_good_result_marked_stale_when_nomads_fails(monkeypatch):
    import httpx

    from nwp import service

    clock = _Clock()
    monkeypatch.setattr(service.time, "monotonic", clock)
    monkeypatch.setattr(service, "_fetch_hour_grib", _counting_fetch([]))
    url = "/api/nwp?latitude=18.5204&longitude=73.8567&hours=2"
    good = client.get(url).json()

    clock.t += service.FRESH_S + 60
    monkeypatch.setattr(service, "_fetch_hour_grib", _counting_fetch([], fail=httpx.ConnectTimeout("slow")))
    resp = client.get(url)
    assert resp.status_code == 200
    body = resp.json()
    assert body["stale"] is True
    assert body["staleReason"] == "NOMADS did not answer in time"
    assert body["forecasts"] == good["forecasts"]  # the same numbers, never invented
    assert body["retrievedAt"] == good["retrievedAt"]  # says when it was really fetched


def test_nwp_last_good_result_expires_after_a_day(monkeypatch):
    import httpx

    from nwp import service

    clock = _Clock()
    monkeypatch.setattr(service.time, "monotonic", clock)
    monkeypatch.setattr(service, "_fetch_hour_grib", _counting_fetch([]))
    url = "/api/nwp?latitude=18.5204&longitude=73.8567&hours=2"
    assert client.get(url).status_code == 200

    clock.t += service.STALE_MAX_S + 1
    request = httpx.Request("GET", "https://nomads.ncep.noaa.gov/x")
    err = httpx.HTTPStatusError("bad", request=request, response=httpx.Response(502, request=request))
    monkeypatch.setattr(service, "_fetch_hour_grib", _counting_fetch([], fail=err))
    resp = client.get(url)
    assert resp.status_code == 503
    assert resp.json()["detail"] == "GFS model temporarily unavailable: NOMADS returned HTTP 502."


@pytest.mark.parametrize(
    "exc, reason",
    [
        ("timeout", "NOMADS did not answer in time"),
        ("connect", "NOMADS could not be reached"),
        ("runs", "no recent GFS run is fully published yet"),
        ("other", "GFS data could not be decoded"),
    ],
)
def test_nwp_failure_reasons_are_short_and_safe(exc, reason):
    import asyncio

    import httpx

    from nwp import service

    request = httpx.Request("GET", "https://nomads.ncep.noaa.gov/cgi-bin/filter_gfs_0p25.pl?secret")
    errors = {
        "timeout": asyncio.TimeoutError(),
        "connect": httpx.ConnectError("refused", request=request),
        "runs": RuntimeError("No GFS runs available in the last 24 h"),
        "other": ValueError("cfgrib: bad message at offset 12"),
    }
    assert service._reason(errors[exc]) == reason



def test_nwp_endpoint_invalid_hours():
    resp = client.get("/api/nwp?latitude=18.5204&longitude=73.8567&hours=0")
    assert resp.status_code == 422  # FastAPI validation rejects hours<1


# The autouse patch_nwp fixture replaces _fetch_hour_grib; keep the real one.
from nwp import service as _nwp_service  # noqa: E402

_REAL_FETCH_HOUR_GRIB = _nwp_service._fetch_hour_grib


@pytest.mark.asyncio
async def test_grib_decoding_does_not_block_the_event_loop(monkeypatch):
    """Root cause of intermittent /api/alerts 502s: blocking cfgrib decodes froze the loop."""
    import asyncio
    import time

    from nwp import service

    def slow_decode(content):
        time.sleep(0.4)  # stands in for cfgrib work
        return {"TMP": 300.0}

    monkeypatch.setattr(service, "_decode_grib", slow_decode)

    resp = MagicMock()
    resp.content = b"grib"
    resp.raise_for_status = MagicMock()
    http = MagicMock()
    http.get = AsyncMock(return_value=resp)

    ticks = 0

    async def ticker():
        nonlocal ticks
        while True:
            await asyncio.sleep(0.02)
            ticks += 1

    task = asyncio.create_task(ticker())
    try:
        await _REAL_FETCH_HOUR_GRIB(http, service._latest_run_timestamp(), 0, 19.4, 72.8)
    finally:
        task.cancel()
    # 0.8 s of decoding; a blocked loop would tick ~0 times.
    assert ticks >= 15


@pytest.mark.asyncio
async def test_nomads_requests_are_capped_at_max_concurrent(monkeypatch):
    """24 forecast hours = 48 GRIB filter requests: they queue, at most MAX_CONCURRENT at once."""
    import asyncio

    from nwp import service

    monkeypatch.setattr(service, "_decode_grib", lambda content: {"TMP": 300.0})
    in_flight = 0
    peak = 0

    async def get(url):
        nonlocal in_flight, peak
        in_flight += 1
        peak = max(peak, in_flight)
        await asyncio.sleep(0.01)
        in_flight -= 1
        resp = MagicMock()
        resp.content = b"grib"
        resp.raise_for_status = MagicMock()
        return resp

    http = MagicMock()
    http.get = get
    http._wgpt_gate = asyncio.Semaphore(service.MAX_CONCURRENT)
    run = service._latest_run_timestamp()
    await asyncio.gather(*(_REAL_FETCH_HOUR_GRIB(http, run, h, 19.4, 72.8) for h in range(24)))
    assert peak == service.MAX_CONCURRENT
