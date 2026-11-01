"""
tests/test_weather.py

Test suite for WeatherGPT's weather layer.

Strategy
--------
- Coordinate validation  → uses FastAPI TestClient (no network)
- Schema validation      → constructs models directly from a mocked payload
- API integration tests  → mock httpx to avoid repeated real API calls

Run with:
    pytest tests/test_weather.py -v
"""

import json
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest
from fastapi.testclient import TestClient

# Ensure backend/ is on the path when running from the project root.
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

from main import app  # noqa: E402  (after sys.path manipulation)
from models.weather import CurrentWeather, HourlyWeather, WeatherResponse

# ---------------------------------------------------------------------------
# Shared fixtures
# ---------------------------------------------------------------------------

client = TestClient(app)

# A minimal payload that mirrors what Open-Meteo actually returns.
MOCK_OPEN_METEO_PAYLOAD = {
    "latitude": 18.52,
    "longitude": 73.86,
    "timezone": "Asia/Kolkata",
    "timezone_abbreviation": "IST",
    "current": {
        "time": "2026-09-09T21:00",
        "temperature_2m": 28.3,
        "relative_humidity_2m": 74.0,
        "precipitation": 0.0,
        "wind_speed_10m": 12.5,
        "wind_direction_10m": 250.0,
        "weather_code": 2,
    },
    "hourly": {
        "time": [f"2026-09-0{day}T{hour:02d}:00" for day in range(9, 12) for hour in range(24)],
        "temperature_2m": [28.0 + i * 0.1 for i in range(72)],
        "precipitation_probability": [10] * 72,
        "precipitation": [0.0] * 72,
        "wind_speed_10m": [10.0 + i * 0.05 for i in range(72)],
        "weather_code": [2] * 72,
        "relative_humidity_2m": [70.0] * 72,
        "wind_direction_10m": [250.0] * 72,
    },
}


# ---------------------------------------------------------------------------
# Task 4 — Coordinate validation tests
# ---------------------------------------------------------------------------


class TestCoordinateValidation:
    """latitude must be [-90, 90]; longitude must be [-180, 180]."""

    def test_valid_coordinates_pune(self):
        """Pune coordinates should pass validation (mocked HTTP)."""
        mock_response = MagicMock(spec=httpx.Response)
        mock_response.status_code = 200
        mock_response.json.return_value = MOCK_OPEN_METEO_PAYLOAD

        with patch("weather.open_meteo.httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client_cls.return_value.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client_cls.return_value.__aexit__ = AsyncMock(return_value=False)
            mock_client.get = AsyncMock(return_value=mock_response)

            resp = client.get("/api/weather?latitude=18.5204&longitude=73.8567")

        assert resp.status_code == 200

    def test_latitude_too_high(self):
        resp = client.get("/api/weather?latitude=91&longitude=0")
        assert resp.status_code == 422

    def test_latitude_too_low(self):
        resp = client.get("/api/weather?latitude=-91&longitude=0")
        assert resp.status_code == 422

    def test_longitude_too_high(self):
        resp = client.get("/api/weather?latitude=0&longitude=181")
        assert resp.status_code == 422

    def test_longitude_too_low(self):
        resp = client.get("/api/weather?latitude=0&longitude=-181")
        assert resp.status_code == 422

    def test_boundary_latitude_90(self):
        """Exact boundary values must be accepted."""
        mock_response = MagicMock(spec=httpx.Response)
        mock_response.status_code = 200
        mock_response.json.return_value = MOCK_OPEN_METEO_PAYLOAD

        with patch("weather.open_meteo.httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client_cls.return_value.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client_cls.return_value.__aexit__ = AsyncMock(return_value=False)
            mock_client.get = AsyncMock(return_value=mock_response)

            resp = client.get("/api/weather?latitude=90&longitude=180")

        assert resp.status_code == 200

    def test_missing_latitude(self):
        resp = client.get("/api/weather?longitude=73.8567")
        assert resp.status_code == 422

    def test_missing_longitude(self):
        resp = client.get("/api/weather?latitude=18.5204")
        assert resp.status_code == 422

    def test_non_numeric_latitude(self):
        resp = client.get("/api/weather?latitude=abc&longitude=73")
        assert resp.status_code == 422


# ---------------------------------------------------------------------------
# Task 2 — Schema / Pydantic model validation tests
# ---------------------------------------------------------------------------


class TestWeatherSchema:
    """Verify Pydantic models accept valid data and reject invalid data."""

    def test_current_weather_model_valid(self):
        cw = CurrentWeather(**MOCK_OPEN_METEO_PAYLOAD["current"])
        assert cw.temperature_2m == 28.3
        assert cw.relative_humidity_2m == 74.0
        assert cw.weather_code == 2

    def test_hourly_weather_model_valid(self):
        hw = HourlyWeather(**MOCK_OPEN_METEO_PAYLOAD["hourly"])
        assert len(hw.time) == 72
        assert len(hw.temperature_2m) == 72

    def test_weather_response_model_valid(self):
        current = CurrentWeather(**MOCK_OPEN_METEO_PAYLOAD["current"])
        hourly = HourlyWeather(**MOCK_OPEN_METEO_PAYLOAD["hourly"])
        wr = WeatherResponse(
            latitude=18.52,
            longitude=73.86,
            timezone="Asia/Kolkata",
            retrieved_at=datetime.now(tz=timezone.utc),
            current=current,
            hourly=hourly,
        )
        assert wr.source == "open-meteo"
        assert wr.timezone == "Asia/Kolkata"

    def test_weather_response_source_always_open_meteo(self):
        """source must always be 'open-meteo' (data provenance guarantee)."""
        current = CurrentWeather(**MOCK_OPEN_METEO_PAYLOAD["current"])
        hourly = HourlyWeather(**MOCK_OPEN_METEO_PAYLOAD["hourly"])
        wr = WeatherResponse(
            latitude=0,
            longitude=0,
            timezone="UTC",
            retrieved_at=datetime.now(tz=timezone.utc),
            current=current,
            hourly=hourly,
        )
        assert wr.source == "open-meteo"

    def test_current_weather_missing_field_raises(self):
        bad = dict(MOCK_OPEN_METEO_PAYLOAD["current"])
        del bad["temperature_2m"]
        with pytest.raises(Exception):
            CurrentWeather(**bad)

    def test_hourly_weather_missing_time_raises(self):
        bad = dict(MOCK_OPEN_METEO_PAYLOAD["hourly"])
        del bad["time"]
        with pytest.raises(Exception):
            HourlyWeather(**bad)


# ---------------------------------------------------------------------------
# API-level integration test (HTTP fully mocked)
# ---------------------------------------------------------------------------


class TestWeatherEndpointIntegration:
    """End-to-end route test with httpx mocked out."""

    def _mock_client(self, payload: dict):
        mock_response = MagicMock(spec=httpx.Response)
        mock_response.status_code = 200
        mock_response.json.return_value = payload
        return mock_response

    def test_full_response_shape(self):
        mock_response = self._mock_client(MOCK_OPEN_METEO_PAYLOAD)

        with patch("weather.open_meteo.httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client_cls.return_value.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client_cls.return_value.__aexit__ = AsyncMock(return_value=False)
            mock_client.get = AsyncMock(return_value=mock_response)

            resp = client.get("/api/weather?latitude=18.5204&longitude=73.8567")

        assert resp.status_code == 200
        body = resp.json()
        assert body["source"] == "open-meteo"
        assert "current" in body
        assert "hourly" in body
        assert "retrieved_at" in body
        assert body["current"]["temperature_2m"] == 28.3
        assert body["current"]["wind_direction_10m"] == 250.0
        assert len(body["hourly"]["wind_direction_10m"]) == 72
        assert body["hourly"]["weather_code"][0] == 2
        assert body["hourly"]["relative_humidity_2m"][0] == 70.0

    def test_upstream_timeout_returns_502(self):
        with patch("weather.open_meteo.httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client_cls.return_value.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client_cls.return_value.__aexit__ = AsyncMock(return_value=False)
            mock_client.get = AsyncMock(side_effect=httpx.TimeoutException("timed out"))

            resp = client.get("/api/weather?latitude=18.5204&longitude=73.8567")

        assert resp.status_code == 502

    def test_upstream_non_200_returns_502(self):
        mock_response = MagicMock(spec=httpx.Response)
        mock_response.status_code = 503
        mock_response.text = "Service Unavailable"

        with patch("weather.open_meteo.httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client_cls.return_value.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client_cls.return_value.__aexit__ = AsyncMock(return_value=False)
            mock_client.get = AsyncMock(return_value=mock_response)

            resp = client.get("/api/weather?latitude=18.5204&longitude=73.8567")

        assert resp.status_code == 502


# ---------------------------------------------------------------------------
# Health endpoint
# ---------------------------------------------------------------------------


def test_health_endpoint():
    """GET /health must always return {status: ok, service: WeatherGPT API}."""
    resp = client.get("/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ok"
    assert body["service"] == "WeatherGPT API"
