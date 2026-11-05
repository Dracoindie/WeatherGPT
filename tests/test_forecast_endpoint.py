"""GET /api/forecast: the default is the 7 days the UI's 7-day panel shows."""

from fastapi.testclient import TestClient

from api import forecast as forecast_api
from main import app


def _daily(n: int) -> dict:
    return {
        "latitude": 18.52,
        "longitude": 73.86,
        "timezone": "Asia/Kolkata",
        "daily": {
            "time": [f"2026-11-{5 + i:02d}" for i in range(n)],
            "weather_code": [2] * n,
            "temperature_2m_max": [31.0] * n,
            "temperature_2m_min": [21.0] * n,
            "precipitation_sum": [0.0] * n,
            "precipitation_probability_max": [0] * n,
            "windspeed_10m_max": [12.0] * n,
        }
    }


def test_forecast_defaults_to_seven_days(monkeypatch):
    asked: list[int] = []

    async def fake_fetch(lat, lon, days):
        asked.append(days)
        return _daily(days)

    monkeypatch.setattr(forecast_api, "_fetch_daily", fake_fetch)
    r = TestClient(app).get("/api/forecast", params={"latitude": 18.52, "longitude": 73.86})
    assert r.status_code == 200
    assert asked == [7]
    assert len(r.json()["daily"]) == 7


def test_forecast_days_is_capped_at_seven():
    r = TestClient(app).get("/api/forecast", params={"latitude": 18.52, "longitude": 73.86, "days": 8})
    assert r.status_code == 422
