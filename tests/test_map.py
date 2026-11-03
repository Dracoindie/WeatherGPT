"""
/api/map/point and /api/map/grid (docs/VISION.md, step 1), plus the heat index.

Open-Meteo is mocked with httpx.MockTransport: no network. Every number the
endpoints return must come from the mocked payloads (or the documented heat
index formula applied to them).
"""

from __future__ import annotations

from datetime import datetime, timezone
from unittest.mock import AsyncMock

import httpx
import pytest
from fastapi.testclient import TestClient

import maps.grid as grid_mod
import maps.point as point_mod
from air.service import AirQualityData, AirQualityHourly
from main import app
from maps.grid import MAX_POINTS, plan_grid
from maps.heat_index import heat_index_c
from models.weather import CurrentWeather, HourlyWeather, WeatherResponse
from thresholds import HEAT_INDEX_BANDS, heat_band

client = TestClient(app)


@pytest.fixture(autouse=True)
def clear_map_caches():
    grid_mod.clear_cache()
    point_mod.clear_cache()
    yield
    grid_mod.clear_cache()
    point_mod.clear_cache()


# ---------------------------------------------------------------------------
# Heat index
# ---------------------------------------------------------------------------


class TestHeatIndex:
    def test_nws_reference_values(self):
        # NWS table: 90 °F at 50% RH -> 95 °F (35.0 °C); 100 °F at 40% -> 109 °F (42.8 °C)
        assert heat_index_c(32.2, 50) == pytest.approx(35.0, abs=0.5)
        assert heat_index_c(37.8, 40) == pytest.approx(42.8, abs=0.5)

    def test_mild_conditions_use_simple_formula(self):
        # 20 °C / 50%: close to the air temperature
        assert heat_index_c(20.0, 50) == pytest.approx(19.6, abs=0.5)

    def test_missing_input(self):
        assert heat_index_c(None, 50) is None
        assert heat_index_c(30, None) is None

    def test_bands_come_from_thresholds(self):
        assert [b.id for b in HEAT_INDEX_BANDS] == ["caution", "extreme_caution", "danger", "extreme_danger"]
        assert heat_band(None) is None
        assert heat_band(20.0) == "lower_risk"
        assert heat_band(26.7) == "caution"
        assert heat_band(35.0) == "extreme_caution"
        assert heat_band(45.0) == "danger"
        assert heat_band(55.0) == "extreme_danger"


# ---------------------------------------------------------------------------
# Grid planning
# ---------------------------------------------------------------------------


class TestPlanGrid:
    def test_never_more_than_max_points(self):
        for box in [(18.0, 73.0, 19.0, 74.5), (8.0, 68.0, 37.0, 97.0), (18.4, 73.7, 18.6, 73.9)]:
            step, s0, w0, rows, cols = plan_grid(*box, max_points=MAX_POINTS)
            assert rows * cols <= MAX_POINTS
            # the grid covers the box
            assert s0 <= box[0] and w0 <= box[1]
            assert s0 + (rows - 1) * step >= box[2] - 1e-6
            assert w0 + (cols - 1) * step >= box[3] - 1e-6

    def test_snapped_so_small_pans_reuse_the_grid(self):
        a = plan_grid(18.01, 73.01, 18.99, 73.99, 64)
        b = plan_grid(18.02, 73.02, 18.98, 73.98, 64)
        assert a == b

    def test_too_large(self):
        with pytest.raises(grid_mod.GridSpecError):
            plan_grid(-80, -179, 80, 179, 16)


# ---------------------------------------------------------------------------
# /api/map/grid
# ---------------------------------------------------------------------------


def _om_point(lat: float, lon: float, base: float) -> dict:
    n = 72
    return {
        "latitude": lat + 0.003,
        "longitude": lon - 0.002,
        "elevation": 560.0,
        "hourly": {
            "time": [f"2026-11-03T{h % 24:02d}:00" for h in range(n)],
            "temperature_2m": [round(base + h * 0.1, 1) for h in range(n)],
            "relative_humidity_2m": [60.0] * n,
            "apparent_temperature": [round(base + 1 + h * 0.1, 1) for h in range(n)],
            "precipitation": [0.4 if h % 6 == 0 else 0.0 for h in range(n)],
            "precipitation_probability": [30] * n,
            "wind_speed_10m": [12.5] * n,
            "wind_direction_10m": [250.0] * n,
        },
    }


@pytest.fixture
def open_meteo(monkeypatch):
    """Answer grid requests like Open-Meteo (a JSON array); record each request."""
    calls: list[httpx.Request] = []
    state = {"status": 200}
    real = httpx.AsyncClient

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        if state["status"] != 200:
            return httpx.Response(state["status"], text="down")
        lats = [float(v) for v in request.url.params["latitude"].split(",")]
        lons = [float(v) for v in request.url.params["longitude"].split(",")]
        body = [_om_point(la, lo, 25 + i * 0.01) for i, (la, lo) in enumerate(zip(lats, lons))]
        return httpx.Response(200, json=body if len(body) > 1 else body[0])

    def factory(*args, **kwargs):
        kwargs.pop("verify", None)
        return real(*args, transport=httpx.MockTransport(handler), **kwargs)

    monkeypatch.setattr(grid_mod.httpx, "AsyncClient", factory)
    return calls, state


BOX = "south=18.3&west=73.6&north=18.8&east=74.1"


class TestGridEndpoint:
    def test_one_batched_request(self, open_meteo):
        calls, _ = open_meteo
        resp = client.get(f"/api/map/grid?{BOX}&max_points=64")
        assert resp.status_code == 200
        body = resp.json()
        assert len(calls) == 1
        assert len(calls[0].url.params["latitude"].split(",")) == body["rows"] * body["cols"] == len(body["points"])
        assert body["rows"] * body["cols"] <= 64
        assert calls[0].url.params["forecast_hours"] == "72"
        assert calls[0].url.params["timezone"] == "GMT"

    def test_values_flow_unchanged(self, open_meteo):
        body = client.get(f"/api/map/grid?{BOX}").json()
        p0 = body["points"][0]
        assert p0["temperature_2m"][:3] == [25.0, 25.1, 25.2]
        assert p0["apparent_temperature"][0] == 26.0
        assert p0["wind_direction_10m"][0] == 250.0
        assert p0["elevation"] == 560.0
        assert p0["heat_index"][0] == heat_index_c(25.0, 60.0)
        assert body["times"][0] == "2026-11-03T00:00Z"
        assert len(body["times"]) == 72

    def test_honesty_fields(self, open_meteo):
        body = client.get(f"/api/map/grid?{BOX}").json()
        assert body["model_grid_km"] == 8
        assert body["spacing_km"] > 0
        assert "not official IMD" in body["note"]
        assert [b["id"] for b in body["heat_index_bands"]] == [b.id for b in HEAT_INDEX_BANDS]

    def test_cached(self, open_meteo):
        calls, _ = open_meteo
        client.get(f"/api/map/grid?{BOX}")
        client.get("/api/map/grid?south=18.31&west=73.61&north=18.79&east=74.09")
        assert len(calls) == 1

    def test_max_points_capped(self, open_meteo):
        assert client.get(f"/api/map/grid?{BOX}&max_points=500").status_code == 422
        body = client.get("/api/map/grid?south=8&west=68&north=37&east=97&max_points=100").json()
        assert len(body["points"]) <= 100

    def test_bad_box(self, open_meteo):
        assert client.get("/api/map/grid?south=19&west=73&north=18&east=74").status_code == 422
        assert client.get("/api/map/grid?south=-84&west=-179&north=84&east=179&max_points=4").status_code == 422

    def test_upstream_down_is_503(self, open_meteo):
        _, state = open_meteo
        state["status"] = 500
        resp = client.get(f"/api/map/grid?{BOX}")
        assert resp.status_code == 503
        assert "temporarily unavailable" in resp.json()["detail"]


# ---------------------------------------------------------------------------
# /api/map/point
# ---------------------------------------------------------------------------


def _weather(prob_now: int = 40) -> WeatherResponse:
    times = [f"2026-11-03T{h:02d}:00" for h in range(24)]
    return WeatherResponse(
        latitude=18.523726,
        longitude=73.86876,
        timezone="Asia/Kolkata",
        retrieved_at=datetime.now(tz=timezone.utc),
        current=CurrentWeather(
            time="2026-11-03T14:45",
            temperature_2m=31.4,
            relative_humidity_2m=55.0,
            precipitation=0.2,
            wind_speed_10m=14.2,
            wind_direction_10m=250.0,
            weather_code=2,
            uv_index=7.1,
            apparent_temperature=33.9,
        ),
        hourly=HourlyWeather(
            time=times,
            temperature_2m=[30.0] * 24,
            precipitation_probability=[prob_now if h == 14 else 5 for h in range(24)],
            precipitation=[0.0] * 24,
            wind_speed_10m=[10.0] * 24,
            weather_code=[2] * 24,
            relative_humidity_2m=[55.0] * 24,
            wind_direction_10m=[250.0] * 24,
        ),
    )


def _air() -> AirQualityData:
    from datetime import timedelta
    from zoneinfo import ZoneInfo

    now = datetime.now(ZoneInfo("Asia/Kolkata")).replace(minute=0, second=0, microsecond=0, tzinfo=None)
    times = [(now - timedelta(hours=30 - i)).strftime("%Y-%m-%dT%H:%M") for i in range(40)]
    return AirQualityData(timezone="Asia/Kolkata", hourly=AirQualityHourly(time=times, pm2_5=[48.0] * 40, pm10=[92.0] * 40))


class TestPointEndpoint:
    def test_values_flow_unchanged(self, monkeypatch):
        monkeypatch.setattr(point_mod, "fetch_validated_weather", AsyncMock(return_value=_weather(40)))
        monkeypatch.setattr(point_mod, "fetch_air_quality", AsyncMock(return_value=_air()))
        resp = client.get("/api/map/point?latitude=18.52&longitude=73.85")
        assert resp.status_code == 200
        b = resp.json()
        assert b["latitude"] == 18.52 and b["longitude"] == 73.85
        assert b["model_latitude"] == 18.523726
        assert b["temperature_c"] == 31.4
        assert b["feels_like_c"] == 33.9
        assert b["humidity_pct"] == 55.0
        assert b["wind_speed_kmh"] == 14.2
        assert b["wind_direction_deg"] == 250.0
        assert b["precipitation_probability_pct"] == 40  # the 14:00 hour
        assert b["uv_index"] == 7.1 and b["uv_category"] == "high"
        assert b["aqi"] is not None and b["aqi_category"]
        assert b["heat_index_c"] == heat_index_c(31.4, 55.0)
        assert b["heat_band"] == heat_band(b["heat_index_c"])
        assert b["timezone"] == "Asia/Kolkata"
        assert len(b["local_time"]) == 16
        assert b["model_grid_km"] == 8
        assert "not official IMD" in b["note"]

    def test_aqi_down_still_answers(self, monkeypatch):
        monkeypatch.setattr(point_mod, "fetch_validated_weather", AsyncMock(return_value=_weather()))
        monkeypatch.setattr(point_mod, "fetch_air_quality", AsyncMock(side_effect=RuntimeError("down")))
        b = client.get("/api/map/point?latitude=18.52&longitude=73.85").json()
        assert b["temperature_c"] == 31.4
        assert b["aqi"] is None

    def test_weather_down_is_503(self, monkeypatch):
        monkeypatch.setattr(point_mod, "fetch_validated_weather", AsyncMock(side_effect=RuntimeError("down")))
        monkeypatch.setattr(point_mod, "fetch_air_quality", AsyncMock(return_value=_air()))
        resp = client.get("/api/map/point?latitude=18.52&longitude=73.85")
        assert resp.status_code == 503

    def test_cached_for_nearby_taps(self, monkeypatch):
        fetch = AsyncMock(return_value=_weather())
        monkeypatch.setattr(point_mod, "fetch_validated_weather", fetch)
        monkeypatch.setattr(point_mod, "fetch_air_quality", AsyncMock(return_value=_air()))
        client.get("/api/map/point?latitude=18.521&longitude=73.851")
        client.get("/api/map/point?latitude=18.522&longitude=73.852")
        assert fetch.await_count == 1

    def test_validation(self):
        assert client.get("/api/map/point?latitude=91&longitude=0").status_code == 422
        assert client.get("/api/map/point?latitude=10").status_code == 422


def test_shared_client_requests_feels_like():
    from weather.open_meteo import OPTIONAL_VARIABLES

    assert "apparent_temperature" in OPTIONAL_VARIABLES
