"""
Tests for the GET /api/climate endpoint and historical weather service.
"""

from datetime import date, timedelta
from unittest.mock import AsyncMock, patch
import pytest
from fastapi.testclient import TestClient

from main import app
from models.climate import ClimateResponse, HistoricalDaily

client = TestClient(app)


def _mock_climate_response(lat: float = 18.5204, lon: float = 73.8567) -> ClimateResponse:
    today = date.today()
    records = [
        HistoricalDaily(
            date=today - timedelta(days=i),
            temperature_max=30.0 - (i * 0.1),
            temperature_min=20.0 - (i * 0.05),
            precipitation_sum=1.5 if i % 3 == 0 else 0.0,
        )
        for i in range(10)
    ]
    return ClimateResponse(
        source="open-meteo",
        latitude=lat,
        longitude=lon,
        timezone="Asia/Kolkata",
        generation_time=0.12,
        daily=records,
    )


def test_get_climate_validation():
    # Invalid latitude
    resp = client.get("/api/climate?latitude=95.0&longitude=73.8567")
    assert resp.status_code == 422

    # Invalid longitude
    resp = client.get("/api/climate?latitude=18.5204&longitude=190.0")
    assert resp.status_code == 422

    # Date range > 365 days
    resp = client.get(
        "/api/climate?latitude=18.5204&longitude=73.8567&start_date=2024-01-01&end_date=2025-06-01"
    )
    assert resp.status_code == 400
    assert "cannot exceed 365 days" in resp.json()["detail"].lower()

    # Start date after end date
    resp = client.get(
        "/api/climate?latitude=18.5204&longitude=73.8567&start_date=2025-02-01&end_date=2025-01-01"
    )
    assert resp.status_code == 400
    assert "start_date must be before end_date" in resp.json()["detail"].lower()


def test_get_climate_mocked():
    mock_resp = _mock_climate_response()
    with patch("api.climate.fetch_historical_weather", new=AsyncMock(return_value=mock_resp)):
        resp = client.get("/api/climate?latitude=18.5204&longitude=73.8567")
        assert resp.status_code == 200
        data = resp.json()
        assert data["source"] == "open-meteo"
        assert data["latitude"] == pytest.approx(18.5204)
        assert data["longitude"] == pytest.approx(73.8567)
        assert len(data["daily"]) == 10
        assert data["daily"][0]["temperature_max"] == 30.0
