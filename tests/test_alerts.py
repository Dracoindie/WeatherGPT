"""
Tests for the weather alerts engine and GET /api/alerts endpoint.
"""

from unittest.mock import AsyncMock, patch
import pytest
from fastapi.testclient import TestClient

from main import app
from models.alerts import WeatherAlert, AlertsResponse
from models.weather import CurrentWeather, HourlyWeather, WeatherResponse
from alerts.engine import evaluate_alerts

client = TestClient(app)

def _mock_weather_response(
    temperature: float = 25.0,
    precipitation: float = 0.0,
    wind_speed: float = 10.0,
    weather_code: int = 1,
    hourly_precip_max: float = 0.0,
    hourly_temp_max: float = 25.0,
    hourly_wind_max: float = 10.0,
) -> WeatherResponse:
    from datetime import datetime, timezone
    return WeatherResponse(
        latitude=28.6139,
        longitude=77.2090,
        timezone="Asia/Kolkata",
        retrieved_at=datetime.now(timezone.utc),
        current=CurrentWeather(
            temperature_2m=temperature,
            relative_humidity_2m=50.0,
            precipitation=precipitation,
            wind_speed_10m=wind_speed,
            weather_code=weather_code,
            time="2026-09-22T10:00:00Z",
        ),
        hourly=HourlyWeather(
            time=["2026-09-22T10:00:00Z"] * 24,
            temperature_2m=[hourly_temp_max] * 24,
            precipitation_probability=[10] * 24,
            precipitation=[hourly_precip_max] * 24,
            wind_speed_10m=[hourly_wind_max] * 24,
            weather_code=[weather_code] * 24,
            relative_humidity_2m=[50.0] * 24,
        ),
    )


def test_evaluate_alerts_quiet_weather():
    weather = _mock_weather_response(
        temperature=24.0,
        precipitation=0.0,
        wind_speed=12.0,
        weather_code=0,
    )
    alerts = evaluate_alerts(weather)
    assert len(alerts) == 0


def test_evaluate_alerts_heavy_and_extreme_rain():
    # Heavy rain watch
    weather = _mock_weather_response(precipitation=20.0)
    alerts = evaluate_alerts(weather)
    assert len(alerts) == 1
    assert alerts[0].alert_type == "rain"
    assert alerts[0].severity == "watch"
    assert alerts[0].relevant_value == 20.0

    # Extreme rain warning
    weather_extreme = _mock_weather_response(precipitation=65.0)
    alerts_extreme = evaluate_alerts(weather_extreme)
    assert len(alerts_extreme) == 1
    assert alerts_extreme[0].alert_type == "rain"
    assert alerts_extreme[0].severity == "warning"
    assert alerts_extreme[0].relevant_value == 65.0


def test_evaluate_alerts_extreme_heat_and_cold():
    # Heat warning
    weather_heat = _mock_weather_response(temperature=42.0)
    alerts_heat = evaluate_alerts(weather_heat)
    assert len(alerts_heat) == 1
    assert alerts_heat[0].alert_type == "heat"
    assert alerts_heat[0].severity == "warning"

    # Cold advisory
    weather_cold = _mock_weather_response(temperature=3.5)
    alerts_cold = evaluate_alerts(weather_cold)
    assert len(alerts_cold) == 1
    assert alerts_cold[0].alert_type == "cold"
    assert alerts_cold[0].severity == "advisory"


def test_evaluate_alerts_storm_wind():
    # Strong wind watch
    weather_wind = _mock_weather_response(wind_speed=45.0)
    alerts_wind = evaluate_alerts(weather_wind)
    assert len(alerts_wind) == 1
    assert alerts_wind[0].alert_type == "wind"
    assert alerts_wind[0].severity == "watch"

    # Storm wind warning
    weather_gale = _mock_weather_response(wind_speed=70.0)
    alerts_gale = evaluate_alerts(weather_gale)
    assert len(alerts_gale) == 1
    assert alerts_gale[0].alert_type == "wind"
    assert alerts_gale[0].severity == "warning"


def test_evaluate_alerts_thunderstorm_code():
    weather_ts = _mock_weather_response(weather_code=95)
    alerts_ts = evaluate_alerts(weather_ts)
    assert any(a.alert_type == "storm" for a in alerts_ts)

    weather_severe_ts = _mock_weather_response(weather_code=99)
    alerts_severe = evaluate_alerts(weather_severe_ts)
    storm_alert = next(a for a in alerts_severe if a.alert_type == "storm")
    assert storm_alert.severity == "warning"


@pytest.mark.asyncio
async def test_get_alerts_endpoint_success():
    mock_weather = _mock_weather_response(temperature=41.5, precipitation=0.0)
    with patch("api.alerts.fetch_validated_weather", new=AsyncMock(return_value=mock_weather)):
        resp = client.get("/api/alerts?latitude=28.6139&longitude=77.2090")
        assert resp.status_code == 200
        data = resp.json()
        assert data["latitude"] == 28.6139
        assert data["longitude"] == 77.2090
        assert data["active_alerts_count"] == 1
        assert data["alerts"][0]["alert_type"] == "heat"
        assert data["alerts"][0]["severity"] == "warning"


def test_get_alerts_endpoint_validation():
    # Invalid latitude
    resp = client.get("/api/alerts?latitude=95.0&longitude=77.2090")
    assert resp.status_code == 422

    # Missing parameters
    resp = client.get("/api/alerts")
    assert resp.status_code == 422
