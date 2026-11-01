import pytest
from fastapi.testclient import TestClient
from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch

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
    yield


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


def test_nwp_endpoint_502_on_upstream_failure(monkeypatch):
    """When _fetch_hour_grib raises, endpoint should return 502."""

    async def fail_fetch(client, run, hour_offset, lat, lon):
        raise RuntimeError("NOMADS unavailable")

    monkeypatch.setattr("nwp.service._fetch_hour_grib", fail_fetch)

    resp = client.get("/api/nwp?latitude=18.5204&longitude=73.8567&hours=1")
    assert resp.status_code == 502
    assert "unavailable" in resp.json()["detail"].lower()


def test_nwp_endpoint_invalid_hours():
    resp = client.get("/api/nwp?latitude=18.5204&longitude=73.8567&hours=0")
    assert resp.status_code == 422  # FastAPI validation rejects hours<1
